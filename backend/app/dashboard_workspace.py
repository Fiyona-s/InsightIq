"""Read-only dashboard projections and explicitly retained widget refreshes."""
import copy
import json
import re
import shutil
import sqlite3
import unicodedata
from pathlib import Path
from typing import Literal, Optional
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Integer, String, Text, inspect, select, delete
from sqlalchemy.orm import Session
from sqlglot import parse_one
from .knowledge import digest
from .persistence import utcnow
from .sql_guard import validate_sql, GuardError
from .execution import execute_isolated, ExecutionError
from .charts import validate_chart

HISTORY_LIMIT = 3


def register(base):
    return type('DashboardSnapshot', (base,), dict(__tablename__='dashboard_widget_snapshots',
        id=Column(String(36), primary_key=True), dashboard_id=Column(String(80), nullable=False, index=True),
        widget_id=Column(String(80), nullable=False, index=True), generation=Column(Integer,nullable=False), created_at=Column(String(40), nullable=False),
        payload=Column(Text, nullable=False)))


def migrate(engine, root, model):
    if inspect(engine).has_table(model.__tablename__): return
    if inspect(engine).has_table('datasets'):
        folder = root / 'backups' / ('dashboards-v8-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Dashboard migration requires a verified SQLite backup before DDL.')
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target: source.backup(target)
    model.__table__.create(engine, checkfirst=True)


def title(value):
    value = value.strip()
    if not 1 <= len(value) <= 120 or any(unicodedata.category(c).startswith('C') for c in value):
        raise ValueError('Use a title of 1 to 120 characters without control characters.')
    return value


def readable(value):
    text = re.sub(r'_(?:INR|USD|EUR|GBP|AED|CAD|AUD|JPY|SGD)\b', '', value, flags=re.I)
    text = re.sub(r'[_\s]+', ' ', text).strip(' ?.\n')
    acronyms = {'sql','kpi','id','sku','api','usd','inr','eur','gbp','aed','cad','aud','jpy','sgd','yoy','mom','roi'}
    return ' '.join(w.upper() if w.casefold() in acronyms or (w.isupper() and len(w)>1) else w.capitalize() for w in text.split())[:120] or 'Saved Result'


def sql_hash(sql):
    # SQLGlot removes comments/insignificant whitespace and normalizes unquoted
    # identifier case. String literals, predicates, ordering and aliases remain.
    try: return digest(parse_one(sql, read='duckdb').sql(dialect='duckdb', normalize=True, comments=False))
    except Exception: return digest(sql)


def duplicate_key(chart, spec=None):
    return (chart['dataset_id'], sql_hash(chart['sql']), (spec or chart['spec'])['kind'])


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class TitleInput(Strict):
    title: Optional[str] = None
    revision: int = Field(ge=1)


class Refresh(Strict):
    confirm_refresh: Literal[True]
    revision: Optional[int] = Field(default=None, ge=1)
    expected_result_hash: Optional[str] = None


class Attach(Strict):
    chart_id: UUID
    revision: int = Field(ge=1)
    duplicate_action: Literal['replace', 'add_anyway', 'cancel'] = 'cancel'
    replace_widget_id: Optional[UUID] = None


class Workspace:
    def __init__(self, dashboards, model, editor, lifecycle):
        self.d, self.Model, self.editor, self.lifecycle = dashboards, model, editor, lifecycle
        self.engine = dashboards.store.engine

    def rows(self, dashboard, widget):
        with Session(self.engine) as session:
            return [(r.id, json.loads(r.payload)) for r in session.scalars(select(self.Model).where(
                self.Model.dashboard_id == str(dashboard), self.Model.widget_id == str(widget)).order_by(self.Model.generation.desc()))]

    def effective(self, dashboard, widget):
        rows = self.rows(dashboard, widget['id'])
        return copy.deepcopy(rows[0][1]['chart']) if rows else self.d.store.get('SavedChart', widget['chart_id'])

    def history(self, dashboard, widget):
        doc = self.d.store.get('Dashboard', dashboard)
        rows=self.rows(dashboard,widget)
        if not any(w['id'] == str(widget) for w in doc['widgets']) and not rows: raise HTTPException(404, 'Widget not found.')
        return [{'id': key, **value} for key, value in rows[1:]]

    def source_revision(self, identifier):
        state = self.editor.read(identifier)[0]
        path = self.d.analyst.root / (str(identifier) + '.duckdb')
        from .dataset_revisions import file_hash
        return {'number': state['version'], 'hash': file_hash(path)}

    def status(self, chart, check_slots=True):
        try:
            item = self.d.analyst.get_item(chart['dataset_id'])
            label = item.display_name or item.name
            source = {'display_name': label, 'original_name': item.name, 'label': label + (' · ' + item.name if label != item.name else ''), 'archived': bool(item.archived_at), 'deleted': False}
            if item.archived_at: return {**source, 'status': 'Source unavailable', 'reason': 'Archived dataset', 'can_refresh': False}
            dependencies = self.lifecycle.dependencies(chart['dataset_id'])
            blocked = dependencies['delete_blocked']
            if check_slots:
                available=self.d.analyst.slots.acquire(False)
                if available:self.d.analyst.slots.release()
                else:blocked=True
            revision = chart.get('source_revision')
            state = 'Revision not recorded' if not revision else 'Current' if revision == self.source_revision(chart['dataset_id']) else 'Source changed'
            return {**source, 'status': state, 'reason': 'A conflicting source job is running.' if blocked else None, 'can_refresh': not blocked}
        except HTTPException:
            return {'display_name': None, 'original_name': chart['dataset_name'], 'label': 'Deleted dataset (' + chart['dataset_name'] + ')', 'archived': False, 'deleted': True, 'status': 'Source unavailable', 'reason': 'Deleted dataset', 'can_refresh': False}

    def widget(self, dashboard, identifier):
        doc = self.d.store.get('Dashboard', dashboard)
        widget = next((w for w in doc['widgets'] if w['id'] == str(identifier) and w['kind'] == 'chart'), None)
        if widget is None: raise HTTPException(404, 'Chart widget not found.')
        return doc, widget

    def retain(self, session, dashboard, widget, previous, current, reason):
        rows = list(session.scalars(select(self.Model).where(self.Model.dashboard_id == str(dashboard), self.Model.widget_id == str(widget)).order_by(self.Model.generation.desc())))
        generation=max((r.generation for r in rows),default=-1)
        def insert(chart, cause):
            nonlocal generation
            generation+=1
            stamp = utcnow()
            row = self.Model(id=str(uuid4()), dashboard_id=str(dashboard), widget_id=str(widget), generation=generation, created_at=stamp,
                payload=json.dumps({'chart': chart, 'retained_at': stamp, 'reason': cause}, allow_nan=False))
            if len(row.payload.encode()) > 2*1024*1024: raise HTTPException(413, 'Snapshot exceeds the 2 MiB storage limit.')
            session.add(row)
            return row
        if not rows: rows = [insert(previous, 'initial snapshot')]
        latest = insert(current, reason)
        for old in rows[HISTORY_LIMIT:]: session.delete(old)
        return latest.id

    def save_document(self, session, doc):
        raw = json.dumps(doc, allow_nan=False)
        if len(raw.encode()) > 2*1024*1024: raise HTTPException(413, 'Dashboard exceeds 2 MiB.')
        row = session.get(self.d.store.models['Dashboard'], doc['id'])
        row.payload, row.updated_at = raw, doc['updated_at']

    def audit(self, session, chart, dashboard, widget, result, detail=None):
        session.add(self.lifecycle.Audit(id=str(uuid4()), dataset_id=chart['dataset_id'], action='dashboard_refresh', timestamp=utcnow(),
            result=result, actor='user_ui', reason=json.dumps({'source': 'user_ui', 'dashboard_id': str(dashboard), 'widget_id': str(widget), 'detail': detail})))

    def execute(self, chart):
        status = self.status(chart,check_slots=False)
        if not status['can_refresh']: raise HTTPException(409, status['reason'] or 'Source unavailable.')
        signature, profile = self.d.schema_signature(chart['dataset_id'])
        if signature != chart['schema_signature']: raise HTTPException(409, 'Source schema changed. Save a new Analyst result instead.')
        schema = {c['name']: chart['type_mapping'].get(c['name'], 'VARCHAR') for c in profile['columns']}
        sql = validate_sql(chart['sql'], schema)
        result = execute_isolated(self.d.analyst.root / (chart['dataset_id'] + '.duckdb'), sql, chart['type_mapping'])
        result.pop('executed_sql', None)
        # Preserve saved source-currency declarations; do not infer from current names.
        old_columns = self.d.display_snapshot(chart)['columns']
        for column, old in zip(result['columns'], old_columns):
            if column['name'] == old['name'] and old.get('money'): column['money'] = copy.deepcopy(old['money'])
            if column['name'] == old['name'] and old.get('percent'): column['percent'] = True
        updated = copy.deepcopy(chart)
        now = utcnow()
        updated.update(snapshot=result, data_as_of=now, source_revision=self.source_revision(chart['dataset_id']), refreshed_at=now,
            result_hash=digest(result), last_successful_refresh=now, updated_at=now, currency_metadata={},
            currency_metadata_provenance=copy.deepcopy(chart.get('currency_metadata_provenance')), status='refreshed', error=None,
            summary=[], narrative_source='computed after refresh')
        try: validate_chart(updated['spec'], result)
        except ValueError: updated['spec'] = {'kind': 'table', 'x': None, 'y': None, 'title': chart['title'], 'null_policy': 'omit_with_count', 'zero_baseline': True}
        return updated

    def refresh(self, dashboard, identifier, body):
        with self.lifecycle.admission_lock, self.d.lock, self.d.analyst.knowledge.lock:
            doc, widget = self.widget(dashboard, identifier)
            chart = self.effective(dashboard, widget)
            if body.revision is not None and doc['revision'] != body.revision: raise HTTPException(409, 'Dashboard changed. Reload before refreshing.')
            if body.expected_result_hash and body.expected_result_hash != (chart.get('result_hash') or digest(chart['snapshot'])): raise HTTPException(409, 'Snapshot changed. Review it before refreshing.')
            if not self.d.analyst.slots.acquire(False): raise HTTPException(429, 'Query execution slots are busy.')
            try:
                current = self.execute(chart)
                doc['revision'] += 1; doc['updated_at'] = utcnow()
                with Session(self.engine) as session:
                    self.retain(session, dashboard, identifier, chart, current, 'refresh')
                    self.save_document(session, doc)
                    self.audit(session, current, dashboard, identifier, 'success')
                    session.commit()
            except (HTTPException, ExecutionError, GuardError) as exc:
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                with Session(self.engine) as session:
                    self.audit(session, chart, dashboard, identifier, 'blocked' if isinstance(exc, HTTPException) else 'failed', str(detail)); session.commit()
                raise HTTPException(exc.status_code if isinstance(exc, HTTPException) else 422, detail) from exc
            finally: self.d.analyst.slots.release()
        return self.d.view(dashboard)

    def attach(self, dashboard, body):
        with self.lifecycle.admission_lock, self.d.lock, self.d.analyst.knowledge.lock:
            doc = self.d.store.get('Dashboard', dashboard)
            if doc['revision'] != body.revision: raise HTTPException(409, 'Dashboard changed. Reload before adding.')
            chart = self.d.store.get('SavedChart', body.chart_id)
            item = self.d.analyst.get_item(chart['dataset_id'])
            if item.archived_at: raise HTTPException(409, 'Restore this archived dataset before adding new charts.')
            matches = [w for w in doc['widgets'] if w['kind']=='chart' and duplicate_key(self.effective(dashboard,w), w.get('spec')) == duplicate_key(chart)]
            if matches and body.duplicate_action == 'cancel':
                return {'duplicate': True, 'matches': [w['id'] for w in matches], 'dashboard': self.d.view(dashboard)}
            if body.duplicate_action == 'replace':
                widget = next((w for w in matches if w['id'] == str(body.replace_widget_id)), None)
                if widget is None: raise HTTPException(409, 'Choose a matching chart to replace.')
                previous = self.effective(dashboard, widget)
                widget['chart_id'], widget['spec'] = chart['id'], None
            else:
                if len(doc['widgets']) >= 24: raise HTTPException(409, 'Maximum 24 dashboard widgets.')
                widget = dict(id=str(uuid4()), chart_id=chart['id'], kind='chart', title=chart['title'], text='', spec=None, filters=[], width=6, height=4)
                doc['widgets'].append(widget); previous = None
            doc['revision'] += 1; doc['updated_at'] = utcnow()
            with Session(self.engine) as session:
                if previous: self.retain(session, dashboard, widget['id'], previous, chart, 'confirmed replacement')
                self.save_document(session, doc); session.commit()
            return {'duplicate': False, 'matches': [], 'dashboard': self.d.view(dashboard)}

    def clone(self, old_dashboard, old_widget, new_dashboard, new_widget):
        rows=self.rows(old_dashboard,old_widget)
        if rows:
            with Session(self.engine) as session:
                session.add(self.Model(id=str(uuid4()),dashboard_id=str(new_dashboard),widget_id=str(new_widget),generation=0,created_at=utcnow(),payload=json.dumps(rows[0][1])))
                session.commit()

    def router(self):
        router = APIRouter(prefix='/api/dashboards', tags=['Dashboard workspace'])
        @router.patch('/{dashboard}/widgets/{identifier}/title')
        def rename(dashboard: UUID, identifier: UUID, body: TitleInput):
            with self.d.lock:
                doc, widget = self.widget(dashboard, identifier)
                if doc['revision'] != body.revision: raise HTTPException(409, 'Dashboard changed. Reload before editing.')
                try: widget['custom_title'] = title(body.title) if body.title is not None else None
                except ValueError as exc: raise HTTPException(422, str(exc)) from exc
                doc['revision'] += 1; doc['updated_at'] = utcnow(); self.d.store.save('Dashboard', doc)
            return self.d.view(dashboard)
        @router.post('/{dashboard}/charts')
        def attach(dashboard: UUID, body: Attach): return self.attach(dashboard, body)
        @router.post('/{dashboard}/widgets/{identifier}/refresh')
        def refresh(dashboard: UUID, identifier: UUID, body: Refresh): return self.refresh(dashboard, identifier, body)
        @router.post('/{dashboard}/refresh-all')
        def refresh_all(dashboard: UUID, body: Refresh):
            doc = self.d.store.get('Dashboard', dashboard)
            if body.revision is not None and body.revision != doc['revision']: raise HTTPException(409, 'Dashboard changed. Review it before refreshing.')
            results=[]
            for widget in doc['widgets']:
                if widget['kind']!='chart': continue
                try:
                    self.refresh(dashboard, widget['id'], Refresh(confirm_refresh=True))
                    results.append({'id': widget['id'], 'status':'success', 'error':None})
                except HTTPException as exc: results.append({'id':widget['id'],'status':'failed','error':str(exc.detail)})
            return {'results':results,'dashboard':self.d.view(dashboard)}
        @router.post('/{dashboard}/widgets/{identifier}/duplicate')
        def duplicate_widget(dashboard: UUID, identifier: UUID):
            with self.d.lock:
                doc,widget=self.widget(dashboard,identifier)
                if len(doc['widgets'])>=24:raise HTTPException(409,'Maximum 24 dashboard widgets.')
                new=copy.deepcopy(widget);new['id']=str(uuid4());doc['widgets'].append(new)
                doc['revision']+=1;doc['updated_at']=utcnow();self.d.store.save('Dashboard',doc)
                self.clone(dashboard,identifier,dashboard,new['id'])
            return self.d.view(dashboard)
        @router.get('/{dashboard}/widgets/{identifier}/history')
        def history(dashboard: UUID, identifier: UUID): return {'limit':HISTORY_LIMIT,'snapshots':self.history(dashboard, identifier)}
        return router
