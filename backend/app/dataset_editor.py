"""Transactional edits; records remains the original VARCHAR-only query relation."""
import csv
import io
import json
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from .analyst import TERMINAL
from .sql_guard import TYPES


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Update(StrictModel):
    id: UUID
    values: Dict[str, Optional[StrictStr]]


class EditBatch(StrictModel):
    expected_version: int = Field(ge=1)
    types_confirmed: bool = False
    type_mapping: Dict[str, str] = Field(default_factory=dict)
    updates: List[Update] = Field(default_factory=list, max_length=1000)
    additions: List[Dict[str, Optional[StrictStr]]] = Field(default_factory=list, max_length=1000)
    deletions: List[UUID] = Field(default_factory=list, max_length=1000)


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def csv_chunks(header, rows):
    buf = io.StringIO(newline='')
    writer = csv.writer(buf)
    for row in [header]:
        writer.writerow(row)
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
    for row in rows:
        writer.writerow(row)
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)


class DatasetEditor:
    def __init__(self, root, engine, Dataset, analyst, knowledge, automl, connector, get_item):
        self.root, self.engine, self.Dataset = root, engine, Dataset
        self.analyst, self.knowledge, self.automl = analyst, knowledge, automl
        self.connect, self.get_item = connector, get_item

    def initialize(self, identifier, original=None):
        path = self.root / (str(identifier) + '.duckdb')
        with self.connect(path, False) as db:
            if db.execute("SELECT count(*) FROM information_schema.tables WHERE table_name='_editor_state'").fetchone()[0]:
                return
            header = [c[0] for c in db.execute('DESCRIBE records').fetchall()]
            # DuckDB preserves insertion order for a single-table scan. A user
            # column may itself be named rowid, so never order by that name.
            rows = db.execute('SELECT * FROM records').fetchall()
            if original is None:
                original = ''.join(csv_chunks(header, rows)).encode('utf-8')
            db.execute('BEGIN')
            try:
                db.execute('CREATE TABLE _editor_ids (ordinal BIGINT, id VARCHAR UNIQUE)')
                if rows:
                    db.executemany('INSERT INTO _editor_ids VALUES (?,?)', [(i, str(uuid4())) for i in range(len(rows))])
                db.execute('CREATE TABLE _editor_state (payload VARCHAR, original BLOB)')
                state = dict(version=1, saved_at=None, changed_rows=0, type_mapping={}, history=[])
                db.execute('INSERT INTO _editor_state VALUES (?,?)', [json.dumps(state), original])
                db.execute('COMMIT')
            except Exception:
                db.execute('ROLLBACK')
                raise

    def read(self, identifier):
        self.get_item(identifier)
        with self.connect(self.root / (str(identifier) + '.duckdb')) as db:
            state = json.loads(db.execute('SELECT payload FROM _editor_state').fetchone()[0])
            header = [c[0] for c in db.execute('DESCRIBE records').fetchall()]
            # DuckDB preserves insertion order for a single-table scan. A user
            # column may itself be named rowid, so never order by that name.
            rows = db.execute('SELECT * FROM records').fetchall()
            ids = [r[0] for r in db.execute('SELECT id FROM _editor_ids ORDER BY ordinal').fetchall()]
        return state, header, rows, ids

    def recover(self):
        with Session(self.engine) as session:
            ids = list(session.scalars(select(self.Dataset.id)))
        for identifier in ids:
            self.initialize(identifier)
            self.sync_catalog(identifier)

    def sync_catalog(self, identifier):
        # DuckDB owns both the committed revision and data. SQLite is repairable metadata.
        state, header, rows, _ = self.read(identifier)
        if state["version"] == 1:
            return
        with Session(self.engine) as session:
            item = session.get(self.Dataset, str(identifier))
            item.rows = len(rows)
            item.bytes = sum(len(s.encode('utf-8')) for s in csv_chunks(header, rows))
            item.schema_json = json.dumps([dict(name=h, type='VARCHAR', null_count=sum(r[i] is None for r in rows)) for i, h in enumerate(header)])
            session.commit()

    def prepare(self, identifier, batch):
        state, header, rows, ids = self.read(identifier)
        if state['version'] != batch.expected_version:
            raise HTTPException(409, 'Dataset has changed. Cancel and reopen the editor before saving.')
        if not 1 <= len(batch.updates) + len(batch.additions) + len(batch.deletions) <= 1000:
            raise HTTPException(422, 'Save between 1 and 1,000 row operations per batch.')
        mapping = batch.type_mapping
        if any(k not in header or v not in TYPES for k, v in mapping.items()):
            raise HTTPException(422, 'Unknown column or unsupported type mapping.')
        updates = {str(u.id): u.values for u in batch.updates}
        deleted = {str(i) for i in batch.deletions}
        if len(updates) != len(batch.updates) or len(deleted) != len(batch.deletions) or set(updates) & deleted:
            raise HTTPException(422, 'Duplicate or conflicting row operations.')
        if not (set(updates) | deleted) <= set(ids):
            raise HTTPException(422, 'Row identifier does not belong to this dataset revision.')
        if state['type_mapping'] and mapping != state['type_mapping'] and not batch.types_confirmed:
            raise HTTPException(422, 'Confirm the new analysis type mapping explicitly before changing validation types.')
        with self.connect(self.root / (str(identifier) + '.duckdb')) as db:
            def validate(values):
                if any(k not in header for k in values):
                    raise HTTPException(422, 'Changes to dataset columns or schema are not allowed.')
                for name, value in values.items():
                    if value is None:
                        continue
                    if len(value) > 65536 or '\x00' in value:
                        raise HTTPException(422, f'{name}: maximum 65,536 characters; NUL is unsupported.')
                    typ = mapping.get(name, 'VARCHAR')
                    valid = True
                    if typ != 'VARCHAR':
                        valid = db.execute('SELECT TRY_CAST(? AS ' + typ + ') IS NOT NULL', [value]).fetchone()[0]
                        if typ == 'BIGINT':
                            valid = valid and re.fullmatch(r'[+-]?[0-9]+', value.strip()) is not None
                        if typ == 'DOUBLE':
                            valid = valid and db.execute('SELECT isfinite(TRY_CAST(? AS DOUBLE))', [value]).fetchone()[0]
                    if not valid:
                        raise HTTPException(422, f'{name}: {value[:80]!r} is invalid for confirmed type {typ}. Use NULL for a missing value.')
            for values in list(updates.values()) + batch.additions:
                validate(values)
            if mapping != state["type_mapping"]:
                for rid, row in zip(ids, rows):
                    if rid not in deleted:
                        validate({h: updates.get(rid, {}).get(h, row[i]) for i, h in enumerate(header)})
        result, result_ids = [], []
        for rid, row in zip(ids, rows):
            if rid in deleted:
                continue
            values = updates.get(rid, {})
            result.append([values.get(h, row[i]) for i, h in enumerate(header)])
            result_ids.append(rid)
        for values in batch.additions:
            result.append([values.get(h) for h in header])
            result_ids.append(str(uuid4()))
        if len(result) > 20000 or sum(len(s.encode('utf-8')) for s in csv_chunks(header, result)) > 5 * 1024 * 1024:
            raise HTTPException(413, 'Updated dataset exceeds 20,000 rows or 5 MiB CSV.')
        return state, header, result, result_ids

    def write(self, path, state, header, records, ids):
        with self.connect(path, False) as db:
            db.execute('BEGIN')
            try:
                db.execute('DELETE FROM records')
                db.execute('DELETE FROM _editor_ids')
                if records:
                    db.executemany('INSERT INTO records VALUES (' + ','.join('?' for _ in header) + ')', records)
                    db.executemany('INSERT INTO _editor_ids VALUES (?,?)', list(enumerate(ids)))
                db.execute('UPDATE _editor_state SET payload=?', [json.dumps(state)])
                db.execute('COMMIT')
            except Exception:
                db.execute('ROLLBACK')
                raise

    def router(self):
        router = APIRouter(prefix='/api/datasets', tags=['Dataset editor'])

        @router.get('/{dataset_id}/rows')
        def rows(dataset_id: UUID, offset: int = Query(0, ge=0, le=20000), limit: int = Query(25, ge=1, le=100), sort: Optional[str] = None, descending: bool = False):
            with self.knowledge.lock:
                state, header, records, ids = self.read(dataset_id)
                pairs = list(zip(ids, records))
                if sort:
                    if sort not in header:
                        raise HTTPException(422, 'Unknown sort column.')
                    idx = header.index(sort)
                    pairs.sort(key=lambda p: (p[1][idx] is None, p[1][idx] or ''), reverse=descending)
                return dict(columns=header, rows=[dict(id=i, values=r) for i, r in pairs[offset:offset+limit]], total=len(records), offset=offset, **state)

        @router.get('/{dataset_id}/version')
        def version(dataset_id: UUID):
            with self.knowledge.lock:
                return self.read(dataset_id)[0]

        @router.post('/{dataset_id}/edits/validate')
        def validate(dataset_id: UUID, batch: EditBatch):
            with self.knowledge.lock:
                if self.get_item(dataset_id).archived_at:
                    raise HTTPException(409, "Archived datasets are view only.")
                self.prepare(dataset_id, batch)
                return {'valid': True}

        @router.post('/{dataset_id}/edits')
        def save(dataset_id: UUID, batch: EditBatch):
            with self.revisions.lifecycle.admission_lock, self.knowledge.lock, self.analyst.lock:
                item = self.get_item(dataset_id)
                if item.archived_at:
                    raise HTTPException(409, "Archived datasets are view only.")
                if self.revisions.lifecycle.dependencies(dataset_id)["delete_blocked"]:
                    raise HTTPException(409, "Wait for active Analyst, AutoML and Evaluation work before editing.")
                with Session(self.engine) as session:
                    active = session.scalar(select(self.analyst.Run.id).where(self.analyst.Run.dataset_id == str(dataset_id), self.analyst.Run.status.not_in(TERMINAL)).limit(1))
                if active or self.automl.active(dataset_id):
                    raise HTTPException(409, 'Wait for active analysis or ML work before editing this dataset.')
                state, header, records, ids = self.prepare(dataset_id, batch)
                state.update(version=state['version'] + 1, saved_at=datetime.now(timezone.utc).isoformat(), changed_rows=len(batch.updates) + len(batch.additions) + len(batch.deletions), type_mapping=batch.type_mapping)
                state['history'] = (state['history'] + [{k: state[k] for k in ('version', 'saved_at', 'changed_rows')}])[-100:]
                _, old_header, old_rows, old_ids = self.read(dataset_id)
                old = {rid: dict(zip(old_header, row)) for rid, row in zip(old_ids, old_rows)}
                changed_cells = sum(value != old[str(u.id)].get(name) for u in batch.updates for name, value in u.values.items())
                self.revisions.commit_edit(dataset_id, state, header, records, ids, changed_cells)
                try:
                    self.sync_catalog(dataset_id)
                    self.knowledge.sync(dataset_id)
                    self.quality.invalidate(dataset_id)
                except Exception as exc:
                    raise HTTPException(503, f"Data saved as version {state['version']}, but metadata refresh failed. Reopen the dataset; restart repairs catalog metadata. Do not resubmit the old batch.") from exc
                return state

        @router.get('/{dataset_id}/export')
        def export(dataset_id: UUID):
            with self.knowledge.lock:
                item = self.get_item(dataset_id)
                _, header, records, _ = self.read(dataset_id)
            # Bounded 5 MiB snapshot is captured before streaming; writers cannot mix revisions.
            from urllib.parse import quote as urlquote
            name = item.name.rsplit('.', 1)[0] + '_updated.csv'
            return StreamingResponse(csv_chunks(header, records), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': "attachment; filename*=UTF-8''" + urlquote(name)})

        return router
