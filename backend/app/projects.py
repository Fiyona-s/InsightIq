"""Stage 2: Projects (business workspaces).

Design ("virtual Default", docs/AUDIT.md §f):
- Two NEW additive tables: `projects` and `project_items`. No existing table or row is rewritten.
- Anything without a `project_items` row belongs to the Default project. Default needs no row;
  a row with id 'default' is written only if the owner renames it.
- Only top-level items get mapping rows: datasets and dashboards (dashboards can mix datasets).
  Everything else that hangs off a dataset (questions/runs, saved charts, experiments, models,
  predictions, knowledge, suggestions, retrieval, revisions/audit) follows its dataset's project.
  Mapping rows for deleted datasets are kept, so history stays in its project.
- The installed test benchmark is Admin-only and outside owner projects; it stays reachable from
  any project so the Admin accuracy check keeps working (owner views already hide it).

Projects organise data; they are NOT access control (no login; any local client can choose any project).
Scope is applied in one middleware (no Rule 3 file is modified): the active project comes
from the `X-InsightIQ-Project` header or the `insightiq_project` cookie (default: Default).
"""
import json
import re
import shutil
import sqlite3
from contextvars import ContextVar
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, String, Text, and_, delete, func, inspect, select
from sqlalchemy.orm import Session

from .persistence import utcnow

DEFAULT = 'default'
DEFAULT_NAME = 'Default project'
COOKIE = 'insightiq_project'
HEADER = 'x-insightiq-project'
CURRENT: ContextVar[str] = ContextVar('insightiq_project', default=DEFAULT)
ITEM_TYPES = ('dataset', 'dashboard')


def register(base):
    class Project(base):
        __tablename__ = 'projects'
        id = Column(String(36), primary_key=True)
        name = Column(Text, nullable=False)
        created_at = Column(String(40), nullable=False)
        updated_at = Column(String(40), nullable=False)
        archived_at = Column(String(40), nullable=True)

    class ProjectItem(base):
        __tablename__ = 'project_items'
        item_type = Column(String(20), primary_key=True)
        item_id = Column(String(36), primary_key=True)
        project_id = Column(String(36), nullable=False, index=True)
        added_at = Column(String(40), nullable=False)
    return Project, ProjectItem


def migrate(engine, root, models):
    """Additive: create both tables once, after a full storage + consistent SQLite backup."""
    if all(inspect(engine).has_table(m.__tablename__) for m in models):
        return
    if inspect(engine).has_table('datasets'):
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Projects migration requires a verified SQLite backup before DDL.')
        folder = Path(root) / 'backups' / ('projects-v11-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    for model in models:
        model.__table__.create(engine, checkfirst=True)


class NameRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=80)


class DeleteRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirm_name: str


UUID_RE = r'[0-9a-fA-F-]{36}'


class Projects:
    def __init__(self, engine, dataset_model, run_model, store, benchmark_model):
        self.engine, self.Dataset, self.Run, self.store, self.Benchmark = engine, dataset_model, run_model, store, benchmark_model
        self.Project = self.Item = None

    def bind(self, project_model, item_model):
        self.Project, self.Item = project_model, item_model

    # ---------- projects ----------
    def _row(self, session, identifier):
        return session.get(self.Project, identifier)

    def view(self, identifier, row=None):
        if identifier == DEFAULT:
            name = row.name if row else DEFAULT_NAME
            return {'id': DEFAULT, 'name': name, 'is_default': True, 'archived_at': None,
                    'created_at': row.created_at if row else None}
        return {'id': row.id, 'name': row.name, 'is_default': False, 'archived_at': row.archived_at, 'created_at': row.created_at}

    def list(self):
        with Session(self.engine) as session:
            rows = {r.id: r for r in session.scalars(select(self.Project).order_by(self.Project.created_at))}
        out = [self.view(DEFAULT, rows.pop(DEFAULT, None))]
        return out + [self.view(r.id, r) for r in rows.values()]

    def get(self, identifier):
        with Session(self.engine) as session:
            row = self._row(session, identifier)
            if identifier == DEFAULT:
                return self.view(DEFAULT, row)
            if row is None:
                raise HTTPException(404, 'Project not found.')
            return self.view(identifier, row)

    def _unique(self, session, name, exclude=None):
        clean = ' '.join(name.split())
        if not clean or any(ord(c) < 32 for c in clean):
            raise HTTPException(422, 'Use a project name of 1 to 80 visible characters.')
        taken = {(r.name or '').casefold() for r in session.scalars(select(self.Project)) if r.id != exclude}
        if exclude != DEFAULT and DEFAULT not in {r.id for r in session.scalars(select(self.Project))}:
            taken.add(DEFAULT_NAME.casefold())
        if clean.casefold() in taken:
            raise HTTPException(409, 'A project with this name already exists.')
        return clean

    def create(self, name):
        with Session(self.engine) as session:
            clean = self._unique(session, name)
            stamp = utcnow()
            row = self.Project(id=str(uuid4()), name=clean, created_at=stamp, updated_at=stamp, archived_at=None)
            session.add(row); session.commit()
            return self.view(row.id, row)

    def rename(self, identifier, name):
        with Session(self.engine) as session:
            row = self._row(session, identifier)
            if row is None and identifier != DEFAULT:
                raise HTTPException(404, 'Project not found.')
            clean = self._unique(session, name, exclude=identifier)
            stamp = utcnow()
            if row is None:  # first rename of the virtual Default project
                row = self.Project(id=DEFAULT, name=clean, created_at=stamp, updated_at=stamp, archived_at=None)
                session.add(row)
            else:
                row.name, row.updated_at = clean, stamp
            session.commit()
            return self.view(identifier, row)

    def set_archived(self, identifier, archived):
        if identifier == DEFAULT:
            raise HTTPException(409, 'The Default project cannot be archived.')
        with Session(self.engine) as session:
            row = self._row(session, identifier)
            if row is None:
                raise HTTPException(404, 'Project not found.')
            row.archived_at = utcnow() if archived else None
            row.updated_at = utcnow(); session.commit()
            return self.view(identifier, row)

    def delete(self, identifier, confirm_name):
        """Removes the project only. Its items move back to the Default project; no data is deleted."""
        if identifier == DEFAULT:
            raise HTTPException(409, 'The Default project cannot be deleted.')
        with Session(self.engine) as session:
            row = self._row(session, identifier)
            if row is None:
                raise HTTPException(404, 'Project not found.')
            if confirm_name != row.name:
                raise HTTPException(422, 'Type the project name exactly to confirm.')
            moved = session.scalar(select(func.count()).select_from(self.Item).where(self.Item.project_id == identifier)) or 0
            session.execute(delete(self.Item).where(self.Item.project_id == identifier))
            session.delete(row); session.commit()
        return {'deleted': identifier, 'items_moved_to_default': moved}

    def dependencies(self, identifier):
        self.get(identifier)
        datasets = self.dataset_ids(identifier, include_benchmark=False)
        with Session(self.engine) as session:
            live = set(session.scalars(select(self.Dataset.id).where(self.Dataset.id.in_(datasets)))) if datasets else set()
            archived = set(session.scalars(select(self.Dataset.id).where(self.Dataset.id.in_(datasets), self.Dataset.archived_at.is_not(None)))) if datasets else set()
            runs = session.scalar(select(func.count()).select_from(self.Run).where(self.Run.dataset_id.in_(datasets))) if datasets else 0
            counts = {'datasets': len(live - archived), 'archived_datasets': len(archived), 'dashboards': len(self.dashboard_ids(identifier)), 'questions': runs or 0}
            for kind, label in (('SavedChart', 'saved_charts'), ('MLExperiment', 'experiments'), ('MLModel', 'models')):
                model = self.store.models[kind]
                counts[label] = (session.scalar(select(func.count()).select_from(model).where(model.dataset_id.in_(datasets))) or 0) if datasets else 0
        return {'project': self.get(identifier), 'counts': counts,
                'on_delete': 'The project is removed. Its datasets, dashboards and history move to the Default project. No data is deleted.'}

    # ---------- membership ----------
    def benchmark_ids(self, session):
        return {str(x) for x in session.scalars(select(self.Benchmark.dataset_id)) if x}

    def mapped(self, session, item_type):
        return {r.item_id: r.project_id for r in session.scalars(select(self.Item).where(self.Item.item_type == item_type))}

    def dataset_ids(self, project=None, include_benchmark=True):
        """Dataset ids in a project, including deleted datasets whose mapping row remains."""
        project = project or CURRENT.get()
        with Session(self.engine) as session:
            mapped = self.mapped(session, 'dataset')
            bench = self.benchmark_ids(session) if include_benchmark else set()
            if project == DEFAULT:
                existing = set(session.scalars(select(self.Dataset.id)))
                referenced = set(session.scalars(select(self.Run.dataset_id).distinct()))
                ids = {i for i in existing | referenced if i and mapped.get(i, DEFAULT) == DEFAULT}
                ids -= set() if include_benchmark else self.benchmark_ids(session)
                return ids | bench
            return {i for i, p in mapped.items() if p == project} | bench

    def dataset_project(self, dataset_id):
        with Session(self.engine) as session:
            if str(dataset_id) in self.benchmark_ids(session):
                return None  # benchmark: reachable from every project
            row = session.get(self.Item, ('dataset', str(dataset_id)))
            return row.project_id if row else DEFAULT

    def dataset_visible(self, dataset_id, project=None):
        owner = self.dataset_project(dataset_id)
        return owner is None or owner == (project or CURRENT.get())

    def dashboard_ids(self, project=None):
        project = project or CURRENT.get()
        with Session(self.engine) as session:
            mapped = self.mapped(session, 'dashboard')
            all_ids = set(session.scalars(select(self.store.models['Dashboard'].id)))
        return {i for i in all_ids if mapped.get(i, DEFAULT) == project}

    def dashboard_visible(self, identifier, project=None):
        with Session(self.engine) as session:
            row = session.get(self.Item, ('dashboard', str(identifier)))
        return (row.project_id if row else DEFAULT) == (project or CURRENT.get())

    def assign(self, item_type, item_id, project=None):
        project = project or CURRENT.get()
        if project == DEFAULT:
            return  # virtual Default: unmapped means Default
        with Session(self.engine) as session:
            session.merge(self.Item(item_type=item_type, item_id=str(item_id), project_id=project, added_at=utcnow()))
            session.commit()

    def dataset_clause(self, column, project=None):
        """SQL condition limiting a dataset_id column to the active project."""
        project = project or CURRENT.get()
        with Session(self.engine) as session:
            mapped = self.mapped(session, 'dataset')
            bench = self.benchmark_ids(session)
        if project == DEFAULT:
            elsewhere = [i for i, p in mapped.items() if p != DEFAULT and i not in bench]
            return column.notin_(elsewhere) if elsewhere else column.is_not(None) | column.is_(None)
        return column.in_([i for i, p in mapped.items() if p == project] + list(bench))

    def document_dataset(self, kind, identifier):
        with Session(self.engine) as session:
            row = session.get(self.store.models[kind], str(identifier))
            if row is None:
                return None, None
            payload = json.loads(row.payload)
        if kind == 'MLPrediction':
            model = self.store.get('MLModel', payload['model_id']) if payload.get('model_id') else None
            return True, (model or {}).get('dataset_id')
        return True, payload.get('dataset_id') or row.dataset_id

    def run_dataset(self, identifier):
        with Session(self.engine) as session:
            row = session.get(self.Run, str(identifier))
            return (True, row.dataset_id) if row else (None, None)

    # ---------- HTTP ----------
    def router(self):
        api = APIRouter(prefix='/api/projects', tags=['Projects'])

        @api.get('')
        def listing():
            return self.list()

        @api.post('', status_code=201)
        def create(body: NameRequest):
            return self.create(body.name)

        @api.patch('/{identifier}')
        def rename(identifier: str, body: NameRequest):
            return self.rename(self.identifier(identifier), body.name)

        @api.post('/{identifier}/archive')
        def archive(identifier: str):
            return self.set_archived(self.identifier(identifier), True)

        @api.post('/{identifier}/restore')
        def restore(identifier: str):
            return self.set_archived(self.identifier(identifier), False)

        @api.get('/{identifier}/dependencies')
        def dependencies(identifier: str):
            return self.dependencies(self.identifier(identifier))

        @api.delete('/{identifier}')
        def remove(identifier: str, body: DeleteRequest):
            return self.delete(self.identifier(identifier), body.confirm_name)
        return api

    @staticmethod
    def identifier(value):
        if value == DEFAULT:
            return DEFAULT
        try:
            return str(UUID(value))
        except ValueError as exc:
            raise HTTPException(404, 'Project not found.') from exc

    def requested(self, request):
        raw = request.headers.get(HEADER) or request.cookies.get(COOKIE) or DEFAULT
        return DEFAULT if raw == DEFAULT else self.identifier(raw)

    # Paths that are global by design (projects themselves, Admin accuracy check, health, FX rates).
    EXEMPT = re.compile(r'^/api/(projects|health|benchmarks|evaluations|currency|auth|users|audit-events)(/|$)')
    PATHS = [
        (re.compile(rf'^/api/(?:automl/)?datasets/({UUID_RE})(?:/|$)'), 'dataset'),
        (re.compile(rf'^/api/analyst/runs/({UUID_RE})(?:/|$)'), 'run'),
        (re.compile(rf'^/api/saved-charts/({UUID_RE})(?:/|$)'), 'SavedChart'),
        (re.compile(rf'^/api/dashboards/({UUID_RE})(?:/|$)'), 'dashboard'),
        (re.compile(rf'^/api/automl/experiments/({UUID_RE})(?:/|$)'), 'MLExperiment'),
        (re.compile(rf'^/api/automl/models/({UUID_RE})(?:/|$)'), 'MLModel'),
        (re.compile(rf'^/api/automl/predictions/({UUID_RE})(?:/|$)'), 'MLPrediction'),
    ]
    LIST_FILTERS = {'/api/automl/experiments': 'dataset', '/api/automl/models': 'dataset', '/api/automl/predictions': 'prediction'}

    def visible(self, kind, identifier):
        """None = item does not exist (let the endpoint answer); True/False = in the active project."""
        if kind == 'dataset':
            return self.dataset_visible(identifier)
        if kind == 'dashboard':
            with Session(self.engine) as session:
                exists = session.get(self.store.models['Dashboard'], str(identifier)) is not None
            return self.dashboard_visible(identifier) if exists else None
        found, dataset = self.run_dataset(identifier) if kind == 'run' else self.document_dataset(kind, identifier)
        if not found:
            return None
        return True if dataset is None else self.dataset_visible(dataset)

    def body_references(self, path, data):
        refs = []
        def walk(node, depth=0):
            if depth > 2 or not isinstance(node, dict):
                return
            for key, value in node.items():
                if key in ('dataset_id', 'source_dataset_id', 'batch_dataset_id') and isinstance(value, str):
                    refs.append(('dataset', value))
                elif key == 'run_id' and isinstance(value, str):
                    refs.append(('run', value))
                elif key == 'chart_id' and isinstance(value, str):
                    refs.append(('SavedChart', value))
                elif isinstance(value, dict):
                    walk(value, depth + 1)
        walk(data)
        if path.startswith('/api/datasets/bulk-') and isinstance(data, dict):
            for value in data.get('ids', []) or []:
                refs.append(('dataset', str(value)))
            for item in data.get('items', []) or []:
                if isinstance(item, dict) and item.get('id'):
                    refs.append(('dataset', str(item['id'])))
        return refs

    async def middleware(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith('/api/'):
            return await call_next(request)
        try:
            project = self.requested(request)
        except HTTPException:
            return JSONResponse({'detail': 'Project not found. Choose a project again.'}, status_code=404)
        if project != DEFAULT:
            with Session(self.engine) as session:
                row = session.get(self.Project, project)
            if row is None:
                return JSONResponse({'detail': 'Project not found. Choose a project again.'}, status_code=404)
            if row.archived_at and not path.startswith('/api/projects'):
                return JSONResponse({'detail': 'This project is archived. Restore it or choose another project.'}, status_code=409)
        # Global Admin endpoints (benchmark, accuracy check) never assign what they create to an
        # owner project, so the test benchmark stays outside every project.
        token = CURRENT.set(DEFAULT if self.EXEMPT.match(path) else project)
        try:
            if not self.EXEMPT.match(path):
                for pattern, kind in self.PATHS:
                    match = pattern.match(path)
                    if match and self.visible(kind, match.group(1)) is False:
                        return JSONResponse({'detail': 'Not found in this project.'}, status_code=404)
                if request.method in ('POST', 'PUT', 'PATCH') and 'json' in request.headers.get('content-type', ''):
                    raw = await request.body()
                    try:
                        data = json.loads(raw) if raw else None
                    except ValueError:
                        data = None
                    for kind, identifier in self.body_references(path, data):
                        try:
                            ok = self.visible(kind, str(UUID(identifier)))
                        except ValueError:
                            continue
                        if ok is False:
                            return JSONResponse({'detail': 'That item belongs to a different project.'}, status_code=404)
            response = await call_next(request)
            if request.method == 'GET' and path in self.LIST_FILTERS and response.status_code == 200:
                body = b''.join([chunk async for chunk in response.body_iterator])
                items = json.loads(body)
                if self.LIST_FILTERS[path] == 'prediction':
                    keep = [i for i in items if self.visible('MLPrediction', i['id']) is not False]
                else:
                    keep = [i for i in items if not i.get('dataset_id') or self.dataset_visible(i['dataset_id'])]
                headers = {k: v for k, v in response.headers.items() if k.lower() not in ('content-length', 'content-type')}
                return JSONResponse(keep, status_code=200, headers=headers)
            return response
        finally:
            CURRENT.reset(token)


# ---------- Route classification (single source of truth; enforced by tests) ----------
# Every API route must appear here. Categories:
#   path    - scoped by the middleware's path guard (the id in the path must be in the active project)
#   list    - list/aggregate filtered to the active project (in code or by the middleware)
#   create  - creates an item in the active project (dataset/dashboard mapping, or inherits via its dataset)
#   body    - scoped by checking ids referenced in the JSON body (dataset_id, run_id, chart_id, bulk ids)
#   global  - deliberately not project-scoped; the reason is given
ROUTE_SCOPES = {
    # Datasets and their sub-resources
    'GET /api/auth/status': 'global:authentication (A1)', 'POST /api/auth/login': 'global:authentication (A1)', 'POST /api/auth/logout': 'global:authentication (A1)', 'GET /api/auth/me': 'global:authentication (A1)', 'POST /api/auth/change-password': 'global:authentication (A3)',
    'POST /api/auth/redeem': 'global:one-time link (A4)', 'POST /api/auth/two-step/start': 'global:second step (A4)', 'POST /api/auth/two-step/confirm': 'global:second step (A4)',
    'GET /api/users': 'global:people (A4)', 'POST /api/users': 'global:people (A4)', 'PATCH /api/users/{user_id}': 'global:people (A4)',
    'POST /api/users/{user_id}/unlock': 'global:people (A4)', 'POST /api/users/{user_id}/reset-link': 'global:people (A4)', 'GET /api/audit-events': 'global:security log (A4)',
    'GET /api/datasets': 'list', 'GET /api/datasets/references': 'list', 'POST /api/datasets': 'create',
    'POST /api/datasets/bulk-archive': 'body', 'POST /api/datasets/bulk-delete': 'body', 'POST /api/datasets/bulk-sample': 'body',
    'PUT /api/datasets/{dataset_id}/sample': 'path',
    'GET /api/datasets/{dataset_id}': 'path', 'DELETE /api/datasets/{dataset_id}': 'path',
    'GET /api/datasets/{dataset_id}/confirmed-types': 'path', 'PUT /api/datasets/{dataset_id}/confirmed-types': 'path', 'DELETE /api/datasets/{dataset_id}/confirmed-types': 'path',
    'GET /api/datasets/{dataset_id}/export': 'path', 'GET /api/datasets/{dataset_id}/preview': 'path', 'GET /api/datasets/{dataset_id}/profile': 'path',
    'GET /api/datasets/{dataset_id}/rows': 'path', 'GET /api/datasets/{dataset_id}/version': 'path',
    'POST /api/datasets/{dataset_id}/edits': 'path', 'POST /api/datasets/{dataset_id}/edits/validate': 'path',
    'GET /api/datasets/{identifier}/dependencies': 'path', 'GET /api/datasets/{identifier}/profile-details': 'path', 'GET /api/datasets/{identifier}/quality': 'path',
    'GET /api/datasets/{identifier}/revisions': 'path', 'GET /api/datasets/{identifier}/revisions/{revision}/preview': 'path', 'POST /api/datasets/{identifier}/revisions/{revision}/restore': 'path',
    'POST /api/datasets/{identifier}/leakage-check': 'path', 'GET /api/datasets/{identifier}/suggested-questions': 'path', 'PATCH /api/datasets/{identifier}': 'path', 'PATCH /api/datasets/{identifier}/column-description': 'path',
    'POST /api/datasets/{identifier}/archive': 'path', 'POST /api/datasets/{identifier}/restore': 'path',
    # Knowledge (business definitions), review and retrieval (RAG)
    'GET /api/datasets/{dataset_id}/knowledge': 'path', 'PUT /api/datasets/{dataset_id}/knowledge': 'path', 'GET /api/datasets/{dataset_id}/knowledge/review': 'path',
    'POST /api/datasets/{dataset_id}/knowledge/retrieve': 'path', 'POST /api/datasets/{dataset_id}/knowledge/reindex': 'path', 'POST /api/datasets/{dataset_id}/knowledge/examples': 'path',
    'POST /api/datasets/{dataset_id}/knowledge/drafts': 'path', 'POST /api/datasets/{dataset_id}/knowledge/drafts/approve-all': 'path', 'POST /api/datasets/{dataset_id}/knowledge/drafts/clear-rejected': 'path',
    'PATCH /api/datasets/{dataset_id}/knowledge/drafts/{entry_id}': 'path', 'POST /api/datasets/{dataset_id}/knowledge/candidates': 'path',
    'POST /api/datasets/{dataset_id}/knowledge/candidates/{entry_id}/approve': 'path', 'POST /api/datasets/{dataset_id}/knowledge/candidates/{entry_id}/check': 'path',
    'DELETE /api/datasets/{dataset_id}/knowledge/candidates/{entry_id}': 'path', 'POST /api/datasets/{dataset_id}/knowledge/legacy/{entry_id}/reverify': 'path',
    # Questions (runs), feedback, analytics/traces
    'GET /api/analyst/runs': 'list', 'POST /api/analyst/runs': 'body',
    'GET /api/analyst/runs/{run_id}': 'path', 'POST /api/analyst/runs/{run_id}/rerun': 'path', 'DELETE /api/analyst/runs/{run_id}': 'path', 'GET /api/analyst/runs/{run_id}/analysis': 'path', 'GET /api/analyst/runs/{run_id}/events': 'path',
    'GET /api/analyst/runs/{run_id}/results': 'path', 'GET /api/analyst/runs/{run_id}/results.csv': 'path', 'POST /api/analyst/runs/{run_id}/chart': 'path',
    'GET /api/analyst/runs/{identifier}/feedback': 'path', 'PUT /api/analyst/runs/{identifier}/feedback': 'path',
    'GET /api/analytics/runs': 'list',
    # Dashboards, widgets, reports, saved charts
    'GET /api/dashboards': 'list', 'POST /api/dashboards': 'create',
    'GET /api/dashboards/{identifier}': 'path', 'PUT /api/dashboards/{identifier}': 'path', 'DELETE /api/dashboards/{identifier}': 'path', 'POST /api/dashboards/{identifier}/duplicate': 'path',
    'GET /api/dashboards/{identifier}/report.json': 'path', 'GET /api/dashboards/{identifier}/report.pdf': 'path', 'GET /api/dashboards/{identifier}/widgets/{widget_id}/results.csv': 'path',
    'POST /api/dashboards/{dashboard}/charts': 'path', 'POST /api/dashboards/{dashboard}/refresh-all': 'path', 'GET /api/dashboards/{dashboard}/widgets/{identifier}/history': 'path',
    'PATCH /api/dashboards/{dashboard}/widgets/{identifier}/title': 'path', 'POST /api/dashboards/{dashboard}/widgets/{identifier}/duplicate': 'path', 'POST /api/dashboards/{dashboard}/widgets/{identifier}/refresh': 'path',
    'GET /api/saved-charts': 'list', 'POST /api/saved-charts': 'body',
    'GET /api/saved-charts/{identifier}': 'path', 'DELETE /api/saved-charts/{identifier}': 'path', 'GET /api/saved-charts/{identifier}/history': 'path',
    'POST /api/saved-charts/{identifier}/refresh': 'path', 'POST /api/saved-charts/{identifier}/currency-metadata': 'path',
    # Predictions (AutoML is a Rule 3 module: scoped by the middleware only, never edited)
    'GET /api/automl/experiments': 'list', 'GET /api/automl/models': 'list', 'GET /api/automl/predictions': 'list',
    'POST /api/automl/experiments': 'body', 'POST /api/automl/validate-configuration': 'body',
    'GET /api/automl/datasets/{identifier}/profile': 'path',
    'GET /api/automl/experiments/{identifier}': 'path', 'DELETE /api/automl/experiments/{identifier}': 'path', 'POST /api/automl/experiments/{identifier}/cancel': 'path',
    'GET /api/automl/models/{identifier}': 'path', 'GET /api/automl/models/{identifier}/input-schema': 'path',
    'POST /api/automl/models/{identifier}/predict': 'path', 'POST /api/automl/models/{identifier}/validate-input': 'path',
    'GET /api/automl/predictions/{identifier}': 'path', 'DELETE /api/automl/predictions/{identifier}': 'path', 'GET /api/automl/predictions/{identifier}/export.csv': 'path',
    # Global by design
    'GET /api/health': 'global:liveness probe, no data',
    'GET /api/currency/status': 'global:FX provider status, no business data',
    'POST /api/currency/convert': 'global:converts a value with daily reference rates; reads no dataset',
    'GET /api/projects': 'global:project management', 'POST /api/projects': 'global:project management',
    'PATCH /api/projects/{identifier}': 'global:project management', 'DELETE /api/projects/{identifier}': 'global:project management',
    'POST /api/projects/{identifier}/archive': 'global:project management', 'POST /api/projects/{identifier}/restore': 'global:project management',
    'GET /api/projects/{identifier}/dependencies': 'global:project management',
    'GET /api/benchmarks': 'global:Admin test benchmark, outside owner projects',
    'POST /api/benchmarks/retail-v1/install': 'global:Admin test benchmark, outside owner projects',
    'POST /api/benchmarks/retail-v1/verify': 'global:Admin test benchmark, outside owner projects',
    'GET /api/evaluations': 'global:Admin accuracy check on the benchmark', 'POST /api/evaluations': 'global:Admin accuracy check on the benchmark',
    'POST /api/evaluations/offline': 'global:Admin accuracy check on the benchmark',
    'GET /api/evaluations/{identifier}': 'global:Admin accuracy check on the benchmark', 'DELETE /api/evaluations/{identifier}': 'global:Admin accuracy check on the benchmark',
    'DELETE /api/evaluations/{identifier}/record': 'global:Admin accuracy check on the benchmark',
    'GET /api/evaluations/{identifier}/presentation': 'global:Admin accuracy check on the benchmark',
    'GET /api/evaluations/{identifier}/report.csv': 'global:Admin accuracy check on the benchmark',
    'GET /api/evaluations/{identifier}/report.json': 'global:Admin accuracy check on the benchmark',
    'PUT /api/evaluations/{identifier}/cases/{case_id}/review': 'global:Admin accuracy check on the benchmark',
}

# Accounts A2: the minimum role for every route, enforced when AUTH_MODE=on (default deny: a route missing here is refused).
# public = no session; viewer < analyst < owner; operator = not served at all in hosted mode (404 for everyone).
ROUTE_ACCESS = {
    # /api/auth
    'GET /api/auth/status': 'public',
    'POST /api/auth/login': 'public',
    'POST /api/auth/logout': 'viewer',
    'GET /api/auth/me': 'viewer',
    'POST /api/auth/change-password': 'viewer',
    'POST /api/auth/redeem': 'public',
    'POST /api/auth/two-step/start': 'viewer',
    'POST /api/auth/two-step/confirm': 'viewer',
    # /api/users, /api/audit-events (A4: owner only)
    'GET /api/users': 'owner',
    'POST /api/users': 'owner',
    'PATCH /api/users/{user_id}': 'owner',
    'POST /api/users/{user_id}/unlock': 'owner',
    'POST /api/users/{user_id}/reset-link': 'owner',
    'GET /api/audit-events': 'owner',
    # /api/datasets
    'GET /api/datasets': 'analyst',
    'GET /api/datasets/references': 'viewer',
    'POST /api/datasets': 'analyst',
    'POST /api/datasets/bulk-archive': 'analyst',
    'POST /api/datasets/bulk-delete': 'owner',
    'POST /api/datasets/bulk-sample': 'analyst',
    'PUT /api/datasets/{dataset_id}/sample': 'analyst',
    'GET /api/datasets/{dataset_id}': 'analyst',
    'DELETE /api/datasets/{dataset_id}': 'owner',
    'GET /api/datasets/{dataset_id}/confirmed-types': 'analyst',
    'PUT /api/datasets/{dataset_id}/confirmed-types': 'analyst',
    'DELETE /api/datasets/{dataset_id}/confirmed-types': 'analyst',
    'GET /api/datasets/{dataset_id}/export': 'analyst',
    'GET /api/datasets/{dataset_id}/preview': 'analyst',
    'GET /api/datasets/{dataset_id}/profile': 'analyst',
    'GET /api/datasets/{dataset_id}/rows': 'analyst',
    'GET /api/datasets/{dataset_id}/version': 'analyst',
    'POST /api/datasets/{dataset_id}/edits': 'analyst',
    'POST /api/datasets/{dataset_id}/edits/validate': 'analyst',
    'GET /api/datasets/{identifier}/dependencies': 'analyst',
    'GET /api/datasets/{identifier}/profile-details': 'analyst',
    'GET /api/datasets/{identifier}/quality': 'analyst',
    'GET /api/datasets/{identifier}/revisions': 'analyst',
    'GET /api/datasets/{identifier}/revisions/{revision}/preview': 'analyst',
    'POST /api/datasets/{identifier}/revisions/{revision}/restore': 'analyst',
    'POST /api/datasets/{identifier}/leakage-check': 'analyst',
    'GET /api/datasets/{identifier}/suggested-questions': 'analyst',
    'PATCH /api/datasets/{identifier}': 'analyst',
    'PATCH /api/datasets/{identifier}/column-description': 'analyst',
    'POST /api/datasets/{identifier}/archive': 'analyst',
    'POST /api/datasets/{identifier}/restore': 'analyst',
    'GET /api/datasets/{dataset_id}/knowledge': 'analyst',
    'PUT /api/datasets/{dataset_id}/knowledge': 'analyst',
    'GET /api/datasets/{dataset_id}/knowledge/review': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/retrieve': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/reindex': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/examples': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/drafts': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/drafts/approve-all': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/drafts/clear-rejected': 'analyst',
    'PATCH /api/datasets/{dataset_id}/knowledge/drafts/{entry_id}': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/candidates': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/candidates/{entry_id}/approve': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/candidates/{entry_id}/check': 'analyst',
    'DELETE /api/datasets/{dataset_id}/knowledge/candidates/{entry_id}': 'analyst',
    'POST /api/datasets/{dataset_id}/knowledge/legacy/{entry_id}/reverify': 'analyst',
    # /api/analyst
    'GET /api/analyst/runs': 'analyst',
    'POST /api/analyst/runs': 'analyst',
    'GET /api/analyst/runs/{run_id}': 'analyst',
    'POST /api/analyst/runs/{run_id}/rerun': 'analyst',
    'DELETE /api/analyst/runs/{run_id}': 'analyst',
    'GET /api/analyst/runs/{run_id}/analysis': 'analyst',
    'GET /api/analyst/runs/{run_id}/events': 'analyst',
    'GET /api/analyst/runs/{run_id}/results': 'analyst',
    'GET /api/analyst/runs/{run_id}/results.csv': 'analyst',
    'POST /api/analyst/runs/{run_id}/chart': 'analyst',
    'GET /api/analyst/runs/{identifier}/feedback': 'analyst',
    'PUT /api/analyst/runs/{identifier}/feedback': 'analyst',
    # /api/analytics
    'GET /api/analytics/runs': 'owner',
    # /api/dashboards
    'GET /api/dashboards': 'viewer',
    'POST /api/dashboards': 'analyst',
    'GET /api/dashboards/{identifier}': 'viewer',
    'PUT /api/dashboards/{identifier}': 'analyst',
    'DELETE /api/dashboards/{identifier}': 'owner',
    'POST /api/dashboards/{identifier}/duplicate': 'analyst',
    'GET /api/dashboards/{identifier}/report.json': 'viewer',
    'GET /api/dashboards/{identifier}/report.pdf': 'viewer',
    'GET /api/dashboards/{identifier}/widgets/{widget_id}/results.csv': 'viewer',
    'POST /api/dashboards/{dashboard}/charts': 'analyst',
    'POST /api/dashboards/{dashboard}/refresh-all': 'analyst',
    'GET /api/dashboards/{dashboard}/widgets/{identifier}/history': 'viewer',
    'PATCH /api/dashboards/{dashboard}/widgets/{identifier}/title': 'analyst',
    'POST /api/dashboards/{dashboard}/widgets/{identifier}/duplicate': 'analyst',
    'POST /api/dashboards/{dashboard}/widgets/{identifier}/refresh': 'analyst',
    # /api/saved-charts
    'GET /api/saved-charts': 'analyst',
    'POST /api/saved-charts': 'analyst',
    'GET /api/saved-charts/{identifier}': 'analyst',
    'DELETE /api/saved-charts/{identifier}': 'analyst',
    'GET /api/saved-charts/{identifier}/history': 'analyst',
    'POST /api/saved-charts/{identifier}/refresh': 'analyst',
    'POST /api/saved-charts/{identifier}/currency-metadata': 'analyst',
    # /api/automl
    'GET /api/automl/experiments': 'analyst',
    'GET /api/automl/models': 'analyst',
    'GET /api/automl/predictions': 'analyst',
    'POST /api/automl/experiments': 'analyst',
    'POST /api/automl/validate-configuration': 'analyst',
    'GET /api/automl/datasets/{identifier}/profile': 'analyst',
    'GET /api/automl/experiments/{identifier}': 'analyst',
    'DELETE /api/automl/experiments/{identifier}': 'analyst',
    'POST /api/automl/experiments/{identifier}/cancel': 'analyst',
    'GET /api/automl/models/{identifier}': 'analyst',
    'GET /api/automl/models/{identifier}/input-schema': 'analyst',
    'POST /api/automl/models/{identifier}/predict': 'analyst',
    'POST /api/automl/models/{identifier}/validate-input': 'analyst',
    'GET /api/automl/predictions/{identifier}': 'analyst',
    'DELETE /api/automl/predictions/{identifier}': 'analyst',
    'GET /api/automl/predictions/{identifier}/export.csv': 'analyst',
    # /api/health
    'GET /api/health': 'public',
    # /api/currency
    'GET /api/currency/status': 'viewer',
    'POST /api/currency/convert': 'viewer',
    # /api/projects
    'GET /api/projects': 'viewer',
    'POST /api/projects': 'analyst',
    'PATCH /api/projects/{identifier}': 'analyst',
    'DELETE /api/projects/{identifier}': 'owner',
    'POST /api/projects/{identifier}/archive': 'analyst',
    'POST /api/projects/{identifier}/restore': 'analyst',
    'GET /api/projects/{identifier}/dependencies': 'analyst',
    # /api/benchmarks
    'GET /api/benchmarks': 'operator',
    'POST /api/benchmarks/retail-v1/install': 'operator',
    'POST /api/benchmarks/retail-v1/verify': 'operator',
    # /api/evaluations
    'GET /api/evaluations': 'operator',
    'POST /api/evaluations': 'operator',
    'POST /api/evaluations/offline': 'operator',
    'GET /api/evaluations/{identifier}': 'operator',
    'DELETE /api/evaluations/{identifier}': 'operator',
    'DELETE /api/evaluations/{identifier}/record': 'operator',
    'GET /api/evaluations/{identifier}/presentation': 'operator',
    'GET /api/evaluations/{identifier}/report.csv': 'operator',
    'GET /api/evaluations/{identifier}/report.json': 'operator',
    'PUT /api/evaluations/{identifier}/cases/{case_id}/review': 'operator',
}
# List endpoints filtered in their own code (modules outside Rule 3); the AutoML lists are filtered by LIST_FILTERS.
CODE_FILTERED_LISTS = {'/api/datasets', '/api/datasets/references', '/api/analyst/runs', '/api/analytics/runs', '/api/dashboards', '/api/saved-charts'}
