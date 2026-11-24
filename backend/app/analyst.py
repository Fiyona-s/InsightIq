from datetime import date
"""Run lifecycle, bounded event history, SSE and ephemeral query analysis."""
import asyncio
import csv
import io
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional, Union
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import Column, String, Text, select, update
from sqlalchemy.orm import Session

from .knowledge import RetrievalResult
from .charts import ChartSpec, ChartData
from .evidence import Analysis
from .execution import ExecutionError, execute_isolated
from .telemetry import metrics_logger
from .provider import ModelError, LLMProvider
from .sql_guard import GuardError, TYPES, validate_sql
from .type_profile import profile_dataset, explicit_cast_diagnostics
from .prompts import PROMPT_VERSION, PROMPT_HASH, WORKFLOW_VERSION

TERMINAL = {'succeeded', 'failed', 'clarification', 'cancelled'}


from .analyst_ux import Choice

class AskRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: UUID
    thread_id: Optional[UUID] = None
    clarification_choice: Optional[Choice] = None
    question: str = Field(min_length=1, max_length=2000)
    type_mapping: Dict[str, str] = Field(default_factory=dict, max_length=100)


from pydantic import model_serializer
from .currency import Money, format_money


class ResultColumn(BaseModel):
    money: Optional[Money] = None
    percent: Optional[bool] = None
    name: str
    type: str

    @model_serializer(mode='wrap')
    def serialize_column(self, handler):
        result = handler(self)
        if self.money is None:
            result.pop('money', None)
        if self.percent is None:
            result.pop('percent', None)
        return result


class ResultPage(BaseModel):
    columns: List[ResultColumn]
    rows: List[List[Optional[Union[str, int, float, bool]]]]
    row_count: int
    offset: int
    expires_in_seconds: int


class UsageMetrics(BaseModel):
    model: Optional[str] = None
    provider_model: Optional[str] = None
    model_latency_ms: Optional[int] = None
    retrieval_latency_ms: Optional[int] = None
    query_latency_ms: Optional[int] = None
    total_latency_ms: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    estimated_cost_usd: Optional[float] = None


class ConversionInfo(BaseModel):
    column: str
    type: str
    missing: int
    failed: int


class ResultMetadata(BaseModel):
    columns: List[ResultColumn]
    row_count: int


class AgentEvent(BaseModel):
    id: int
    step: str
    status: str
    timestamp: str
    attempt: int
    summary: str


class SQLAttempt(BaseModel):
    attempt: int
    context_fingerprint: str
    sql: Optional[str] = None
    outcome: str = 'generating'
    validation: Literal['not_started','passed','rejected','stopped'] = 'not_started'
    execution: Literal['not_started','succeeded','failed'] = 'not_started'
    error_code: Optional[str] = None


class RunInfo(BaseModel):
    thread_id: Optional[str] = None
    thread_context: list = Field(default_factory=list)
    thread_result_summary: Optional[dict] = None
    clarification_options: list = Field(default_factory=list)
    clarification_choice: Optional[dict] = None
    prompt_version: Optional[str] = None
    prompt_hash: Optional[str] = None
    workflow_version: Optional[str] = None
    attempt_history: List[SQLAttempt] = Field(default_factory=list)
    events: List[AgentEvent] = Field(default_factory=list)
    attempts: int = 0
    current_step: Optional[str] = None
    retrieval: Optional[RetrievalResult] = None
    chart_spec: Optional[ChartSpec] = None
    evidence_count: int = 0
    activity_kind: str = "user"
    pipeline: str = "agentic"
    result_digest: Optional[str] = None
    schema_signature: Optional[str] = None
    id: str
    dataset_id: str
    dataset_name: str
    question: str
    status: Literal['queued', 'generating', 'executing', 'succeeded', 'failed', 'clarification', 'cancelled']
    created_at: str
    completed_at: Optional[str]
    sql: Optional[str]
    executed_sql: Optional[str]
    explanation: Optional[str]
    answer: Optional[str]
    clarification: Optional[str]
    error: Optional[str]
    error_code: Optional[str]
    type_mapping: Dict[str, str]
    conversions: List[ConversionInfo]
    metrics: UsageMetrics
    result_metadata: Optional[ResultMetadata]
    results_available: bool


class TypeConversion(BaseModel):
    valid: int
    failed: int


class ProfileColumn(BaseModel):
    name: str
    storage_type: str
    missing: int
    suggested_type: str
    conversions: Dict[str, TypeConversion]


class ProfileInfo(BaseModel):
    table: str
    rows: int
    columns: List[ProfileColumn]
    policy: str


def now():
    return datetime.now(timezone.utc).isoformat()


def make_run_model(base):
    class AnalystRun(base):
        __tablename__ = 'analyst_runs'
        id = Column(String(36), primary_key=True)
        dataset_id = Column(String(36), nullable=False, index=True)
        thread_id = Column(String(36), nullable=True)
        status = Column(String(30), nullable=False)
        created_at = Column(String(40), nullable=False, index=True)
        payload = Column(Text, nullable=False)
    return AnalystRun


class AnalystService:
    def __init__(self, root, engine, run_model, get_item, connector, provider=None):
        self.root, self.engine, self.Run = root, engine, run_model
        self.get_item, self.connector = get_item, connector
        self.provider = provider or LLMProvider()
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='analyst')
        self.slots = threading.BoundedSemaphore(2)
        self.lock = threading.RLock()
        self.events = {}
        self.results = {}  # at most 20 x <=1 MiB; TTL 10 minutes; never SQLite rows
        self.stopping = False
        self.knowledge = None
        self.providers = {}
        self.subscribers = threading.BoundedSemaphore(16)

    def start(self):
        with Session(self.engine) as session:
            for item in session.scalars(select(self.Run).where(self.Run.status.not_in(TERMINAL))):
                data = json.loads(item.payload)
                data.update(status='failed', error='API restarted before this run completed.', error_code='interrupted', completed_at=now())
                item.status, item.payload = 'failed', json.dumps(data)
            session.commit()

    def close(self):
        self.stopping = True
        with self.lock:
            for event in self.events.values():
                event.set()
        self.executor.shutdown(wait=True, cancel_futures=True)

    def prune(self):
        for key, (expiry, _) in list(self.results.items()):
            if expiry <= time.monotonic():
                del self.results[key]

    def rerun(self, run_id):
        """Run a saved question's SQL again on the CURRENT data (owner request 2026-11-17).

        No AI call: the stored, already-validated SQL goes through the same SQL guard and the same
        isolated read-only executor as every question. The result is a NEW run in the same chat, so the
        earlier answer and its saved result stay exactly as they were.
        """
        from .charts import chart_options
        from .currency import annotate
        from .evidence import compute_evidence, ground_narrative
        from .execution import ExecutionError, execute_isolated
        from .sql_guard import GuardError, validate_sql
        from .type_profile import explicit_cast_diagnostics
        old = self.load(run_id)
        sql = old.get('executed_sql') or old.get('sql')
        if old.get('status') != 'succeeded' or not sql:
            raise HTTPException(409, 'Only an answered question can be run again.')
        item = self.get_item(old['dataset_id'])
        if getattr(item, 'archived_at', None):
            raise HTTPException(409, 'Restore this archived dataset before running a question again.')
        mapping = old.get('type_mapping') or {}
        schema = {c['name']: mapping.get(c['name'], 'VARCHAR') for c in json.loads(item.schema_json)}
        path = self.root / (str(old['dataset_id']) + '.duckdb')
        start = time.monotonic()
        try:
            checked = validate_sql(sql, schema)
            result = execute_isolated(path, checked, mapping)
        except (GuardError, ExecutionError) as exc:
            raise HTTPException(409, 'This question can no longer run on the current data: ' + str(exc)) from exc
        executed = result.pop('executed_sql')
        settings = self.knowledge.sync(old['dataset_id'])[3]
        result['columns'] = annotate(checked, result['columns'], settings)
        from .percent_units import annotate_percent
        result['columns'] = annotate_percent(checked, result['columns'], settings)
        evidence = compute_evidence(result)
        analysis = {'charts': chart_options(result), 'evidence': evidence,
                    'narrative': ground_narrative({'fact_ids': [f['id'] for f in evidence['facts'][:4]]}, evidence),
                    'narrative_source': 'computed', 'warning': 'Run again on the current data; no AI was used.'}
        result['analysis'] = analysis
        count = result['row_count']
        if count == 0:
            answer = 'The query returned no matching rows. This is a valid empty result.'
        elif count == 1 and len(result['columns']) <= 4:
            answer = '; '.join(c['name'] + ': ' + format_money(v, c.get('money')) for c, v in zip(result['columns'], result['rows'][0]))
        else:
            answer = f'The query returned {count} rows across {len(result["columns"])} columns. See the complete result below.'
        data = dict(old)
        data.update(id=str(uuid4()), created_at=now(), completed_at=now(), status='succeeded', sql=checked, executed_sql=executed,
                    answer=answer, error=None, error_code=None, events=[], attempts=0, attempt_history=[], metrics={'total_latency_ms': round((time.monotonic() - start) * 1000)},
                    conversions=explicit_cast_diagnostics(checked, path, self.connector, mapping), clarification=None, clarification_options=[],
                    result_metadata={'columns': result['columns'], 'row_count': count}, chart_spec=analysis['charts']['recommended']['spec'],
                    result_digest=evidence['result_digest'], evidence_count=len(evidence['facts']), results_available=True, rerun_of=str(old['id']))
        data['thread_result_summary'] = self.ux.summary(result, executed)
        with self.lock:
            self.prune()
            while len(self.results) >= 20:
                del self.results[next(iter(self.results))]
            self.results[data['id']] = (time.monotonic() + 600, result)
        if getattr(self, 'saved_results', None):
            self.saved_results.save(data['id'], result)
        with Session(self.engine) as session:
            session.add(self.Run(id=data['id'], thread_id=data['thread_id'], dataset_id=data['dataset_id'], status='succeeded', created_at=data['created_at'], payload=json.dumps(data)))
            session.commit()
        return data

    def saved_has(self, identifier):
        store = getattr(self, 'saved_results', None)
        return bool(store and store.has(identifier))

    def load(self, identifier):
        with Session(self.engine) as session:
            item = session.get(self.Run, str(identifier))
            if not item:
                raise HTTPException(404, 'Analyst run not found.')
            data = json.loads(item.payload)
        with self.lock:
            self.prune()
            data['results_available'] = str(identifier) in self.results or self.saved_has(identifier)
        return data

    def save(self, data):
        with Session(self.engine) as session:
            session.execute(update(self.Run).where(self.Run.id == data['id']).values(status=data['status'], payload=json.dumps(data)))
            session.commit()

    def submit(self, request, pipeline="agentic", activity_kind="user", provider=None):
        if not request.question.strip():
            raise HTTPException(422, 'Enter a question.')
        item = self.get_item(request.dataset_id)
        if getattr(item, "archived_at", None) and activity_kind != "evaluation": raise HTTPException(409, "Restore this archived dataset before starting analysis.")
        self.ux.validate_choice(item.id,request.clarification_choice)
        thread_context=self.ux.context(item.id,request.thread_id)
        names = {c['name'] for c in json.loads(item.schema_json)}
        if set(request.type_mapping) - names or any(t not in TYPES for t in request.type_mapping.values()):
            raise HTTPException(422, 'Type mappings must use actual columns and approved types.')
        if self.stopping or not self.slots.acquire(blocking=False):
            raise HTTPException(429, 'Two analyst runs are already active. Wait or cancel one before trying again.')
        data = dict(id=str(uuid4()), thread_id=str(request.thread_id or uuid4()), thread_context=thread_context, clarification_choice=request.clarification_choice.model_dump() if request.clarification_choice else None, clarification_options=[], dataset_id=item.id, dataset_name=item.name, question=request.question.strip(),
                    status='queued', created_at=now(), completed_at=None, sql=None, executed_sql=None, explanation=None,
                    answer=None, clarification=None, error=None, error_code=None, type_mapping=request.type_mapping,
                    pipeline=pipeline, activity_kind=activity_kind, prompt_version=PROMPT_VERSION, prompt_hash=PROMPT_HASH,
                    workflow_version=WORKFLOW_VERSION, attempt_history=[], conversions=[], metrics={}, result_metadata=None, results_available=False, events=[], attempts=0)
        event = threading.Event()
        try:
            with self.lock:
                with Session(self.engine) as session:
                    session.add(self.Run(id=data['id'], thread_id=data['thread_id'], dataset_id=item.id, status=data['status'], created_at=data['created_at'], payload=json.dumps(data)))
                    session.commit()
                self.events[data['id']] = event
                if provider is not None:self.providers[data['id']] = provider
                self.executor.submit(self.work, data, event)
            return dict(data)
        except Exception:
            self.slots.release()
            raise

    def work(self, data, event):
        start = time.monotonic()
        try:
            from .workflow import run_graph
            state = run_graph(self, data, event)
            self.check_cancel(event)
            if data.get('clarification'):
                data['status'] = 'clarification'
                data['clarification_options']=self.ux.choices(data['dataset_id'])
            if 'result' in state:
                result = state['result']
                result['analysis'] = state['analysis']
                data['thread_result_summary']=self.ux.summary(result,data['executed_sql'])
                count = result['row_count']
                if count == 0:
                    data['answer'] = 'The query returned no matching rows. This is a valid empty result.'
                elif count == 1 and len(result['columns']) <= 4:
                    data['answer'] = '; '.join(c['name'] + ': ' + format_money(v, c.get('money')) for c, v in zip(result['columns'], result['rows'][0]))
                else:
                    data['answer'] = f'The query returned {count} rows across {len(result["columns"])} columns. See the complete result below.'
                with self.lock:
                    self.check_cancel(event)
                    self.prune()
                    while len(self.results) >= 20:
                        del self.results[next(iter(self.results))]
                    self.results[data['id']] = (time.monotonic() + 600, result)
                if data.get('activity_kind') != 'evaluation' and getattr(self, 'saved_results', None):
                    self.saved_results.save(data['id'], result)  # the answer stays with its question
                data['status'] = 'succeeded'
        except (ModelError, ExecutionError, GuardError) as exc:
            data.update(status='cancelled' if event.is_set() else 'failed', error='Run cancelled.' if event.is_set() else str(exc),
                        error_code='cancelled' if event.is_set() else getattr(exc, 'code', 'validation_error'))
        except Exception:
            logging.error('Analyst run %s failed internally', data['id'])
            data.update(status='cancelled' if event.is_set() else 'failed', error='Run cancelled.' if event.is_set() else 'Analyst run failed. Check server configuration and retry.', error_code='cancelled' if event.is_set() else 'internal_error')
        finally:
            data.pop('_model_calls', None)
            data['completed_at'] = now()
            data['metrics']['total_latency_ms'] = round((time.monotonic() - start) * 1000)
            try:
                metrics_logger.info('Analyst run metrics: %s', json.dumps({'run_id': data['id'], 'status': data['status'], **data['metrics']}))
                self.emit(data, data.get('current_step', 'finish'), data['status'], data.get('error') or 'Run reached terminal state.')
            finally:
                with self.lock:
                    self.events.pop(data['id'], None)
                    self.providers.pop(data['id'], None)
                self.slots.release()

    def emit(self, data, step, status, summary):
        events = data.setdefault('events', [])
        if len(events) < 96:
            events.append({'id': len(events) + 1, 'step': step, 'status': status, 'timestamp': now(),
                           'attempt': data.get('attempts', 0), 'summary': str(summary)[:500]})
        data['current_step'] = step
        self.save(data)

    async def event_stream(self, identifier, request, after):
        try:
            heartbeat = time.monotonic()
            while True:
                if await request.is_disconnected():
                    return
                data = self.load(identifier)
                for event in data.get('events', []):
                    if event['id'] > after:
                        after = event['id']
                        yield 'id: ' + str(after) + '\nevent: step\ndata: ' + json.dumps(event) + '\n\n'
                if data['status'] in TERMINAL:
                    yield 'event: complete\ndata: ' + json.dumps({'status': data['status']}) + '\n\n'
                    return
                if time.monotonic() - heartbeat >= 10:
                    yield ': heartbeat\n\n'
                    heartbeat = time.monotonic()
                await asyncio.sleep(.15)
        finally:
            self.subscribers.release()

    @staticmethod
    def check_cancel(event):
        if event.is_set():
            raise ExecutionError('Run cancelled.', 'cancelled')

    def result(self, identifier):
        self.load(identifier)
        with self.lock:
            self.prune()
            cached = self.results.get(str(identifier))
            if not cached and getattr(self, 'saved_results', None):
                kept = self.saved_results.get(identifier)
                if kept is not None:  # saved with the question: re-warm the short cache, nothing is re-run
                    cached = self.results[str(identifier)] = (time.monotonic() + 600, kept)
            if not cached:
                raise HTTPException(410, 'Result rows have expired or are unavailable. History retains metadata only; submit the question again to re-run.')
            return cached

    def router(self):
        router = APIRouter(prefix='/api', tags=['AI Analyst'])

        @router.get('/datasets/{dataset_id}/profile', response_model=ProfileInfo)
        def profile(dataset_id: UUID):
            item = self.get_item(dataset_id)
            with self.knowledge.lock:
                return profile_dataset(self.root / (item.id + '.duckdb'), self.connector)

        @router.post('/analyst/runs', response_model=RunInfo, status_code=202)
        def ask(request: AskRequest):
            with self.knowledge.lock:
                return self.submit(request)

        @router.get('/analyst/runs', response_model=List[RunInfo])
        def history(dataset_id: Optional[UUID] = None, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
            with Session(self.engine) as session:
                statement = select(self.Run.id).order_by(self.Run.created_at.desc()).limit(limit).offset(offset)
                if dataset_id:
                    statement = statement.where(self.Run.dataset_id == str(dataset_id))
                if getattr(self, 'projects', None):  # Stage 2: active project only
                    statement = statement.where(self.projects.dataset_clause(self.Run.dataset_id))
                identifiers = list(session.scalars(statement))
            return [self.load(i) for i in identifiers]

        @router.get('/analyst/runs/{run_id}', response_model=RunInfo)
        def run(run_id: UUID):
            return self.load(run_id)

        @router.post('/analyst/runs/{run_id}/rerun', response_model=RunInfo, status_code=201)
        def rerun(run_id: UUID):
            return self.rerun(run_id)

        @router.delete('/analyst/runs/{run_id}', response_model=RunInfo)
        def cancel(run_id: UUID):
            data = self.load(run_id)
            with self.lock:
                event = self.events.get(str(run_id))
                if event:
                    event.set()
            # Actual terminal state is written by the worker after cancellation.
            return self.load(run_id)

        @router.get('/analyst/runs/{run_id}/events')
        def events(run_id: UUID, request: Request, after: int = Query(0, ge=0, le=96)):
            data = self.load(run_id)
            replay = request.headers.get('last-event-id')
            if replay is not None:
                try:
                    after = int(replay)
                    if not 0 <= after <= 96:
                        raise ValueError()
                except ValueError:
                    raise HTTPException(422, 'Last-Event-ID must be an integer between 0 and 96.')
            if after > len(data.get('events', [])):
                raise HTTPException(409, 'Replay cursor exceeds the run event history.')
            if not self.subscribers.acquire(blocking=False):
                raise HTTPException(429, 'Too many event subscriptions.')
            return StreamingResponse(self.event_stream(run_id, request, after), media_type='text/event-stream',
                                     headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

        @router.get('/analyst/runs/{run_id}/analysis', response_model=Analysis)
        def analysis(run_id: UUID):
            _, result = self.result(run_id)
            return result.get('analysis', {})

        from .charts import ChartSpec, validate_chart
        @router.post('/analyst/runs/{run_id}/chart', response_model=ChartData)
        def chart(run_id: UUID, spec: ChartSpec):
            _, result = self.result(run_id)
            try:
                return validate_chart(spec, result)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc

        @router.get('/analyst/runs/{run_id}/results', response_model=ResultPage)
        def results(run_id: UUID, offset: int = Query(0, ge=0, le=1000), limit: int = Query(25, ge=1, le=100)):
            expiry, result = self.result(run_id)
            return {**result, 'rows': result['rows'][offset:offset + limit], 'offset': offset,
                    'expires_in_seconds': max(0, int(expiry - time.monotonic()))}

        @router.get('/analyst/runs/{run_id}/results.csv')
        def download(run_id: UUID, target_currency: Optional[str] = None, historical_date: Optional[date] = None):
            _, result = self.result(run_id)
            if target_currency:
                from .currency import export_result
                result = export_result(result, target_currency, self.currency_rates, historical_date)
            # Formula neutralization is disclosed, never applied to API/SQL results.
            def safe(value):
                if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r', '\n')):
                    return "'" + value
                return value
            output = io.StringIO(newline='')
            writer = csv.writer(output)
            writer.writerow([safe(c['name']) for c in result['columns']])
            writer.writerows([[safe(v) for v in row] for row in result['rows']])
            return Response(output.getvalue(), media_type='text/csv', headers={
                'Content-Disposition': 'attachment; filename="insightiq-result.csv"',
                'X-CSV-Formula-Protection': 'prefix-apostrophe', 'Cache-Control': 'no-store'})

        return router
