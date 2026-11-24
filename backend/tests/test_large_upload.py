"""PRODUCT-POLISH P4: big files. A SYNTHETIC file is generated inside the test (fictional, fixed seed, never committed). Controlled provider only; no live AI.
Budgets are seconds on a development laptop with generous headroom; the measured values are in docs/P4_LARGE_FILES.md."""
import io
import json
import os
import statistics
import time

import pytest

from app import main as app_main
from app.main import create_app, ingest_csv, iter_csv
from scripts.make_synthetic_csv import HEADER, lines
from tests.test_analyst import ControlledProvider, finish
from tests.test_phase3 import ControlledEmbedding
from fastapi.testclient import TestClient

ROWS = int(os.environ.get('P4_ROWS', '500000'))
BUDGET = {'upload_to_ready': 120.0, 'profile': 10.0, 'median_question': 6.0}
TYPES = {'quantity': 'BIGINT', 'unit_price': 'DOUBLE', 'revenue': 'DOUBLE', 'order_date': 'DATE'}
QUESTIONS = [
    'SELECT COUNT(*) AS orders FROM data',
    'SELECT SUM(revenue) AS total_revenue FROM data',
    'SELECT region, SUM(revenue) AS total_revenue FROM data GROUP BY region ORDER BY total_revenue DESC',
    'SELECT product, AVG(unit_price) AS average_price FROM data GROUP BY product ORDER BY product',
    'SELECT customer_id, SUM(revenue) AS total_revenue FROM data GROUP BY customer_id ORDER BY total_revenue DESC LIMIT 10',
]


def app_with(tmp_path, monkeypatch, mb=40, rows=None):
    monkeypatch.setenv('MAX_UPLOAD_MB', str(mb))
    monkeypatch.setenv('MAX_UPLOAD_ROWS', str(rows or ROWS))
    return create_app(tmp_path, provider=ControlledProvider(QUESTIONS[0]), embedder=ControlledEmbedding())


def test_a_big_synthetic_file_uploads_profiles_pages_and_answers_within_budget(tmp_path, monkeypatch):
    path = tmp_path / 'synthetic.csv'
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(HEADER)
        handle.writelines(lines(ROWS))
    application = app_with(tmp_path / 'ws', monkeypatch)
    timings = {}
    with TestClient(application) as c:
        started = time.monotonic()
        with open(path, 'rb') as handle:
            response = c.post('/api/datasets', files={'file': ('synthetic.csv', handle, 'text/csv')})
        timings['upload_to_ready'] = time.monotonic() - started
        assert response.status_code == 201, response.text
        item = response.json()
        assert item['rows'] == ROWS
        started = time.monotonic()
        profile = c.get(f"/api/datasets/{item['id']}/profile")
        timings['profile'] = time.monotonic() - started
        assert profile.status_code == 200
        # paging: the browser never receives more than one page, even at the far end
        last = c.get(f"/api/datasets/{item['id']}/preview?offset={ROWS - 5}&limit=25")
        assert last.status_code == 200 and len(last.json()['rows']) == 5 and last.json()['total'] == ROWS
        first = c.get(f"/api/datasets/{item['id']}/preview?offset=0&limit=100")
        assert len(first.json()['rows']) == 100
        durations = []
        for sql in QUESTIONS:
            application.state.analyst.provider.sql = sql
            started = time.monotonic()
            run = c.post('/api/analyst/runs', json={'dataset_id': item['id'], 'question': 'Q', 'type_mapping': TYPES})
            assert run.status_code == 202, run.text
            data = finish_slow(c, run.json()['id'])
            durations.append(time.monotonic() - started)
            assert data['status'] == 'succeeded', data
        timings['median_question'] = statistics.median(durations)
    print('\nP4 TIMINGS', json.dumps({k: round(v, 2) for k, v in timings.items()} | {'rows': ROWS, 'bytes': path.stat().st_size, 'each_question': [round(d, 2) for d in durations]}))
    for name, limit in BUDGET.items():
        assert timings[name] <= limit, f'{name} took {timings[name]:.1f}s; the budget is {limit}s'


def finish_slow(c, identifier, deadline=120):
    stop = time.monotonic() + deadline
    while time.monotonic() < stop:
        data = c.get('/api/analyst/runs/' + identifier).json()
        if data['status'] in {'succeeded', 'failed', 'clarification', 'cancelled'}:
            return data
        time.sleep(0.05)
    pytest.fail('question did not finish')


# ---- limits ---------------------------------------------------------------------------------------------------------
def test_the_size_limit_is_configurable_and_the_message_is_plain(tmp_path, monkeypatch):
    application = app_with(tmp_path, monkeypatch, mb=1)
    with TestClient(application) as c:
        big = b'a,b\n' + b'1,2\n' * 400_000                       # about 1.5 MB
        response = c.post('/api/datasets', files={'file': ('big.csv', big, 'text/csv')})
        assert response.status_code == 413 and response.json()['detail'] == 'Maximum upload size is 1 MB.'
        assert c.get('/api/health').json()['upload_limit_mb'] == 1
        assert list((tmp_path).glob('*.upload.tmp')) == [] and list(tmp_path.glob('*.duckdb')) == []        # nothing left behind


def test_a_body_with_no_declared_length_is_cut_off_at_the_limit(tmp_path, monkeypatch):
    application = app_with(tmp_path, monkeypatch, mb=1)

    def endless():
        yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\na,b\r\n'
        for _ in range(60):                                       # 60 MB, never declared up front
            yield b'1,2\r\n' * 200_000
    with TestClient(application) as c:
        response = c.post('/api/datasets', content=endless(), headers={'content-type': 'multipart/form-data; boundary=x'})
        assert response.status_code == 413


def test_the_row_limit_is_configurable_and_stops_before_any_heavy_work(tmp_path, monkeypatch):
    application = app_with(tmp_path, monkeypatch, rows=1000)
    csv_bytes = ('a,b\n' + ''.join(f'{i},x\n' for i in range(1001))).encode()
    with TestClient(application) as c:
        response = c.post('/api/datasets', files={'file': ('rows.csv', csv_bytes, 'text/csv')})
        assert response.status_code == 422 and response.json()['detail'] == 'Maximum 1,000 rows per dataset.'
        assert list(tmp_path.glob('*.duckdb')) == []


# ---- the fast load must read a file exactly like the careful row-by-row reader ------------------------------------------
TRICKY = [
    b'a,b,c\r\n1,"x, y",\r\n2,"line\r\nbreak",z\r\n',                          # CRLF, comma and newline inside quotes, empty cell
    b'\xef\xbb\xbfname,city\nAna,Z\xc3\xbcrich\nBo,"""quoted"""\n',            # BOM, unicode, escaped quotes
    b'a,b\n1,\n,2\n"",3\n',                                                      # empty and quoted-empty cells are all missing values
    b'only\nrow1\nrow2',                                                         # no trailing newline
]


@pytest.mark.parametrize('raw', TRICKY)
def test_fast_ingest_matches_the_exact_reader(tmp_path, raw):
    import duckdb
    source = tmp_path / 's.csv'
    source.write_bytes(raw)
    header, rows = iter_csv(io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8-sig', newline=''), 100)
    expected = [tuple(r) for r in rows]
    target = tmp_path / 'fast.duckdb'
    ingest_csv(source, target, header, len(expected))
    db = duckdb.connect(str(target), read_only=True)
    got = [tuple(r) for r in db.execute('SELECT * FROM records').fetchall()]
    assert got == expected


# ---- smaller answers for Home ---------------------------------------------------------------------------------------------
def test_the_recent_questions_list_has_a_compact_form(tmp_path, monkeypatch):
    from app.observability import COMPACT_KEYS
    application = app_with(tmp_path, monkeypatch)
    with TestClient(application) as c:
        csv_bytes = b'region,revenue\nNorth,10\nSouth,20\n'
        item = c.post('/api/datasets', files={'file': ('s.csv', csv_bytes, 'text/csv')}).json()
        application.state.analyst.provider.sql = 'SELECT SUM(revenue) AS total FROM data'
        run = c.post('/api/analyst/runs', json={'dataset_id': item['id'], 'question': 'Total?', 'type_mapping': {'revenue': 'DOUBLE'}}).json()
        finish_slow(c, run['id'])
        full = c.get('/api/analytics/runs').json()['recent'][0]
        slim = c.get('/api/analytics/runs?limit=1&compact=true').json()['recent']
        assert len(slim) == 1 and set(slim[0]) == set(COMPACT_KEYS) and slim[0]['id'] == full['id'] and slim[0]['question'] == 'Total?'
        assert len(json.dumps(slim)) < len(json.dumps(full)) / 3
        assert c.get('/api/analytics/runs?limit=0').status_code == 422
