"""Bounded LangGraph workflow. Each SQL attempt always traverses guard and worker."""
import time
import sqlglot
from typing import TypedDict
from langgraph.graph import StateGraph, END
from langsmith import tracing_context
from .charts import chart_options
from .evidence import compute_evidence, ground_narrative
from .execution import ExecutionError, execute_isolated
from .provider import ModelError
from .sql_guard import GuardError, validate_sql
from .type_profile import explicit_cast_diagnostics
from .knowledge import digest


def sql_signature(sql):
    """Ignore formatting/comments, while retaining literal values and SQL semantics."""
    try:
        return sqlglot.parse_one(sql,read='duckdb').sql(dialect='duckdb',normalize=True,comments=False)
    except (sqlglot.errors.SqlglotError,ValueError,AttributeError,RecursionError):
        return sql.strip()


class State(TypedDict, total=False):
    schema: dict
    context: dict
    sql: str
    result: dict
    failure: str
    route: str
    analysis: dict


def add_usage(data, metrics):
    count = data.get('_model_calls', 0)
    for key in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'estimated_cost_usd'):
        old, new = data['metrics'].get(key), metrics.get(key)
        data['metrics'][key] = new if not count else old + new if old is not None and new is not None else None
    for key in ('model', 'provider_model'):
        if metrics.get(key):
            data['metrics'][key] = metrics[key]
    data['metrics']['model_latency_ms'] = data['metrics'].get('model_latency_ms', 0) + (metrics.get('model_latency_ms') or 0)
    data['_model_calls'] = count + 1


def run_graph(service, data, cancel):
    provider = service.providers.get(data['id'], service.provider)
    max_attempts = 3 if data.get('pipeline','agentic') == 'agentic' else 1
    path = service.root / (data['dataset_id'] + '.duckdb')
    failed_queries = set()
    def emit(step, status, summary):
        service.check_cancel(cancel)
        service.emit(data, step, status, summary)
    def retrieve(state):
        data['status'] = 'generating'
        profile = service.knowledge.profile(data['dataset_id'])
        schema = {c['name']: data['type_mapping'].get(c['name'], 'VARCHAR') for c in profile['columns']}
        data['schema_signature'] = service.knowledge.signature(profile)
        data['conversions'] = [{'column': c['name'], 'type': schema[c['name']], 'missing': c['missing'], 'failed': c['conversions'][schema[c['name']]]['failed']} for c in profile['columns'] if schema[c['name']] != 'VARCHAR']
        retrieval_start = time.monotonic()
        if data.get('pipeline') == 'baseline' or data.get('activity_kind')=='evaluation':
            retrieval = dict(status='unavailable',workspace_id=service.knowledge.workspace_id,dataset_id=data['dataset_id'],fingerprint='',embedding_model='disabled by baseline configuration' if data.get('pipeline')=='baseline' else 'disabled for benchmark isolation',documents=[],warning='Baseline schema-only mode; RAG intentionally disabled.' if data.get('pipeline')=='baseline' else 'Benchmark questions and answers are excluded from retrieval; using actual schema only.',rebuilt=False)
        else:
            retrieval = service.knowledge.retrieve(data['dataset_id'], data['question'], data['type_mapping'], profile=profile)
        data['metrics']['retrieval_latency_ms'] = round((time.monotonic()-retrieval_start)*1000)
        data['retrieval'] = retrieval
        emit('retrieve_context', 'completed', f'Retrieved {len(retrieval["documents"])} dataset-scoped documents.' if retrieval['status'] == 'ready' else 'Embeddings unavailable; using actual schema directly. ' + retrieval['warning'])
        return {'schema': schema, 'context': {'thread_context_untrusted':data.get('thread_context',[]), 'clarification_choice':data.get('clarification_choice'), 'table': 'data', 'dataset_id':data['dataset_id'], 'schema_signature':data['schema_signature'], 'row_count': profile['rows'], 'columns': [{'name': n, 'type': t} for n, t in schema.items()], 'conversions': data['conversions'], 'retrieved_context_untrusted': retrieval['documents']}}
    def plan(state):
        emit('plan', 'completed', 'Use only the selected dataset, confirmed types and explicit definitions. Validate every attempt; execute at most 1000 result rows.')
        return {'failure': ''}
    def generate(state):
        data['status'] = 'generating'
        data['attempts'] += 1
        attempt={'attempt':data['attempts'],'context_fingerprint':digest({'question':data['question'],'schema':state['context']}),
                 'sql':None,'outcome':'generating','validation':'not_started','execution':'not_started','error_code':None}
        data.setdefault('attempt_history',[]).append(attempt)
        emit('generate_sql', 'running', 'Generating a candidate query from the question and authorized schema.')
        start = time.monotonic()
        try:
            candidate, metrics = provider.generate(data['question'], state['context'])
            metrics = {**metrics, 'model_latency_ms': round((time.monotonic() - start) * 1000)}
            add_usage(data, metrics)
        except ModelError as exc:
            attempt.update(outcome='provider_failed',error_code=exc.code)
            add_usage(data, {**exc.metrics, 'model_latency_ms': round((time.monotonic() - start) * 1000)})
            raise
        service.check_cancel(cancel)
        data.update(sql=candidate.sql, explanation=candidate.explanation, clarification=candidate.clarification)
        attempt.update(sql=candidate.sql,outcome='clarification' if candidate.clarification else 'generated')
        if candidate.clarification:
            emit('generate_sql', 'clarification', 'A business definition or question clarification is required.')
            return {'route': 'finish'}
        emit('generate_sql', 'completed', 'Candidate SQL received; execution requires validation.')
        return {'sql': candidate.sql, 'route': 'validate'}
    def validation(state):
        attempt=data['attempt_history'][-1]
        if sql_signature(state['sql']) in failed_queries:
            attempt.update(validation='stopped',outcome='repeated_sql',error_code='repeated_sql')
            emit('repair','stopped','A previously failed normalized SQL query was repeated. Stopping without executing it again.')
            raise ExecutionError('Model repeated a failed SQL query; retry stopped. Revise the question or confirmed types.','repeated_sql')
        try:
            sql = validate_sql(state['sql'], state['schema'])
            data['sql'] = sql
            attempt.update(sql=sql,validation='passed',outcome='validated')
            emit('validate', 'passed', 'Read-only SQL, relation scope, column references, functions and explicit types passed validation.')
            return {'sql': sql, 'route': 'execute', 'failure': ''}
        except GuardError as exc:
            failed_queries.add(sql_signature(state['sql']))
            attempt.update(validation='rejected',outcome='validation_failed',error_code='validation_error')
            emit('validate', 'rejected', str(exc))
            if data['attempts'] >= max_attempts:
                raise
            return {'route': 'repair', 'failure': str(exc)}
    def execute(state):
        attempt=data['attempt_history'][-1]
        data['status'] = 'executing'
        emit('execute', 'running', 'Executing validated SQL in the isolated read-only DuckDB worker.')
        start = time.monotonic()
        from .currency import mixed_aggregate
        currency_settings = service.knowledge.sync(data['dataset_id'])[3]
        if mixed_aggregate(state['sql'], currency_settings):
            data['clarification'] = 'This measure contains mixed source currencies. Select a dataset normalized to one confirmed currency, or query separate source-currency groups before aggregation.'
            return {'route': 'finish'}
        workspace = getattr(service, 'dashboard_workspace', None)
        source_revision = workspace.source_revision(data['dataset_id']) if workspace else None
        try:
            result = execute_isolated(path, state['sql'], data['type_mapping'], cancel)
            if workspace and workspace.source_revision(data['dataset_id']) == source_revision:
                result['source_revision'] = source_revision
        except ExecutionError as exc:
            attempt.update(execution='failed',outcome='execution_failed',error_code=exc.code)
            failed_queries.add(sql_signature(state['sql']))
            emit('execute', 'rejected', str(exc))
            if exc.code != 'execution_error' or data['attempts'] >= max_attempts:
                raise
            return {'route': 'repair', 'failure': str(exc)}
        finally:
            data['metrics']['query_latency_ms'] = data['metrics'].get('query_latency_ms', 0) + round((time.monotonic() - start) * 1000)
        service.check_cancel(cancel)
        attempt.update(execution='succeeded',outcome='succeeded')
        data['executed_sql'] = result.pop('executed_sql')
        data['conversions'].extend(explicit_cast_diagnostics(state['sql'], path, service.connector, data['type_mapping']))
        from .currency import annotate
        result['columns'] = annotate(state['sql'], result['columns'], currency_settings)
        from .percent_units import annotate_percent
        result['columns'] = annotate_percent(state['sql'], result['columns'], currency_settings)
        data['result_metadata'] = {'columns': result['columns'], 'row_count': result['row_count']}
        emit('execute', 'completed', f'{result["row_count"]} actual rows returned. Empty results are valid.' )
        return {'result': result, 'route': 'chart'}
    def repair(state):
        emit('repair', 'running', f'Preparing attempt {data["attempts"] + 1} of {max_attempts} after a recoverable SQL failure. This is syntax/execution repair, not semantic correctness verification.')
        return {'context': {**state['context'], 'repair_untrusted': {'previous_sql': state['sql'], 'validation_or_execution_error': state['failure'][:500],
                 'error_code':data['attempt_history'][-1]['error_code'], 'remaining_attempts':max_attempts-data['attempts'],
                 'instruction': 'Correct this SQL using only the authorized schema. Do not repeat failed SQL. Check types, grouping and DuckDB syntax. No new tables or business definitions. All SQL will be revalidated.'}}}
    def chart(state):
        analysis = {'charts': chart_options(state['result'])}
        data['chart_spec'] = analysis['charts']['recommended']['spec']
        emit('chart', 'completed', 'Validated chart choices against actual result types, rows, cardinality, finite values and null handling.')
        return {'analysis': analysis}
    def explain(state):
        evidence = compute_evidence(state['result'])
        data['result_digest'] = evidence['result_digest']
        data['evidence_count'] = len(evidence['facts'])
        warning = None
        narrative = ground_narrative({'fact_ids': [f['id'] for f in evidence['facts'][:4]]}, evidence)
        source = 'computed'
        if hasattr(provider, 'narrate'):
            try:
                selection, metrics = provider.narrate(data['question'], evidence)
                add_usage(data, metrics)
                narrative = ground_narrative(selection, evidence)
                source = 'model-selected computed facts'
            except (ModelError, ValueError) as exc:
                if isinstance(exc, ModelError):
                    add_usage(data, exc.metrics)
                warning = 'Narrative selection unavailable or rejected. Showing Python-computed facts only.'
        else:
            warning = 'This provider has no narrative selection capability. Showing computed facts.'
        service.check_cancel(cancel)
        emit('explain', 'completed', 'Computed evidence and grounded every displayed narrative statement to a known fact ID.' + (' ' + warning if warning else ''))
        return {'analysis': {**state['analysis'], 'evidence': evidence, 'narrative': narrative, 'narrative_source': source, 'warning': warning}}
    def finish(state):
        emit('finish', 'completed', 'Workflow completed; metadata and event history retained. Result rows expire after 10 minutes.' if 'result' in state else 'Awaiting clarification; no SQL executed.')
        return {'failure': ''}
    graph = StateGraph(State)
    for name, node in [('retrieve_context', retrieve), ('plan', plan), ('generate_sql', generate), ('validate', validation), ('execute', execute), ('repair', repair), ('chart', chart), ('explain', explain), ('finish', finish)]:
        def wrapped(state, node=node, name=name):
            emit(name, 'running', 'Starting ' + name.replace('_', ' ') + '.')
            return node(state)
        graph.add_node(name, wrapped)
    graph.set_entry_point('retrieve_context')
    graph.add_edge('retrieve_context', 'plan'); graph.add_edge('plan', 'generate_sql')
    for name in ('generate_sql', 'validate', 'execute'):
        graph.add_conditional_edges(name, lambda state: state['route'], {'finish': 'finish', 'validate': 'validate', 'execute': 'execute', 'repair': 'repair', 'chart': 'chart'})
    graph.add_edge('repair', 'generate_sql'); graph.add_edge('chart', 'explain'); graph.add_edge('explain', 'finish'); graph.add_edge('finish', END)
    with tracing_context(enabled=False):
        return graph.compile().invoke({'failure': ''}, config={'recursion_limit': 32})
