"""Explicit knowledge review. Drafts and checks are isolated from trusted definitions."""
import json
import shutil
import sqlite3
import threading
from pathlib import Path
from typing import Literal, Optional
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, String, Text, inspect, select, delete
from sqlalchemy.orm import Session
from .knowledge import stamp, digest, MetricDefinition, KnowledgeSettings
from .provider import ModelError
from .sql_guard import validate_sql, GuardError
from .execution import execute_isolated, ExecutionError
from .prompts import KNOWLEDGE_DRAFT_VERSION


def register(base):
    models = []
    for name, table in [('KnowledgeDraft', 'knowledge_drafts'), ('KnowledgeReviewExample', 'knowledge_review_examples')]:
        models.append(type(name, (base,), dict(__tablename__=table, id=Column(String(36), primary_key=True),
            dataset_id=Column(String(36), nullable=False, index=True), payload=Column(Text, nullable=False))))
    return models


def migrate(engine, root, models):
    if all(inspect(engine).has_table(m.__tablename__) for m in models):
        return
    if inspect(engine).has_table('datasets'):
        folder = root / 'backups' / ('knowledge-v7-' + stamp().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Knowledge migration requires a verified SQLite backup before DDL.')
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    for model in models:
        model.__table__.create(engine, checkfirst=True)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class DraftMetric(Strict):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=800)
    sql: str = Field(min_length=1, max_length=2000)


class DraftColumn(Strict):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=500)


class DraftOutput(Strict):
    description: str = Field(min_length=1, max_length=1000)
    columns: list[DraftColumn] = Field(max_length=100)
    metrics: list[DraftMetric] = Field(max_length=20)


class DraftRequest(Strict):
    confirm_sharing: Literal[True]


class DraftReview(Strict):
    action: Literal['edit', 'approve', 'reject']
    content: Optional[dict] = None
    replace_existing: bool = False
    confirm_revision: Optional[str] = None


class BulkReview(Strict):
    ids: list[UUID] = Field(min_length=1, max_length=121)
    confirm_count: int = Field(ge=1, le=121)
    confirm_revision: str


class Candidate(Strict):
    run_id: UUID


class Reference(Strict):
    reference_type: Literal['sql', 'expected']
    independently_authored: Literal[True]
    reference_sql: Optional[str] = Field(default=None, max_length=12000)
    expected: Optional[dict] = None


class Approval(Strict):
    approve: Literal[True]
    revision: str


class ConfirmDelete(Strict):
    confirm: Literal[True]


class ClearRejected(Strict):
    confirm: Literal[True]
    confirm_count: int = Field(ge=1)


class ReviewService:
    def __init__(self, knowledge, models, editor, admission):
        self.k, self.Draft, self.Example = knowledge, *models
        self.editor, self.admission = editor, admission
        self.active, self.request_lock = set(), threading.Lock()

    def revision(self, identifier):
        # File hash is already the authoritative KnowledgeService revision; include editor N.
        state = self.editor.read(identifier)[0]
        return digest([state['version'], self.k.profile(identifier)['data_revision']])

    def writable(self, identifier):
        item = self.k.get_item(identifier)
        if item.archived_at:
            raise HTTPException(409, 'Archived dataset knowledge is read-only. Restore it in Datasets first.')
        return item

    def benchmark(self, identifier, question=''):
        from .benchmark import authored_cases
        store = self.k.analyst.store
        with Session(self.k.engine) as session:
            installed = session.scalar(select(store.models['BenchmarkInstall'].id).where(
                store.models['BenchmarkInstall'].dataset_id == str(identifier)).limit(1))
        canonical = lambda s: ' '.join(s.casefold().split())
        return bool(installed) or (bool(question) and canonical(question) in {canonical(c['question']) for c in authored_cases()})

    def rows(self, model, identifier):
        with Session(self.k.engine) as session:
            return [{**json.loads(row.payload), 'id': row.id, 'dataset_id': row.dataset_id} for row in session.scalars(select(model).where(model.dataset_id == str(identifier)))]

    def save(self, model, value, session):
        row = session.get(model, value['id'])
        if row is None:
            row = model(id=value['id'], dataset_id=value['dataset_id'], payload='{}'); session.add(row)
        row.payload = json.dumps(value)

    def find(self, model, identifier, entry_id):
        for row in self.rows(model, identifier):
            if row['id'] == str(entry_id):
                return row
        raise HTTPException(404, 'Review item not found.')

    def schema(self, identifier):
        return {c['name']: 'VARCHAR' for c in self.k.profile(identifier)['columns']}

    def metric_check(self, identifier, content):
        try:
            metric = DraftMetric.model_validate(content)
            sql = validate_sql(metric.sql, self.schema(identifier))
            execute_isolated(self.k.root / (str(identifier) + '.duckdb'), sql)
            return {'passed': True, 'message': 'Read-only execution passed.'}
        except (GuardError, ExecutionError, ValueError):
            return {'passed': False, 'message': 'Could not be checked. Edit the definition and SQL, then check again.'}

    def current(self, draft, settings):
        if draft['item_type'] == 'description':
            return {'description': settings.description}
        if draft['item_type'] == 'column':
            return {'description': settings.columns.get(draft['item_key'], '')}
        return next((m.model_dump() for m in settings.metrics if m.name.casefold() == draft['item_key'].casefold()), {})

    def drafts(self, identifier):
        revision = self.revision(identifier)
        settings = self.k.settings(identifier)['settings']
        settings = KnowledgeSettings.model_validate(settings)
        return [{**r, 'stale': r['revision'] != revision, 'current': self.current(r, settings)} for r in self.rows(self.Draft, identifier)]

    def request_draft(self, identifier):
        self.writable(identifier)
        with self.request_lock:
            if str(identifier) in self.active:
                raise HTTPException(429, 'A draft request is already active for this dataset.')
            self.active.add(str(identifier))
        try:
            with self.admission, self.k.lock:
                self.writable(identifier)
                revision = self.revision(identifier)
                item = self.k.get_item(identifier)
                profile = self.k.profile(identifier)
                columns = []
                with self.k.connector(self.k.root / (str(identifier) + '.duckdb')) as db:
                    from .type_profile import q
                    for column in profile['columns']:
                        columns.append(dict(name=column['name'], inferred_type=column['suggested_type'], count=profile['rows'],
                            null_count=column['missing'], unique_count=db.execute('SELECT COUNT(DISTINCT ' + q(column['name']) + ') FROM records').fetchone()[0]))
                payload = {'dataset_name': item.name, 'row_count': profile['rows'], 'columns': columns}
            try:
                output, provenance = self.k.analyst.provider.draft_knowledge(payload)
                output = DraftOutput.model_validate(output)
            except (ModelError, ValueError, AttributeError) as exc:
                raise HTTPException(502, 'Draft provider unavailable or returned invalid structured output. No draft items were saved.') from exc
            if len({c.name for c in output.columns}) != len(output.columns) or set(c.name for c in output.columns) - set(self.schema(identifier)):
                raise HTTPException(422, 'Draft contains unknown or duplicate columns. No items were saved.')
            if len({m.name.casefold() for m in output.metrics}) != len(output.metrics):
                raise HTTPException(422, 'Draft metric names must be unique.')
            values = [('description', 'dataset', {'description': output.description})]
            values += [('column', c.name, {'description': c.description}) for c in output.columns]
            values += [('metric', m.name, m.model_dump()) for m in output.metrics]
            records = []
            for kind, key, content in values:
                records.append(dict(id=str(uuid4()), dataset_id=str(identifier), item_type=kind, item_key=key,
                    content=content, status='draft', revision=revision, revision_number=self.editor.read(identifier)[0]['version'], created_at=stamp(), reviewed_at=None,
                    provenance={'source': 'ai_draft', 'provider': 'Configured AI provider', 'model': provenance.get('model', 'unknown'), 'prompt_version': KNOWLEDGE_DRAFT_VERSION},
                    check=self.metric_check(identifier, content) if kind == 'metric' else {'passed': True, 'message': 'Text draft; review required.'}))
            with self.admission, self.k.lock, Session(self.k.engine) as session:
                self.writable(identifier)
                if self.revision(identifier) != revision:
                    raise HTTPException(409, 'Dataset changed during drafting. No items were saved; request a fresh draft.')
                for record in records:
                    self.save(self.Draft, record, session)
                session.commit()
            return self.drafts(identifier)
        finally:
            with self.request_lock:
                self.active.discard(str(identifier))

    def review(self, identifier, entry_id, body):
        with self.admission, self.k.lock:
            self.writable(identifier)
            record = self.find(self.Draft, identifier, entry_id)
            if record['status'] in {'approved', 'rejected'}:
                raise HTTPException(409, 'This item has already been reviewed.')
            revision = self.revision(identifier)
            if body.action != 'reject' and body.confirm_revision != revision:
                raise HTTPException(409, 'May be out of date. Review against the current revision and confirm it.')
            if body.action == 'edit':
                content = body.content or {}
                if record['item_type'] == 'metric':
                    try:
                        content = DraftMetric.model_validate(content).model_dump()
                    except ValueError as exc:
                        raise HTTPException(422, 'Metric name, definition and SQL must meet the draft schema limits.') from exc
                    record['item_key'] = content['name']
                elif set(content) != {'description'} or not isinstance(content['description'], str) or not content['description'].strip() or len(content['description']) > (1000 if record['item_type'] == 'description' else 500):
                    raise HTTPException(422, 'A bounded description is required.')
                record.update(content=content, status='edited', revision=revision, revision_number=self.editor.read(identifier)[0]['version'],
                    check=self.metric_check(identifier, content) if record['item_type'] == 'metric' else {'passed': True, 'message': 'Edited text; review required.'})
            elif body.action == 'approve':
                if not record['check']['passed']:
                    raise HTTPException(409, 'This metric could not be checked. Edit and check it before approval.')
                # Re-check metric on a new revision rather than accepting the old execution.
                if record['revision'] != revision and record['item_type'] == 'metric':
                    raise HTTPException(409, 'Edit and re-check this stale metric before approval.')
                info = self.k.settings(identifier)
                settings = KnowledgeSettings.model_validate(info['settings'])
                if record['item_type'] == 'column' and record['item_key'] not in info['columns']:
                    raise HTTPException(409, 'The proposed column no longer exists.')
                old = self.current(record, settings)
                if any(old.values()) and not body.replace_existing:
                    raise HTTPException(409, 'Existing knowledge requires an explicit Replace or Keep decision.')
                if record['item_type'] == 'description':
                    settings.description = record['content']['description']
                elif record['item_type'] == 'column':
                    settings.columns[record['item_key']] = record['content']['description']
                else:
                    settings.metrics = [m for m in settings.metrics if m.name.casefold() != record['item_key'].casefold()] + [MetricDefinition(**record['content'], money=old.get('money'))]
                # Save definition and provenance atomically. Fingerprints rebuild lazily.
                try:
                    settings = KnowledgeSettings.model_validate(settings.model_dump())
                except ValueError as exc:
                    raise HTTPException(422, 'Knowledge limits exceeded. Keep at most 20 metrics and valid definitions.') from exc
                with Session(self.k.engine) as session:
                    state = session.get(self.k.State, self.k.key(identifier))
                    state.settings_json, state.updated_at = settings.model_dump_json(), stamp()
                    record.update(status='approved', revision=revision, revision_number=self.editor.read(identifier)[0]['version'], reviewed_at=stamp())
                    self.save(self.Draft, record, session)
                    session.commit()
                return self.drafts(identifier)
            else:
                record.update(status='rejected', reviewed_at=stamp())
            with Session(self.k.engine) as session:
                self.save(self.Draft, record, session); session.commit()
            return self.drafts(identifier)

    def examples(self, identifier):
        revision = self.revision(identifier)
        rows = self.rows(self.Example, identifier)
        for row in rows:
            if row['status'] == 'approved' and row['revision'] != revision:
                row['status'] = 'needs_recheck'
        for legacy in self.rows(self.k.Example, identifier):
            rows.append({**legacy, 'legacy': True, 'status': 'legacy'})
        return rows

    def candidate(self, identifier, run_id):
        with self.admission, self.k.lock:
            self.writable(identifier)
            run = self.k.analyst.load(run_id)
            if run['dataset_id'] != str(identifier) or run['status'] != 'succeeded' or run.get('activity_kind', 'user') != 'user' or self.benchmark(identifier, run['question']):
                raise HTTPException(409, 'Only completed non-benchmark user answers can be proposed.')
            record = dict(id=str(uuid4()), dataset_id=str(identifier), run_id=str(run_id), question=run['question'],
                sql=run.get('executed_sql') or run['sql'], mapping=run['type_mapping'], revision=self.revision(identifier),
                revision_number=self.editor.read(identifier)[0]['version'], status='candidate', reference_type=None, reference=None, checked_revision=None, approved_at=None, created_at=stamp())
            with Session(self.k.engine) as session:
                self.save(self.Example, record, session); session.commit()
            return record

    def check_reference(self, identifier, entry_id, body):
        from .benchmark import equivalent
        with self.admission, self.k.lock:
            self.writable(identifier)
            record = self.find(self.Example, identifier, entry_id)
            if self.benchmark(identifier, record['question']):
                raise HTTPException(409, 'Benchmark material cannot become a verified example.')
            schema = self.schema(identifier)
            mapping = record.get('mapping', {})
            schema.update({k: v for k, v in mapping.items() if k in schema})
            try:
                candidate_sql = validate_sql(record['sql'], schema)
                actual = execute_isolated(self.k.root / (str(identifier) + '.duckdb'), candidate_sql, mapping)
                if body.reference_type == 'sql':
                    reference_sql = validate_sql(body.reference_sql or '', schema)
                    if digest(reference_sql) == digest(candidate_sql):
                        raise HTTPException(422, 'Replaying the candidate SQL is not an independent reference. Supply your own reference or manual expected result.')
                    expected = execute_isolated(self.k.root / (str(identifier) + '.duckdb'), reference_sql, mapping)
                    reference = {'sql': reference_sql, 'independently_authored': True}
                else:
                    expected = body.expected
                    if not isinstance(expected, dict) or set(expected) != {'columns', 'rows', 'row_count'} or not isinstance(expected['rows'], list) or len(expected['rows']) > 100 or expected['row_count'] != len(expected['rows']) or len(json.dumps(expected)) > 16384:
                        raise HTTPException(422, 'Enter a manual expected result with columns, rows and row_count (at most 100 rows).')
                    reference = {'expected': expected, 'independently_authored': True}
                passed, message = equivalent(actual, expected, False)
            except (GuardError, ExecutionError, ValueError, KeyError, TypeError, IndexError) as exc:
                passed, message, reference = False, 'Reference could not be checked. Review SQL and expected result shape.', {'independently_authored': True}
            revision = self.revision(identifier)
            record.update(status='candidate' if passed else 'reference_failed', reference_type=body.reference_type,
                reference=reference, check={'passed': passed, 'message': message}, checked_revision=revision, approved_at=None)
            with Session(self.k.engine) as session:
                self.save(self.Example, record, session); session.commit()
            return record

    def approve_example(self, identifier, entry_id, body):
        with self.admission, self.k.lock:
            self.writable(identifier)
            record = self.find(self.Example, identifier, entry_id)
            revision = self.revision(identifier)
            if self.benchmark(identifier, record['question']) or body.revision != revision or record.get('checked_revision') != revision or not record.get('check', {}).get('passed') or not record.get('reference'):
                raise HTTPException(409, 'Explicit approval requires a passing independent reference check on this revision.')
            record.update(status='approved', revision=revision, revision_number=self.editor.read(identifier)[0]['version'], approved_at=stamp())
            with Session(self.k.engine) as session:
                self.save(self.Example, record, session); session.commit()
            return record

    def trusted(self, identifier):
        return [r for r in self.examples(identifier) if r['status'] == 'approved' and not self.benchmark(identifier, r['question'])]

    def router(self):
        router = APIRouter(prefix='/api/datasets/{dataset_id}/knowledge', tags=['Knowledge review'])
        @router.get('/review')
        def overview(dataset_id: UUID):
            return {'revision': self.revision(dataset_id), 'revision_number': self.editor.read(dataset_id)[0]['version'], 'drafts': self.drafts(dataset_id), 'examples': self.examples(dataset_id)}
        @router.post('/drafts')
        def draft(dataset_id: UUID, body: DraftRequest): return self.request_draft(dataset_id)
        @router.patch('/drafts/{entry_id}')
        def review(dataset_id: UUID, entry_id: UUID, body: DraftReview): return self.review(dataset_id, entry_id, body)
        @router.post('/drafts/clear-rejected')
        def clear_rejected(dataset_id: UUID, body: ClearRejected):
            with self.admission,self.k.lock:
                self.writable(dataset_id)
                with Session(self.k.engine) as session:
                    rows=list(session.scalars(select(self.Draft).where(self.Draft.dataset_id==str(dataset_id))))
                    rejected=[row for row in rows if json.loads(row.payload).get('status')=='rejected']
                    if len(rejected)!=body.confirm_count:raise HTTPException(409,'Rejected draft count changed. Reload and confirm the current count.')
                    for row in rejected:session.delete(row)
                    session.commit()
                return {'cleared_count':len(rejected)}
        @router.post('/drafts/approve-all')
        def approve_all(dataset_id: UUID, body: BulkReview):
            if len(set(body.ids)) != body.confirm_count or len(body.ids) != body.confirm_count:
                raise HTTPException(422, 'Confirm the exact eligible item count.')
            with self.admission, self.k.lock:
                # Preflight all items; overwrites always require individual Replace.
                items = {r['id']: r for r in self.drafts(dataset_id)}
                for entry_id in body.ids:
                    r = items.get(str(entry_id))
                    if not r or r['status'] not in {'draft', 'edited'} or r['stale'] or not r['check']['passed'] or any(r['current'].values()):
                        raise HTTPException(409, 'Approve only eligible current items without existing values. Review replacements individually.')
                if any(items[str(i)]['item_type'] == 'metric' for i in body.ids):
                    raise HTTPException(409, 'Metric calculations are approved one at a time. Approve each metric on its own.')
                targets = [(items[str(i)]['item_type'], items[str(i)]['item_key'].casefold()) for i in body.ids]
                if len(set(targets)) != len(targets):
                    raise HTTPException(409, 'Multiple drafts target the same value. Review them individually.')
                settings = self.k.settings(dataset_id)['settings']
                if len(settings['metrics']) + sum(items[str(i)]['item_type'] == 'metric' for i in body.ids) > 20:
                    raise HTTPException(409, 'Approve fewer items to stay within the 20-metric limit.')
                if body.confirm_revision != self.revision(dataset_id):
                    raise HTTPException(409, 'Dataset revision changed; review the items again.')
                for entry_id in body.ids:
                    self.review(dataset_id, entry_id, DraftReview(action='approve', confirm_revision=body.confirm_revision))
            return self.drafts(dataset_id)
        @router.post('/candidates')
        def candidate(dataset_id: UUID, body: Candidate): return self.candidate(dataset_id, body.run_id)
        @router.post('/candidates/{entry_id}/check')
        def check(dataset_id: UUID, entry_id: UUID, body: Reference): return self.check_reference(dataset_id, entry_id, body)
        @router.post('/candidates/{entry_id}/approve')
        def approve(dataset_id: UUID, entry_id: UUID, body: Approval): return self.approve_example(dataset_id, entry_id, body)
        @router.post('/legacy/{entry_id}/reverify')
        def reverify(dataset_id: UUID, entry_id: UUID):
            self.writable(dataset_id)
            with Session(self.k.engine) as session:
                row = session.get(self.k.Example, str(entry_id))
                if not row or row.dataset_id != str(dataset_id): raise HTTPException(404, 'Legacy example not found.')
                legacy = json.loads(row.payload)
            with self.admission, self.k.lock:
                self.writable(dataset_id)
                if self.benchmark(dataset_id, legacy.get('question', '')):
                    raise HTTPException(409, 'Benchmark material cannot be reverified into RAG.')
                if not legacy.get('question') or not legacy.get('sql'):
                    raise HTTPException(409, 'Legacy provenance lacks a question and SQL. Propose a new answer instead.')
                record = dict(id=str(uuid4()), dataset_id=str(dataset_id), question=legacy['question'], sql=legacy['sql'],
                    run_id=legacy.get('run_id'), legacy_id=str(entry_id), mapping=legacy.get('type_mapping', {}),
                    revision=self.revision(dataset_id), revision_number=self.editor.read(dataset_id)[0]['version'], status='candidate', reference_type=None, reference=None,
                    checked_revision=None, approved_at=None, created_at=stamp())
                with Session(self.k.engine) as session:
                    self.save(self.Example, record, session); session.commit()
                return record
        @router.delete('/candidates/{entry_id}')
        def remove(dataset_id: UUID, entry_id: UUID, body: ConfirmDelete):
            with self.admission, self.k.lock, Session(self.k.engine) as session:
                self.writable(dataset_id)
                removed = False
                for model in (self.Example, self.k.Example):
                    row = session.get(model, str(entry_id))
                    if row and row.dataset_id == str(dataset_id): session.delete(row); removed = True
                if not removed: raise HTTPException(404, 'Example not found.')
                session.commit()
            return {'deleted': True}
        return router
