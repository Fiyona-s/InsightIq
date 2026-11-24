import json
import os
import sys
import threading
import time
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import create_app, connect
from app.execution import ExecutionError, execute_isolated
from app.provider import Generation, LLMProvider, ModelError, estimate_cost
from app.sql_guard import GuardError, validate_sql

SCHEMA = {'id': 'VARCHAR', 'revenue': 'DOUBLE', 'order_date': 'DATE', 'region': 'VARCHAR'}
CSV = b'id,revenue,order_date,region\n001,10.5,2026-01-02,North\n002,20,2026-02-03,West\n003,bad,bad,North\n004,,,West\n'


class ControlledProvider:
    """Test-only provider boundary. SQL still uses the real guard and OS worker."""
    model = 'test-provider'
    def __init__(self, sql='SELECT SUM(revenue) AS total FROM data', clarification=None, error=None, pause=None):
        self.sql, self.clarification, self.error, self.pause = sql, clarification, error, pause
        self.context = None
    def generate(self, question, context):
        self.context = context
        if self.pause:
            self.pause.wait(timeout=2)
        if self.error:
            raise self.error
        return Generation(sql=None if self.clarification else self.sql, clarification=self.clarification,
                          explanation='Aggregate the confirmed revenue column.'), {'model': self.model, 'prompt_tokens': 50, 'completion_tokens': 20, 'total_tokens': 70, 'estimated_cost_usd': None}


def dataset(client, raw=CSV):
    response = client.post('/api/datasets', files={'file': ('controlled-test.csv', raw)})
    assert response.status_code == 201
    return response.json()['id']


def submit(client, identifier, mapping=None, question='What is total revenue?'):
    response = client.post('/api/analyst/runs', json={'dataset_id': identifier, 'question': question,
                            'type_mapping': mapping if mapping is not None else {'revenue': 'DOUBLE', 'order_date': 'DATE'}})
    assert response.status_code == 202, response.text
    return response.json()['id']


def finish(client, identifier):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        response = client.get('/api/analyst/runs/' + identifier)
        assert response.status_code == 200
        data = response.json()
        if data['status'] in {'succeeded', 'failed', 'clarification', 'cancelled'}:
            return data
        time.sleep(.02)
    pytest.fail('Run did not finish within test deadline')


@pytest.mark.parametrize('sql', [
    'SELECT sum(revenue) AS total FROM data',
    'SELECT a.id,b.region FROM data a JOIN data b ON a.id=b.id',
    'WITH totals AS (SELECT region, sum(revenue) AS total FROM data GROUP BY region) SELECT * FROM totals ORDER BY total DESC',
    "SELECT count(*) FROM data WHERE order_date >= CAST('2026-02-01' AS DATE)",
    'SELECT count(DISTINCT region) FROM data',
    'SELECT id FROM data UNION SELECT id FROM data',
    'SELECT id FROM data WHERE revenue IS NULL',
])
def test_valid_sql(sql):
    assert validate_sql(sql, SCHEMA)


@pytest.mark.parametrize('sql', [
    'SELECT nonexistent FROM data', 'SELECT hidden.* FROM data', 'SELECT * FROM records',
    'SELECT * FROM other', 'SELECT * FROM main.data', 'SELECT * FROM information_schema.tables',
    'SELECT * FROM data; DROP TABLE records', 'DELETE FROM data', 'CREATE TABLE x AS SELECT * FROM data',
    "COPY data TO '/tmp/out.csv'", "ATTACH '/tmp/x' AS other", 'INSTALL httpfs',
    "SELECT * FROM read_csv('/etc/passwd')", "SELECT * FROM read_parquet('https://example.com/x')",
    "SELECT * FROM '/etc/passwd'", "SELECT getenv('LLM_API_KEY') FROM data", 'SELECT current_setting(\'home_directory\') FROM data',
    'SELECT * FROM duckdb_settings()', 'SELECT * FROM query(\'SELECT * FROM records\')',
    'SELECT * FROM range(1000000000)', 'SELECT * FROM glob(\'/tmp/*\')',
    'WITH RECURSIVE x AS (SELECT 1 UNION ALL SELECT * FROM x) SELECT * FROM x',
    'WITH data AS (SELECT 1) SELECT * FROM data', 'SELECT CAST(id AS BIGINT) FROM data',
    'SELECT CAST(id AS JSON) FROM data', 'SELECT SUM(revenue) OVER () FROM data',
    'SELECT * INTO x FROM data', 'PRAGMA database_list', 'EXPLAIN SELECT * FROM data',
    'SELECT * FROM data FOR UPDATE', 'SELECT 1', 'SELECT * FROM data; --tail\nSELECT 2',
    'SELECT d.ghost FROM data d', 'WITH x AS (SELECT id FROM data) SELECT ghost FROM x',
    'SELECT * FROM data a JOIN data b ON a.id=b.unknown',
    'SELECT * FROM data a JOIN data b ON id=id',
])
def test_adversarial_sql_rejected(sql):
    with pytest.raises(GuardError):
        validate_sql(sql, SCHEMA)


def test_worker_numeric_date_join_and_raw_preserved(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client)
        path = tmp_path / (identifier + '.duckdb')
        sql = validate_sql("SELECT SUM(revenue) AS total FROM data WHERE order_date >= CAST('2026-02-01' AS DATE)", SCHEMA)
        result = execute_isolated(path, sql, {'revenue': 'DOUBLE', 'order_date': 'DATE'})
        assert result['rows'] == [[20.0]]
        assert result['columns'][0]['type'] == 'DOUBLE'
        joined = execute_isolated(path, validate_sql('SELECT a.id, b.region FROM data a JOIN data b ON a.id=b.id ORDER BY a.id', SCHEMA))
        assert joined['row_count'] == 4
        assert joined['rows'][0] == ['001', 'North']
        assert client.get(f'/api/datasets/{identifier}/preview').json()['rows'][0][0] == '001'


def test_profile_exact_missing_failures_and_identifiers(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client)
        columns = client.get(f'/api/datasets/{identifier}/profile').json()['columns']
        assert columns[0]['suggested_type'] == 'VARCHAR'
        assert columns[1]['missing'] == 1
        assert columns[1]['conversions']['DOUBLE'] == {'valid': 2, 'failed': 1}
        assert columns[2]['conversions']['DATE'] == {'valid': 2, 'failed': 1}
        assert columns[3]['suggested_type'] == 'VARCHAR'


@pytest.mark.parametrize('sql,expected_rows', [
    ('SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data', [[30.5]]),
    ('SELECT count(*) AS n FROM data WHERE revenue > 100000', [[0]]),
    ('SELECT id FROM data WHERE revenue > 100000', []),
])
def test_run_actual_results_and_metadata_only_history(tmp_path, sql, expected_rows):
    provider = ControlledProvider(sql)
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        identifier = dataset(client)
        run_id = submit(client, identifier)
        run = finish(client, run_id)
        assert run['status'] == 'succeeded', run
        page = client.get(f'/api/analyst/runs/{run_id}/results').json()
        assert page['rows'] == expected_rows
        assert run['executed_sql'] and run['metrics']['total_latency_ms'] > 0
        assert run['conversions'][0]['failed'] == 1
        assert 'rows' not in run['result_metadata']
        assert 'rows' not in run
        assert provider.context['table'] == 'data'
        assert provider.context['columns'][1]['type'] == 'DOUBLE'
        assert 'North' not in json.dumps(provider.context)  # no cell contents sent to model
        export = client.get(f'/api/analyst/runs/{run_id}/results.csv')
        assert export.status_code == 200
        assert 'attachment' in export.headers['content-disposition']
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        run = client.get(f'/api/analyst/runs/{run_id}').json()
        assert run['status'] == 'succeeded'
        # Stage 3: the answer is saved with its question, so a restart no longer loses it (it used to answer 410).
        assert run['results_available'] is True
        assert client.get(f'/api/analyst/runs/{run_id}/results').json()['rows'] == expected_rows


def test_clarification_and_provider_error_are_saved(tmp_path):
    provider = ControlledProvider(clarification='Which revenue definition should I use?')
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        identifier = dataset(client)
        run = finish(client, submit(client, identifier))
        assert run['status'] == 'clarification'
        assert run['sql'] is None and not run['results_available']
        provider.clarification = None
        provider.error = ModelError('Provider denied access.', 'provider_auth')
        failed = finish(client, submit(client, identifier))
        assert failed['error_code'] == 'provider_auth'
        assert len(client.get('/api/analyst/runs').json()) == 2


def test_invalid_sql_saved_without_execution(tmp_path):
    provider = ControlledProvider('SELECT * FROM read_csv(\'/etc/passwd\')')
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        run = finish(client, submit(client, dataset(client)))
        assert run['status'] == 'failed' and run['error_code'] == 'repeated_sql'
        assert run['attempts'] == 2
        assert any(e['step'] == 'validate' and e['status'] == 'rejected' for e in run['events'])
        assert run['executed_sql'] is None


def test_missing_credentials_and_invalid_requests(tmp_path, monkeypatch):
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client)
        failed = finish(client, submit(client, identifier))
        assert failed['error_code'] == 'not_configured'
        assert 'LLM_API_KEY' in failed['error']
        for body in [{'dataset_id': identifier, 'question': ' '}, {'dataset_id': identifier, 'question': 'q', 'type_mapping': {'missing': 'DOUBLE'}},
                     {'dataset_id': identifier, 'question': 'q', 'type_mapping': {'id': 'JSON'}}, {'dataset_id': identifier, 'question': 'q', 'sql': 'SELECT 1'}]:
            assert client.post('/api/analyst/runs', json=body).status_code == 422
        assert client.post('/api/analyst/runs', json={'dataset_id': str(uuid4()), 'question': 'q'}).status_code == 404
        assert client.get(f'/api/analyst/runs/{uuid4()}').status_code == 404
        assert client.post('/api/analyst/runs', content=b'x' * 17000).status_code == 413


def test_cancel_and_concurrency(tmp_path):
    release = threading.Event()
    provider = ControlledProvider(pause=release)
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        identifier = dataset(client)
        first, second = submit(client, identifier), submit(client, identifier)
        assert client.post('/api/analyst/runs', json={'dataset_id': identifier, 'question': 'q'}).status_code == 429
        assert client.delete('/api/analyst/runs/' + first).status_code == 200
        client.delete('/api/analyst/runs/' + second)
        release.set()
        assert finish(client, first)['status'] == 'cancelled'
        assert finish(client, second)['status'] == 'cancelled'


def test_worker_limits_timeout_cancel_and_revalidation(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client, b'id\n' + b'x\n' * 1001)
        path = tmp_path / (identifier + '.duckdb')
        with pytest.raises(ExecutionError) as error:
            execute_isolated(path, 'SELECT * FROM data')
        assert error.value.code == 'result_limit'
        assert execute_isolated(path, 'SELECT * FROM data LIMIT 5')['row_count'] == 5
        with pytest.raises(ExecutionError) as error:
            execute_isolated(path, 'SELECT * FROM data', timeout=.001)
        assert error.value.code == 'timeout'
        cancelled = threading.Event(); cancelled.set()
        with pytest.raises(ExecutionError) as error:
            execute_isolated(path, 'SELECT * FROM data', cancel=cancelled)
        assert error.value.code == 'cancelled'
        for unsafe in ['DELETE FROM records', "SELECT * FROM read_csv('/etc/passwd')"]:
            with pytest.raises(ExecutionError):
                execute_isolated(path, unsafe)
        assert client.get(f'/api/datasets/{identifier}/preview').json()['total'] == 1001


def test_provider_request_contract_usage_and_errors(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'test-only-never-real')
    monkeypatch.setenv('LLM_MODEL', 'controlled-model')
    monkeypatch.setenv('LLM_INPUT_USD_PER_MILLION', '1')
    monkeypatch.setenv('LLM_OUTPUT_USD_PER_MILLION', '2')
    def handle(request):
        body = json.loads(request.content)
        assert body['response_format']['json_schema']['strict'] is True
        assert body['messages'][0]['role'] == 'system'
        assert body['model'] == 'controlled-model'
        return httpx.Response(200, json={'model': 'controlled-model', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'sql': 'SELECT count(*) FROM data', 'clarification': None, 'explanation': 'Count records.'})}}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}})
    provider = LLMProvider(httpx.MockTransport(handle))
    plan, metrics = provider.generate('How many?', {'table': 'data', 'columns': []})
    assert plan.sql == 'SELECT count(*) FROM data'
    assert metrics['estimated_cost_usd'] == .00002
    for status, code in [(401, 'provider_auth'), (403, 'provider_auth'), (429, 'provider_rate_limit'), (500, 'provider_error')]:
        provider.transport = httpx.MockTransport(lambda _: httpx.Response(status, text='secret provider body'))
        with pytest.raises(ModelError) as error:
            provider.generate('q', {})
        assert error.value.code == code and 'secret' not in str(error.value)
    provider.transport = httpx.MockTransport(lambda _: httpx.Response(200, json={'choices': []}))
    with pytest.raises(ModelError, match='invalid structured'):
        provider.generate('q', {})
    def timeout(_):
        raise httpx.ReadTimeout('sensitive details')
    provider.transport = httpx.MockTransport(timeout)
    with pytest.raises(ModelError) as error:
        provider.generate('q', {})
    assert error.value.code == 'provider_timeout'
    monkeypatch.delenv('LLM_INPUT_USD_PER_MILLION')
    assert estimate_cost({'prompt_tokens': 1, 'completion_tokens': 1}) is None


def test_os_sandbox_denies_unrelated_files_network_and_writes(tmp_path):
    import subprocess
    import socket
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client)
        path = tmp_path / (identifier + '.duckdb')
    secret = tmp_path / 'unrelated.txt'
    secret.write_text('must-not-be-readable')
    # Trusted probe bypasses the SQL guard to exercise the actual OS boundary.
    script = '''
import sys,json,socket
sys.path.insert(0, sys.argv[1])
from query_worker import restrict_os
import duckdb
from pathlib import Path
p=Path(sys.argv[2])
db=duckdb.connect(str(p),read_only=True,config={'enable_external_access':'false','threads':'1'})
restrict_os(p)
blocked=[]
def network():
 s=socket.socket();s.settimeout(.5);s.connect(('127.0.0.1',int(sys.argv[4])));s.close()
for action in [lambda:open(sys.argv[3]).read(),network,lambda:open(sys.argv[3],'w'),lambda:db.execute('DELETE FROM records')]:
 try:
  action();blocked.append(False)
 except Exception:
  blocked.append(True)
print(json.dumps(blocked))
'''
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        output = subprocess.run([sys.executable, '-I', '-c', script, str(Path(__file__).resolve().parents[1] / 'app'), str(path), str(secret), str(listener.getsockname()[1])], capture_output=True, text=True, timeout=5, check=True)
    assert json.loads(output.stdout) == [True, True, True, True]
    assert secret.read_text() == 'must-not-be-readable'


def test_big_result_bytes_and_csv_formula_protection(tmp_path):
    provider = ControlledProvider('SELECT * FROM data')
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        identifier = dataset(client, b'id\n' + (b'x'*10000+b'\n')*110)
        run = finish(client, submit(client, identifier, mapping={}, question='List all rows'))
        assert run['status'] == 'failed' and run['error_code'] == 'result_limit'
        identifier = dataset(client, b'id\n=1+1\n@command\n')
        run = finish(client, submit(client, identifier, mapping={}, question='List ids'))
        text = client.get(f"/api/analyst/runs/{run['id']}/results.csv").text
        assert "'=1+1" in text and "'@command" in text
        assert client.get(f"/api/analyst/runs/{run['id']}/results").json()['rows'] == [['=1+1'], ['@command']]


@pytest.mark.parametrize('sql', ['SELECT SUM(id) FROM data', 'SELECT id+1 FROM data', 'SELECT id FROM data WHERE id>1', 'SELECT COALESCE(id, 0) FROM data', 'SELECT id FROM data WHERE id BETWEEN 1 AND 2', 'SELECT id FROM data WHERE id IN (1,2)'])
def test_no_implicit_numeric_conversion(sql):
    with pytest.raises(GuardError, match='text|Mixed'):
        validate_sql(sql, SCHEMA)


def test_inference_avoids_rounding_decimal_values_and_dropping_time(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client, b'value,at\n10.5,2026-01-01 12:30:00\n20,2026-02-01 18:00:00\n')
        profile = client.get(f'/api/datasets/{identifier}/profile').json()
        assert profile['columns'][0]['suggested_type'] == 'DOUBLE'
        assert profile['columns'][0]['conversions']['BIGINT']['failed'] == 1
        assert profile['columns'][1]['suggested_type'] == 'TIMESTAMP'
        result = execute_isolated(tmp_path / (identifier + '.duckdb'), 'SELECT SUM(value) FROM data', {'value': 'BIGINT'})
        assert result['rows'] == [[20]]


def test_active_query_cancellation_and_hard_deadline(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        identifier = dataset(client, ('id\n' + '\n'.join(str(i) for i in range(2000)) + '\n').encode())
    path = tmp_path / (identifier + '.duckdb')
    sql = 'SELECT SUM(a.id*b.id*c.id) FROM data a CROSS JOIN data b CROSS JOIN data c'
    start = time.monotonic()
    with pytest.raises(ExecutionError) as error:
        execute_isolated(path, sql, {'id': 'BIGINT'}, timeout=.8)
    assert error.value.code == 'timeout'
    assert time.monotonic() - start < 3
    event = threading.Event()
    timer = threading.Timer(.5, event.set); timer.start()
    try:
        with pytest.raises(ExecutionError) as error:
            execute_isolated(path, sql, {'id': 'BIGINT'}, cancel=event)
        assert error.value.code == 'cancelled'
    finally:
        timer.cancel()


def test_result_pagination_expiry_and_interrupted_restart(tmp_path):
    provider = ControlledProvider('SELECT id FROM data ORDER BY id')
    app = create_app(tmp_path, provider=provider)
    with TestClient(app) as client:
        identifier = dataset(client, ('id\n' + '\n'.join(f'{i:03}' for i in range(30))+'\n').encode())
        run_id = submit(client, identifier, mapping={})
        run = finish(client, run_id)
        assert run['status'] == 'succeeded'
        page = client.get(f'/api/analyst/runs/{run_id}/results?offset=25&limit=25').json()
        assert page['rows'] == [[f'{i:03}'] for i in range(25,30)]
        assert page['row_count'] == 30
        service = app.state.analyst
        with service.lock:
            expiry, result = service.results[run_id]
            service.results[run_id] = (time.monotonic()-1, result)
        # Stage 3: the short cache expired, but the answer is saved with its question, so it is still served.
        assert client.get(f'/api/analyst/runs/{run_id}/results').json()['row_count'] == 30
        # A run with no saved answer (an older run) still reports expiry exactly as before.
        import sqlite3
        with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
            db.execute('DELETE FROM analyst_run_results WHERE run_id=?', (run_id,))
        with service.lock:
            service.results.clear()
        assert client.get(f'/api/analyst/runs/{run_id}/results').status_code == 410
        assert client.get(f'/api/analyst/runs/{run_id}').json()['result_metadata']['row_count'] == 30
        run['status'] = 'executing'
        service.save(run)
    with TestClient(create_app(tmp_path)) as client:
        recovered = client.get(f'/api/analyst/runs/{run_id}').json()
        assert recovered['status'] == 'failed' and recovered['error_code'] == 'interrupted'


def test_explicit_try_cast_diagnostics_with_raw_values(tmp_path):
    provider = ControlledProvider('SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data')
    with TestClient(create_app(tmp_path, provider=provider)) as client:
        run = finish(client, submit(client, dataset(client), mapping={}))
        assert run['status'] == 'succeeded'
        assert run['conversions'] == [{'column': 'revenue', 'type': 'DOUBLE', 'missing': 1, 'failed': 1}]
        assert client.get(f"/api/analyst/runs/{run['id']}/results").json()['rows'] == [[30.5]]


def test_provider_hard_deadline_and_refusal_usage(monkeypatch):
    import asyncio
    from app import provider as provider_module
    monkeypatch.setenv('LLM_API_KEY', 'test-only')
    monkeypatch.setenv('LLM_MODEL', 'test-model')
    monkeypatch.setattr(provider_module, 'MODEL_TIMEOUT_SECONDS', .01)
    async def slow(_):
        await asyncio.sleep(1)
        return httpx.Response(200, json={})
    provider = LLMProvider(httpx.MockTransport(slow))
    start = time.monotonic()
    with pytest.raises(ModelError) as error:
        provider.generate('q', {})
    assert error.value.code == 'provider_timeout'
    assert time.monotonic() - start < .5
    provider.transport = httpx.MockTransport(lambda _: httpx.Response(200, json={
        'choices': [{'finish_reason': 'stop', 'message': {'refusal': 'no'}}],
        'usage': {'prompt_tokens': 20, 'completion_tokens': 2, 'total_tokens': 22}}))
    with pytest.raises(ModelError) as error:
        provider.generate('q', {})
    assert error.value.code == 'provider_response'
    assert error.value.metrics['total_tokens'] == 22
