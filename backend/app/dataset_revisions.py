"""Forward-only immutable dataset snapshots. Never backfills or rewrites old data."""
import zlib
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Integer, String, Text, inspect, select, delete, text
from sqlalchemy.orm import Session
from .persistence import utcnow

SNAPSHOT_LIMIT = 20


def register(base):
    return type('DatasetRevision', (base,), dict(
        __tablename__='dataset_revisions', dataset_id=Column(String(36), primary_key=True),
        revision=Column(Integer, primary_key=True), source=Column(String(20), nullable=False),
        timestamp=Column(String(40), nullable=False), sha256=Column(String(64), nullable=True),
        size_bytes=Column(Integer, nullable=True), row_count=Column(Integer, nullable=True),
        snapshot_path=Column(Text, nullable=True), status=Column(String(20), nullable=False),
        changed_cells=Column(Integer, nullable=True), restored_from=Column(Integer, nullable=True),
        snapshot_format=Column(String(20),nullable=True), uncompressed_size_bytes=Column(Integer,nullable=True)))


def migrate(engine, root, Model):
    if inspect(engine).has_table('dataset_revisions'):
        return
    if inspect(engine).has_table('datasets'):
        folder = root / 'backups' / ('revisions-v6-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'), dirs_exist_ok=True)
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Revision migration requires a verified SQLite backup before DDL.')
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    Model.__table__.create(engine, checkfirst=True)


def file_hash(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def durable_copy(source, destination):
    with source.open('rb') as inp, destination.open('xb') as out:
        shutil.copyfileobj(inp, out)
        out.flush()
        os.fsync(out.fileno())


def sync_directory(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Restore(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=1)
    confirm_restore: bool
    has_unsaved_edits: bool


class Revisions:
    def __init__(self, root, engine, Model, editor, lifecycle, limit=SNAPSHOT_LIMIT):
        self.root, self.engine, self.Model, self.editor, self.lifecycle = root, engine, Model, editor, lifecycle
        self.limit, self.protected = max(1, limit), set()

    def directory(self, identifier):
        return self.root / 'revisions' / str(UUID(str(identifier)))

    def record(self, identifier, revision):
        with Session(self.engine) as session:
            row = session.get(self.Model, (str(identifier), revision))
            if row is None or row.status != 'available' or not row.snapshot_path:
                raise HTTPException(409, 'No retained snapshot is available for this revision.')
            return row

    def verified_path(self, row):
        path = self.root / row.snapshot_path
        temporary = None
        try:
            if row.snapshot_format not in (None,'raw','gzip'):raise ValueError('Unknown snapshot format')
            if row.snapshot_format=='gzip':
                temporary=self.directory(row.dataset_id)/('.stage-materialized-'+str(uuid4())+'.duckdb')
                limit=row.uncompressed_size_bytes
                if limit is None:raise ValueError('Uncompressed size not recorded')
                size=0
                with gzip.open(path,'rb') as source,temporary.open('xb') as target:
                    while True:
                        chunk=source.read(min(1024*1024,limit-size+1))
                        if not chunk:break
                        size+=len(chunk)
                        if size>limit:raise ValueError('Uncompressed size differs')
                        target.write(chunk)
                    target.flush();os.fsync(target.fileno())
                if size!=limit:raise ValueError('Uncompressed size differs')
                path=temporary
            if not path.is_file() or file_hash(path)!=row.sha256:raise ValueError('Snapshot hash differs')
            return path
        except (OSError,EOFError,ValueError,zlib.error) as exc:
            if temporary:temporary.unlink(missing_ok=True)
            raise HTTPException(409,'Snapshot hash verification failed. Nothing was restored.') from exc

    def capture_import(self, identifier):
        state, _, rows, _ = self.editor.read(identifier)
        self.publish(identifier, self.root / (str(identifier) + '.duckdb'), state, len(rows), 'import', None, replace=False)

    def publish(self, identifier, staged, state, count, source, changed_cells, restored_from=None, replace=True):
        """A recoverable pending record bridges SQLite metadata and atomic file replacement.

        Snapshot bytes are durable before the live file is replaced. On restart only
        pending new revisions are reconciled; existing datasets are not snapshotted.
        """
        folder = self.directory(identifier)
        folder.mkdir(parents=True, exist_ok=True)
        revision = state['version']
        snapshot = folder / (str(revision) + '.duckdb.gz')
        digest = file_hash(staged)
        if snapshot.exists():
            raise HTTPException(409, 'This immutable revision snapshot already exists.')
        committed = False
        inserted = False
        try:
            with staged.open('rb') as inp,snapshot.open('xb') as raw:
                with gzip.GzipFile(fileobj=raw,mode='wb',mtime=0) as out:shutil.copyfileobj(inp,out)
                raw.flush();os.fsync(raw.fileno())
            with gzip.open(snapshot,'rb') as check:
                verified=hashlib.sha256()
                for chunk in iter(lambda:check.read(1024*1024),b''):verified.update(chunk)
            if verified.hexdigest() != digest:
                raise HTTPException(409, 'Snapshot hash verification failed. Dataset was not changed.')
            snapshot.chmod(0o400)
            sync_directory(folder)
            with Session(self.engine) as session:
                session.add(self.Model(dataset_id=str(identifier), revision=revision, source=source,
                    timestamp=state.get('saved_at') or utcnow(), sha256=digest, size_bytes=snapshot.stat().st_size,
                    row_count=count, snapshot_path=str(snapshot.relative_to(self.root)), status='pending',
                    changed_cells=changed_cells, restored_from=restored_from,snapshot_format='gzip',uncompressed_size_bytes=staged.stat().st_size))
                session.commit()
                inserted = True
            if replace:
                os.replace(staged, self.root / (str(identifier) + '.duckdb'))
                committed = True
                sync_directory(self.root)
            committed = True
            with Session(self.engine) as session:
                row = session.get(self.Model, (str(identifier), revision))
                row.status = 'available'
                session.commit()
            if not self.protected:
                self.prune(identifier)
        except Exception:
            if not committed:
                if inserted:
                    with Session(self.engine) as session:
                        session.execute(delete(self.Model).where(self.Model.dataset_id == str(identifier), self.Model.revision == revision))
                        session.commit()
                if snapshot.exists():
                    snapshot.unlink()
            raise

    def commit_edit(self, identifier, state, header, rows, ids, changed_cells):
        folder = self.directory(identifier)
        folder.mkdir(parents=True, exist_ok=True)
        staged = folder / ('.stage-' + str(uuid4()) + '.duckdb')
        try:
            durable_copy(self.root / (str(identifier) + '.duckdb'), staged)
            self.editor.write(staged, state, header, rows, ids)
            self.publish(identifier, staged, state, len(rows), 'edit_save', changed_cells)
        finally:
            staged.unlink(missing_ok=True)

    def recover(self):
        with Session(self.engine) as session:
            pending = list(session.scalars(select(self.Model).where(self.Model.status == 'pending')))
        for row in pending:
            live = self.root / (row.dataset_id + '.duckdb')
            snapshot = self.root / row.snapshot_path
            version=0
            if live.exists():
                with self.editor.connect(live) as db:
                    version=json.loads(db.execute('SELECT payload FROM _editor_state').fetchone()[0])['version']
            try:
                checked=self.verified_path(row)
                complete=version>row.revision or version==row.revision and file_hash(live)==row.sha256
                if row.snapshot_format=='gzip':checked.unlink(missing_ok=True)
            except HTTPException:complete=False
            with Session(self.engine) as session:
                stored = session.get(self.Model, (row.dataset_id, row.revision))
                if complete:
                    stored.status = 'available'
                else:
                    session.delete(stored)
                    snapshot.unlink(missing_ok=True)
                session.commit()
            if complete:
                self.prune(row.dataset_id)
        # Staging files are never retained snapshots. No live data or old snapshots are rewritten.
        revisions = self.root / 'revisions'
        if revisions.exists():
            for stage in revisions.glob('*/.stage-*.duckdb*'):
                stage.unlink(missing_ok=True)

    def prune(self, identifier):
        with Session(self.engine) as session:
            rows = list(session.scalars(select(self.Model).where(self.Model.dataset_id == str(identifier), self.Model.status == 'available').order_by(self.Model.revision.desc())))
            removable = [r for r in reversed(rows) if (r.dataset_id, r.revision) not in self.protected]
            for row in removable[:max(0, len(rows) - self.limit)]:
                (self.root / row.snapshot_path).unlink(missing_ok=True)
                row.status, row.snapshot_path = 'pruned', None
            session.commit()

    def history(self, identifier, offset=0, limit=100):
        state, _, _, _ = self.editor.read(identifier)
        with Session(self.engine) as session:
            rows = {r.revision: r for r in session.scalars(select(self.Model).where(self.Model.dataset_id == str(identifier)))}
            started = session.execute(text('SELECT applied_at FROM schema_migrations WHERE version=6')).scalar()
        legacy = {h['version']: h for h in state.get('history', [])}
        item = self.editor.get_item(identifier)
        result = []
        for number in range(state['version'] - offset, max(0, state['version'] - offset - limit), -1):
            row = rows.get(number)
            if row:
                result.append({key: getattr(row, key) for key in ('revision','source','timestamp','sha256','size_bytes','row_count','status','changed_cells','restored_from','snapshot_format','uncompressed_size_bytes')})
            else:
                result.append(dict(revision=number, source='import' if number == 1 else 'unknown', timestamp=item.created_at if number == 1 else legacy.get(number, {}).get('saved_at'), sha256=None, size_bytes=None, row_count=None, status='unavailable', changed_cells=None, restored_from=None))
        with self.engine.connect() as connection:
            audit=[dict(r._mapping) for r in connection.execute(text('SELECT id,action,timestamp,result,reason,actor FROM dataset_audit WHERE dataset_id=:id ORDER BY timestamp DESC LIMIT 100'),{'id':str(identifier)})]
        return dict(audit=audit,current_revision=state['version'], recording_started_at=started, snapshot_limit=self.limit, snapshot_bytes=sum(r.size_bytes or 0 for r in rows.values() if r.status == 'available'), total=state['version'], revisions=result)

    def preview(self, identifier, revision, offset, limit):
        self.editor.get_item(identifier)
        row = self.record(identifier, revision)
        path = self.verified_path(row)
        try:
            with self.editor.connect(path) as db:
                columns = [c[0] for c in db.execute('DESCRIBE records').fetchall()]
                values = db.execute('SELECT * FROM records LIMIT ? OFFSET ?', [limit, offset]).fetchall()
            return dict(revision=revision, columns=columns, rows=values, total=row.row_count, offset=offset)
        finally:
            if row.snapshot_format=='gzip':path.unlink(missing_ok=True)

    def restore(self, identifier, revision, body):
        def work():
            item = self.editor.get_item(identifier)
            if item.archived_at:
                raise HTTPException(409, 'Archived datasets are view only. Unarchive the dataset before restoring a revision.')
            if body.has_unsaved_edits or not body.confirm_restore:
                raise HTTPException(409, 'Save or discard unsaved edits and confirm the restore first.')
            if self.lifecycle.dependencies(identifier)['delete_blocked']:
                raise HTTPException(409, 'Wait for active Analyst, AutoML and Evaluation jobs before restoring.')
            current, _, _, _ = self.editor.read(identifier)
            if current['version'] != body.expected_version:
                raise HTTPException(409, 'Dataset has changed. Reload history before restoring.')
            row = self.record(identifier, revision)
            source = self.verified_path(row)
            key = (str(identifier), revision)
            self.protected.add(key)
            staged = self.directory(identifier) / ('.stage-' + str(uuid4()) + '.duckdb')
            try:
                durable_copy(source, staged)
                if file_hash(staged) != row.sha256:
                    raise HTTPException(409, 'Snapshot hash verification failed. Nothing was restored.')
                with self.editor.connect(staged, False) as db:
                    state = json.loads(db.execute('SELECT payload FROM _editor_state').fetchone()[0])
                    # Only editor revision metadata changes after the byte-verified copy.
                    # records, stable IDs, original CSV bytes and all strings remain untouched.
                    state.update(version=current['version'] + 1, saved_at=utcnow(), changed_rows=0)
                    state['history'] = (current.get('history', []) + [{k: state[k] for k in ('version','saved_at','changed_rows')}])[-100:]
                    db.execute('UPDATE _editor_state SET payload=?', [json.dumps(state)])
                self.publish(identifier, staged, state, row.row_count, 'restore', None, restored_from=revision)
                try:
                    self.editor.sync_catalog(identifier)
                    self.editor.knowledge.sync(identifier)
                except Exception as exc:
                    raise HTTPException(503, f"Data restored as revision {state['version']}, but metadata refresh failed. Reload the dataset; restart repairs catalog metadata. Do not retry the old restore request.") from exc
                if hasattr(self.editor, 'quality'):
                    self.editor.quality.invalidate(identifier)
                return state
            finally:
                staged.unlink(missing_ok=True)
                if row.snapshot_format=='gzip':source.unlink(missing_ok=True)
                self.protected.discard(key)
                self.prune(identifier)
        # Fail promptly before waiting on a long-running reader, then recheck under admission locks.
        if self.lifecycle.dependencies(identifier)['delete_blocked']:
            self.lifecycle.audit('restore_revision', identifier, 'blocked', 'Active jobs must finish before restore.')
            raise HTTPException(409, 'Wait for active Analyst, AutoML and Evaluation jobs before restoring.')
        return self.lifecycle.perform('restore_revision', identifier, work)

    def purge(self, identifier):
        shutil.rmtree(self.directory(identifier), ignore_errors=False) if self.directory(identifier).exists() else None
        with Session(self.engine) as session:
            session.execute(delete(self.Model).where(self.Model.dataset_id == str(identifier)))
            session.commit()
        if hasattr(self.editor, 'quality'):
            self.editor.quality.invalidate(identifier)

    def router(self):
        router = APIRouter(prefix='/api/datasets', tags=['Dataset revisions'])
        @router.get('/{identifier}/revisions')
        def history(identifier: UUID, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
            with self.editor.knowledge.lock:
                return self.history(identifier, offset, limit)
        @router.get('/{identifier}/revisions/{revision}/preview')
        def preview(identifier: UUID, revision: int, offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100)):
            with self.editor.knowledge.lock:
                return self.preview(identifier, revision, offset, limit)
        @router.post('/{identifier}/revisions/{revision}/restore')
        def restore(identifier: UUID, revision: int, body: Restore):
            return self.restore(identifier, revision, body)
        return router
