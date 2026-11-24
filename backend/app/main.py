import csv
import io
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from uuid import UUID, uuid4

import duckdb
from fastapi import FastAPI, Form, HTTPException, Query, UploadFile, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Integer, String, Text, create_engine, select
from sqlalchemy.orm import declarative_base, Session

from .analyst import AnalystService, make_run_model, TERMINAL
from .knowledge import KnowledgeService, KnowledgeSettings, make_knowledge_models
from .knowledge_review import register as register_review, migrate as migrate_review, ReviewService
from .dashboard_workspace import register as register_dashboard_snapshot, migrate as migrate_dashboard_snapshot, Workspace as DashboardWorkspace
from .persistence import register_phase4,migrate,utcnow
from .dashboards import DashboardService,DocumentStore
from .evaluation import EvaluationService
from .observability import ObservabilityService
from .reports import report_router
from .automl.service import AutoMLService
from .dataset_editor import DatasetEditor
from .dataset_revisions import register as register_revisions, migrate as migrate_revisions, Revisions
from .dataset_quality import Quality
from .analyst_ux import register as register_ux, migrate as migrate_ux, AnalystUX
from . import confirmed_types
from . import sample_flags
from . import auth
from . import people
from . import analyst_results
from . import projects as projects_module
from .dataset_lifecycle import register, migrate_lifecycle, Lifecycle, Confirmation
from sqlalchemy import inspect

def _env_number(name, default, low, high):
    try:
        value = float(os.environ.get(name) or default)
    except ValueError:
        value = default
    return min(max(value, low), high)


def upload_limits():
    """(max bytes, max rows) for one CSV upload. Set MAX_UPLOAD_MB and MAX_UPLOAD_ROWS; read when the app starts."""
    return int(_env_number('MAX_UPLOAD_MB', DEFAULT_UPLOAD_MB, 0.001, 2048) * 1024 * 1024), int(_env_number('MAX_UPLOAD_ROWS', DEFAULT_UPLOAD_ROWS, 1, 50_000_000))


# Measured safe defaults for a 2 GB container (docs/P4_LARGE_FILES.md): the dataset editor reads every row into memory when a file is added.
# 1,000,000 rows (a 53 MB file) was added in 131 s at about 1 GB; a 100 MB / 1.8 million row file failed. Raise both only with more memory.
DEFAULT_UPLOAD_MB = 60
DEFAULT_UPLOAD_ROWS = 1_000_000
MAX_BYTES, MAX_ROWS = upload_limits()          # module values for tests and tools; the app re-reads the environment when it starts
MAX_COLUMNS = 100
BATCH_ROWS = 5000
Base = declarative_base()


class Dataset(Base):
    __tablename__ = 'datasets'
    id = Column(String(36), primary_key=True)
    name = Column(String(255), nullable=False)
    rows = Column(Integer, nullable=False)
    bytes = Column(Integer, nullable=False)
    created_at = Column(String(40), nullable=False)
    schema_json = Column(Text, nullable=False)
    display_name = Column(Text, nullable=True)
    archived_at = Column(String(40), nullable=True)
    archived_reason = Column(Text, nullable=True)


DashboardSnapshot = register_dashboard_snapshot(Base)
KnowledgeDraft, KnowledgeReviewExample = register_review(Base)
DatasetRevision = register_revisions(Base)
AnalystFeedback = register_ux(Base)
ConfirmedColumnTypes = confirmed_types.register(Base)
DatasetSampleFlag = sample_flags.register(Base)
AuthModels = auth.register(Base)
AnalystRunResult = analyst_results.register(Base)
Project, ProjectItem = projects_module.register(Base)
DatasetReference, DatasetAudit = register(Base)
AnalystRun = make_run_model(Base)
KnowledgeState, VerifiedExample = make_knowledge_models(Base)
Migration, Phase4Models = register_phase4(Base)


class ColumnInfo(BaseModel):
    name: str
    type: str
    null_count: int


class DatasetInfo(BaseModel):
    id: str
    name: str
    rows: int
    bytes: int
    created_at: str
    columns: List[ColumnInfo]
    display_name: Optional[str] = None
    archived_at: Optional[str] = None
    archived_reason: Optional[str] = None
    is_sample: bool = False
    # Stage 1: the explicitly installed test benchmark (Admin-only), identified by its install record.
    is_benchmark: bool = False


class Preview(BaseModel):
    columns: List[str]
    rows: List[List[Optional[str]]]
    offset: int
    total: int


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def iter_csv(text, max_rows=None):
    """Streams a CSV from a text file object: returns (header, row iterator). Constant memory; the same rules and messages as before."""
    max_rows = MAX_ROWS if max_rows is None else max_rows
    try:
        csv.field_size_limit(65536)
        reader = csv.reader(text, strict=True)
        header = next(reader, [])
        if not header or len(header) > MAX_COLUMNS or any(not h.strip() or len(h) > 128 or '\x00' in h for h in header):
            raise ValueError('Use 1–100 nonempty column names, each at most 128 characters.')
        if len({h.casefold() for h in header}) != len(header):
            raise ValueError('Column names must be unique (case insensitive).')
    except (UnicodeError, csv.Error) as exc:
        raise ValueError('Upload a valid UTF-8 CSV with fields no longer than 65,536 characters.') from exc

    def rows():
        count = 0
        try:
            for row in reader:
                if len(row) != len(header):
                    raise ValueError('Every row must have the same number of fields as the header.')
                if any('\x00' in cell for cell in row):
                    raise ValueError('NUL characters are not supported.')
                count += 1
                if count > max_rows:
                    raise ValueError(f'Maximum {max_rows:,} rows per dataset.')
                yield [cell if cell != '' else None for cell in row]
        except (UnicodeError, csv.Error) as exc:
            raise ValueError('Upload a valid UTF-8 CSV with fields no longer than 65,536 characters.') from exc
    return header, rows()


def parse_csv(raw, max_rows=None):
    """Small-input form of iter_csv (tests and tools): the whole file as a list of rows."""
    try:
        text = io.StringIO(raw.decode('utf-8-sig'), newline='')
    except UnicodeError as exc:
        raise ValueError('Upload a valid UTF-8 CSV with fields no longer than 65,536 characters.') from exc
    header, rows = iter_csv(text, max_rows)
    return header, list(rows)


def ingest_csv(source, target, header, expected):
    """Loads a CSV that has already passed iter_csv into the dataset file. Fast path: DuckDB's own reader (every column stays text; empty cells become
    empty values here and NULL below, exactly like the row-by-row path). If it disagrees with the checked row count, fall back to the slow exact path."""
    columns = ','.join(quote(h) + ' VARCHAR' for h in header)
    spec = '{' + ', '.join("'" + h.replace("'", "''") + "': 'VARCHAR'" for h in header) + '}'
    try:
        db = duckdb.connect(str(target), config={'memory_limit': '1GB', 'threads': '1', 'preserve_insertion_order': 'true', 'max_temp_directory_size': '0B'})
        try:
            db.execute(f'CREATE TABLE records ({columns})')
            db.execute("INSERT INTO records SELECT * FROM read_csv(?, header=true, delim=',', quote='\"', escape='\"', all_varchar=true, auto_detect=false, columns=" + spec + ", nullstr='', parallel=false)", [str(source)])
            if db.execute('SELECT count(*) FROM records').fetchone()[0] != expected:
                raise ValueError('row count differs')
            db.execute('UPDATE records SET ' + ','.join(f"{quote(h)} = NULLIF({quote(h)}, '')" for h in header))
        finally:
            db.close()
        return
    except Exception:
        Path(target).unlink(missing_ok=True)
    with open(source, 'rb') as handle:                                # exact fallback: one batch of rows at a time
        _, rows = iter_csv(io.TextIOWrapper(handle, encoding='utf-8-sig', newline=''), expected)
        with connect(target, False) as db:
            db.execute(f'CREATE TABLE records ({columns})')
            statement = 'INSERT INTO records VALUES (' + ','.join('?' for _ in header) + ')'
            batch = []
            for row in rows:
                batch.append(row)
                if len(batch) >= BATCH_ROWS:
                    db.executemany(statement, batch)
                    batch = []
            if batch:
                db.executemany(statement, batch)


def connect(path, read_only=True):
    return duckdb.connect(str(path), read_only=read_only, config={
        'enable_external_access': 'false', 'autoinstall_known_extensions': 'false',
        'autoload_known_extensions': 'false', 'memory_limit': '256MB', 'threads': '1',
        'max_temp_directory_size': '0B', 'preserve_insertion_order': 'true',
    })


def info(item, benchmark_ids=frozenset(), sample_ids=frozenset()):
    return DatasetInfo(id=item.id, name=item.name, rows=item.rows, bytes=item.bytes,
                       created_at=item.created_at, columns=json.loads(item.schema_json), display_name=item.display_name,
                       archived_at=item.archived_at, archived_reason=item.archived_reason, is_sample=item.id in sample_ids,
                       is_benchmark=item.id in benchmark_ids)


def create_app(data_dir=None, database_url=None, provider=None, embedder=None, fx_fetch=None, auth_config=None):
    # Accounts A1: fail closed. An unsafe or invalid authentication setting stops the app before it serves anything.
    auth_config = (auth_config or auth.AuthConfig.from_env()).check()
    root = Path(data_dir or os.getenv('DATA_DIR', './data')).resolve()
    engine = create_engine(database_url or os.getenv('DATABASE_URL') or 'sqlite:///' + str(root / 'catalog.sqlite'))

    @asynccontextmanager
    async def lifespan(app):
        root.mkdir(parents=True, exist_ok=True)
        from .final_migration import migrate as migrate_final
        migrate_final(engine,root)
        migrate_ux(engine,root,AnalystFeedback)
        if inspect(engine).has_table("datasets"):
            migrate_lifecycle(engine,root,Dataset,DatasetReference,DatasetAudit)
        migrate_revisions(engine,root,DatasetRevision)
        migrate_review(engine,root,[KnowledgeDraft, KnowledgeReviewExample])
        migrate_dashboard_snapshot(engine,root,DashboardSnapshot)
        confirmed_types.migrate(engine,root,ConfirmedColumnTypes)
        sample_flags.migrate(engine,root,DatasetSampleFlag)
        auth.migrate(engine,root,AuthModels)
        projects_module.migrate(engine,root,[Project, ProjectItem])
        analyst_results.migrate(engine,root,AnalystRunResult)
        migrate(engine,Base,Migration)
        knowledge.start()
        editor.recover()
        revisions.recover()
        analyst.start()
        evaluations.start()
        automl.start()
        yield
        automl.close()
        evaluations.close()
        analyst.close()
        engine.dispose()

    upload_bytes, upload_rows = upload_limits()
    app = FastAPI(title='InsightIQ API', version='0.6.0', lifespan=lifespan)

    @app.middleware('http')
    async def bound_upload(request: Request, call_next):
        # Enforce the whole multipart body limit before Starlette spools file data.
        if request.method in {'POST', 'PUT'} and (request.url.path in {'/api/analyst/runs'} or '/edits' in request.url.path or '/knowledge' in request.url.path or request.url.path.endswith('/chart') or request.url.path.startswith(('/api/dashboards','/api/saved-charts','/api/evaluations','/api/automl','/api/currency'))):
            body_limit = 16384 if request.url.path=='/api/analyst/runs' else 131072
            chunks = []
            size = 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > body_limit:
                    return JSONResponse(status_code=413, content={'detail': 'Request exceeds the upload or analyst request size limit.'})
                chunks.append(chunk)
            request._body = b''.join(chunks)
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    class UploadBodyLimit:
        """Counts the bytes of an upload as they arrive and stops it above the limit, so a big or endless body is never held in memory."""
        def __init__(self, inner):
            self.inner = inner

        async def __call__(self, scope, receive, send):
            if scope['type'] != 'http' or scope['method'] != 'POST' or scope['path'] != '/api/datasets':
                return await self.inner(scope, receive, send)
            limit = upload_bytes + 65536
            declared = next((int(v) for k, v in scope['headers'] if k == b'content-length' and v.isdigit()), None)

            async def refuse():
                body = json.dumps({'detail': f'Maximum upload size is {upload_bytes / 1048576:g} MB.'}).encode()
                await send({'type': 'http.response.start', 'status': 413, 'headers': [(b'content-type', b'application/json'), (b'content-length', str(len(body)).encode())]})
                await send({'type': 'http.response.body', 'body': body})
            if declared is not None and declared > limit:
                return await refuse()
            seen = 0
            exceeded = False
            replied = False

            async def counted():
                nonlocal seen, exceeded
                if exceeded:
                    return {'type': 'http.disconnect'}
                message = await receive()
                if message['type'] == 'http.request':
                    seen += len(message.get('body', b''))
                    if seen > limit:
                        exceeded = True
                        return {'type': 'http.disconnect'}        # stop feeding the parser; whatever it answers is replaced by the 413 below
                return message

            async def watch(message):
                nonlocal replied
                if exceeded:
                    if not replied:
                        replied = True
                        await refuse()
                    return
                await send(message)
            await self.inner(scope, counted, watch)
            if exceeded and not replied:
                await refuse()

    app.add_middleware(UploadBodyLimit)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        logging.exception('API failure', exc_info=exc)
        return JSONResponse(status_code=500, content={'detail': 'Operation failed. Please retry or check API logs.'})

    def get_item(dataset_id):
        with Session(engine) as session:
            item = session.get(Dataset, str(dataset_id))
            if item is None:
                raise HTTPException(404, 'Dataset not found.')
            return item

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'phase': 6, 'upload_limit_mb': round(upload_bytes / 1048576, 3), 'upload_limit_rows': upload_rows}

    @app.get('/api/datasets', response_model=List[DatasetInfo])
    def datasets(include_archived: bool = False, archived_only: bool = False):
        with Session(engine) as session:
            query=select(Dataset).order_by(Dataset.created_at.desc())
            if archived_only: query=query.where(Dataset.archived_at.is_not(None))
            elif not include_archived: query=query.where(Dataset.archived_at.is_(None))
            query=query.where(projects.dataset_clause(Dataset.id))
            # Read-only lookup of benchmark install records; never inferred from the file name.
            benchmark_ids=frozenset(str(x) for x in session.scalars(select(store.models['BenchmarkInstall'].dataset_id)) if x)
            sample_ids=frozenset(session.scalars(select(DatasetSampleFlag.dataset_id).where(DatasetSampleFlag.is_sample.is_(True))))
            return [info(item, benchmark_ids, sample_ids) for item in session.scalars(query)]

    @app.post('/api/datasets', response_model=DatasetInfo, status_code=201)
    def upload(file: UploadFile):
        if not file.filename or not file.filename.lower().endswith('.csv'):
            raise HTTPException(415, 'Select a .csv file.')
        identifier = str(uuid4())
        temporary = root / (identifier + '.tmp.duckdb')
        final = root / (identifier + '.duckdb')
        staged = root / (identifier + '.upload.tmp')
        try:
            size = 0
            with open(staged, 'wb') as out:                      # streamed to disk in 1 MB pieces: the file is never held in memory
                while True:
                    piece = file.file.read(1024 * 1024)
                    if not piece:
                        break
                    size += len(piece)
                    if size > upload_bytes:
                        raise HTTPException(413, f'Maximum upload size is {upload_bytes / 1048576:g} MB.')
                    out.write(piece)
            try:
                with open(staged, 'rb') as raw_file:
                    header, rows = iter_csv(io.TextIOWrapper(raw_file, encoding='utf-8-sig', newline=''), upload_rows)
                    nulls = [0] * len(header)
                    total = 0
                    for row in rows:                                  # one streaming pass checks every row and counts the empty cells; nothing is kept
                        total += 1
                        for i, cell in enumerate(row):
                            if cell is None:
                                nulls[i] += 1
                ingest_csv(staged, temporary, header, total)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            temporary.replace(final)
            columns = [ColumnInfo(name=h, type='VARCHAR', null_count=nulls[i]).model_dump() for i, h in enumerate(header)]
            item = Dataset(id=identifier, name=file.filename.replace('\\', '/').split('/')[-1][:255], rows=total, bytes=size,
                           created_at=datetime.now(timezone.utc).isoformat(), schema_json=json.dumps(columns))
            with Session(engine) as session:
                session.add(item)
                session.commit()
                session.refresh(item)
                response = info(item)
            projects.assign('dataset', identifier)
            editor.initialize(identifier, staged.read_bytes())      # the editor keeps the original file bytes
            knowledge.sync(identifier)
            revisions.capture_import(identifier)
            return response
        except Exception:
            with Session(engine) as session:
                failed = session.get(Dataset, identifier)
                if failed is not None:
                    session.delete(failed)
                    session.commit()
            knowledge.purge(identifier)
            revisions.purge(identifier)
            temporary.unlink(missing_ok=True)
            final.unlink(missing_ok=True)
            raise
        finally:
            staged.unlink(missing_ok=True)
            file.file.close()

    @app.get('/api/datasets/references')
    def dataset_references():
        allowed = projects.dataset_ids()
        return [r for r in lifecycle.references() if r['id'] in allowed]

    @app.get('/api/datasets/{dataset_id}', response_model=DatasetInfo)
    def detail(dataset_id: UUID):
        return info(get_item(dataset_id), sample_ids=sample_set(str(dataset_id)))

    # Stage 6 item 2: the owner decides what counts as sample data; nothing is inferred from a file name.
    def sample_set(*ids):
        with Session(engine) as session:
            return frozenset(session.scalars(select(DatasetSampleFlag.dataset_id).where(DatasetSampleFlag.is_sample.is_(True), DatasetSampleFlag.dataset_id.in_(ids))))

    def write_sample_flags(ids, value):
        with Session(engine) as session:
            for identifier in ids:
                row = session.get(DatasetSampleFlag, identifier)
                if row is None:
                    session.add(DatasetSampleFlag(dataset_id=identifier, is_sample=value, set_at=utcnow()))
                else:
                    row.is_sample, row.set_at = value, utcnow()
            session.commit()

    class SampleFlagRequest(BaseModel):
        model_config = ConfigDict(extra='forbid')
        is_sample: bool

    class BulkSampleFlagRequest(SampleFlagRequest):
        ids: List[UUID] = Field(min_length=1, max_length=100)

    @app.put('/api/datasets/{dataset_id}/sample', response_model=DatasetInfo)
    def put_sample_flag(dataset_id: UUID, body: SampleFlagRequest):
        item = get_item(dataset_id)
        write_sample_flags([item.id], body.is_sample)
        return info(item, sample_ids=sample_set(item.id))

    @app.post('/api/datasets/bulk-sample')
    def bulk_sample_flag(body: BulkSampleFlagRequest):
        items = [get_item(i) for i in dict.fromkeys(body.ids)]
        write_sample_flags([i.id for i in items], body.is_sample)
        return {'updated': len(items), 'is_sample': body.is_sample}

    # Approved fix 3a: remember a dataset's confirmed column types (new additive table).
    class ConfirmTypesRequest(BaseModel):
        model_config = ConfigDict(extra='forbid')
        type_mapping: Dict[str, str]
        confirm: bool

    def confirmed_view(item, row):
        columns = json.loads(item.schema_json)
        if row is None:
            return {'dataset_id': item.id, 'type_mapping': None, 'confirmed_at': None, 'current': False}
        current = row.schema_signature == confirmed_types.schema_signature(columns)
        return {'dataset_id': item.id, 'type_mapping': json.loads(row.type_mapping) if current else None,
                'confirmed_at': row.confirmed_at, 'current': current}

    @app.get('/api/datasets/{dataset_id}/confirmed-types')
    def get_confirmed_types(dataset_id: UUID):
        item = get_item(dataset_id)
        with Session(engine) as session:
            return confirmed_view(item, session.get(ConfirmedColumnTypes, item.id))

    @app.put('/api/datasets/{dataset_id}/confirmed-types')
    def put_confirmed_types(dataset_id: UUID, body: ConfirmTypesRequest):
        item = get_item(dataset_id)
        if body.confirm is not True:
            raise HTTPException(422, 'Types are remembered only after you explicitly confirm them.')
        columns = json.loads(item.schema_json)
        try:
            mapping = confirmed_types.validate(body.type_mapping, columns)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        with Session(engine) as session:
            row = session.get(ConfirmedColumnTypes, item.id) or ConfirmedColumnTypes(dataset_id=item.id)
            row.type_mapping = json.dumps(mapping)
            row.schema_signature = confirmed_types.schema_signature(columns)
            row.confirmed_at = utcnow()
            row.actor = 'user_ui'
            session.merge(row)
            session.commit()
            return confirmed_view(item, session.get(ConfirmedColumnTypes, item.id))

    @app.delete('/api/datasets/{dataset_id}/confirmed-types')
    def delete_confirmed_types(dataset_id: UUID):
        item = get_item(dataset_id)
        with Session(engine) as session:
            row = session.get(ConfirmedColumnTypes, item.id)
            if row is not None:
                session.delete(row)
                session.commit()
        return {'dataset_id': item.id, 'type_mapping': None, 'confirmed_at': None, 'current': False}

    @app.get('/api/datasets/{dataset_id}/preview', response_model=Preview)
    def preview(dataset_id: UUID, offset: int = Query(0, ge=0, le=upload_rows), limit: int = Query(25, ge=1, le=100)):
        item = get_item(dataset_id)
        with knowledge.lock, connect(root / (item.id + '.duckdb')) as db:
            rows = db.execute('SELECT * FROM records LIMIT ? OFFSET ?', [limit, offset]).fetchall()
        return Preview(columns=[c['name'] for c in json.loads(item.schema_json)], rows=rows, offset=offset, total=item.rows)

    analyst = AnalystService(root, engine, AnalystRun, get_item, connect, provider)
    knowledge = KnowledgeService(root, engine, KnowledgeState, VerifiedExample, Dataset, get_item, connect, embedder)
    analyst.knowledge, knowledge.analyst = knowledge, analyst
    analyst.ux=AnalystUX(analyst,AnalystFeedback)
    analyst.saved_results=analyst_results.ResultStore(engine,AnalystRunResult)
    app.include_router(analyst.ux.router())
    from .currency import Rates, router as currency_router
    analyst.currency_rates = Rates(fx_fetch)
    app.include_router(currency_router(analyst.currency_rates))
    app.state.knowledge = knowledge
    app.include_router(knowledge.router())

    @app.delete('/api/datasets/{dataset_id}', status_code=204)
    def delete_dataset(dataset_id: UUID, body: Optional[Confirmation] = None):
        lifecycle.delete(dataset_id, body)

    store=DocumentStore(engine,Phase4Models)
    analyst.store=store
    # Stage 2: project scope (one middleware; protected modules are untouched).
    projects=projects_module.Projects(engine, Dataset, AnalystRun, store, store.models['BenchmarkInstall'])
    projects.bind(Project, ProjectItem)
    analyst.projects=projects
    app.middleware('http')(projects.middleware)
    # Accounts A1: registered after the project middleware so it runs FIRST (outermost). Inert when AUTH_MODE=off.
    auth_service=auth.AuthService(engine,AuthModels,auth_config)
    app.state.auth,app.state.auth_config=auth_service,auth_config
    app.include_router(auth.build_router(auth_service))
    app.include_router(people.build_people_router(auth_service))
    app.middleware('http')(auth.make_middleware(auth_service, lambda: app.routes, projects_module.ROUTE_ACCESS))
    app.include_router(projects.router())
    app.state.projects=projects
    dashboards=DashboardService(analyst,store)
    dashboards.projects=projects
    evaluations=EvaluationService(analyst,store,upload)
    automl=AutoMLService(analyst,store)
    editor = DatasetEditor(root, engine, Dataset, analyst, knowledge, automl, connect, get_item)
    app.include_router(editor.router())
    app.state.editor = editor
    app.state.automl=automl
    app.include_router(automl.router())
    from .automl.presentation import router as automl_presentation_router
    app.include_router(automl_presentation_router(automl))
    @app.get('/api/evaluations/{identifier}/presentation')
    def evaluation_presentation(identifier: UUID):
        from .evaluation_presentation import presentation
        return presentation(store.get('Evaluation',identifier))

    app.state.store,app.state.dashboards,app.state.evaluations=store,dashboards,evaluations
    app.include_router(dashboards.router())
    app.include_router(evaluations.router())
    app.include_router(ObservabilityService(analyst).router())
    app.include_router(report_router(dashboards))
    lifecycle=Lifecycle(root,engine,Dataset,DatasetReference,DatasetAudit,analyst,knowledge,store,info,automl,evaluations)
    revisions=Revisions(root,engine,DatasetRevision,editor,lifecycle)
    quality=Quality(editor)
    editor.revisions,editor.quality=revisions,quality
    lifecycle.revisions=revisions
    app.state.revisions,app.state.quality=revisions,quality
    app.include_router(revisions.router())
    app.include_router(quality.router())
    from .leakage_check import LeakageCheck
    app.include_router(LeakageCheck(editor).router())
    knowledge.review = ReviewService(knowledge, [KnowledgeDraft, KnowledgeReviewExample], editor, evaluations.lock)
    app.include_router(knowledge.review.router())
    dashboards.workspace=DashboardWorkspace(dashboards,DashboardSnapshot,editor,lifecycle)
    analyst.dashboard_workspace=dashboards.workspace
    app.include_router(dashboards.workspace.router())
    app.state.lifecycle=lifecycle
    app.include_router(lifecycle.router())
    app.state.analyst = analyst
    app.include_router(analyst.router())
    return app


app = create_app()
