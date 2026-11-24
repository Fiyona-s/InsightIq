"""Stage 3 final round: every successful answer stays with its question (approved 2026-11-17)."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app import analyst_results
from app.main import create_app
from tests.test_analyst import ControlledProvider, dataset, submit, finish
from tests.test_phase3 import ControlledEmbedding


def boot(root, sql='SELECT region, SUM(revenue) AS total FROM data GROUP BY region ORDER BY region'):
    return create_app(root, provider=ControlledProvider(sql=sql), embedder=ControlledEmbedding())


def rows_of(client, run_id):
    r = client.get(f'/api/analyst/runs/{run_id}/results')
    assert r.status_code == 200, r.text
    return r.json()['rows']


def test_answer_survives_the_ten_minute_cache_and_is_listed_as_available(tmp_path):
    app = boot(tmp_path)
    with TestClient(app) as c:
        ds = dataset(c); run = finish(c, submit(c, ds)); assert run['status'] == 'succeeded'
        first = rows_of(c, run['id'])
        app.state.analyst.results.clear()  # what ten minutes (or a busy cache) does
        assert rows_of(c, run['id']) == first and first
        assert c.get('/api/analyst/runs/' + run['id']).json()['results_available'] is True
        assert c.get(f"/api/analyst/runs/{run['id']}/results.csv").status_code == 200
        assert c.post(f"/api/analyst/runs/{run['id']}/chart", json={'kind': 'table', 'x': None, 'y': None, 'title': 'Results', 'null_policy': 'omit_with_count', 'zero_baseline': True}).status_code == 200


def test_answer_survives_a_restart_of_the_application(tmp_path):
    with TestClient(boot(tmp_path)) as c:
        ds = dataset(c); run = finish(c, submit(c, ds)); expected = rows_of(c, run['id'])
    with TestClient(boot(tmp_path)) as c2:  # a brand new process: memory cache is empty
        assert c2.get('/api/analyst/runs/' + run['id']).json()['results_available'] is True
        assert rows_of(c2, run['id']) == expected


def test_a_question_without_a_saved_answer_still_says_so(tmp_path):
    """Older runs are never backfilled (Rule 6): without a saved row the old behaviour stays."""
    app = boot(tmp_path)
    with TestClient(app) as c:
        ds = dataset(c); run = finish(c, submit(c, ds))
        with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
            db.execute('DELETE FROM analyst_run_results WHERE run_id=?', (run['id'],))
        app.state.analyst.results.clear()
        assert c.get('/api/analyst/runs/' + run['id']).json()['results_available'] is False
        assert c.get(f"/api/analyst/runs/{run['id']}/results").status_code == 410


def test_each_answer_is_stored_under_its_own_run_id(tmp_path):
    with TestClient(boot(tmp_path)) as c:
        ds = dataset(c)
        a = finish(c, submit(c, ds, question='first')); b = finish(c, submit(c, ds, question='second'))
        assert a['id'] != b['id']
        with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
            ids = {r[0] for r in db.execute('SELECT run_id FROM analyst_run_results')}
        assert {a['id'], b['id']} <= ids


def test_failed_questions_store_nothing(tmp_path):
    with TestClient(boot(tmp_path, sql='SELECT nope FROM data')) as c:
        ds = dataset(c); run = finish(c, submit(c, ds))
        assert run['status'] == 'failed'
        with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
            assert db.execute('SELECT COUNT(*) FROM analyst_run_results WHERE run_id=?', (run['id'],)).fetchone()[0] == 0


def test_only_the_newest_answers_are_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(analyst_results, 'KEEP', 2)
    with TestClient(boot(tmp_path)) as c:
        ds = dataset(c)
        runs = [finish(c, submit(c, ds, question=f'q{i}')) for i in range(3)]
        with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
            kept = {r[0] for r in db.execute('SELECT run_id FROM analyst_run_results')}
        assert len(kept) == 2 and runs[2]['id'] in kept


def test_oversized_answers_are_not_stored_and_do_not_fail_the_question(tmp_path):
    with TestClient(boot(tmp_path)) as c:
        store = c.app.state.analyst.saved_results
        assert store.save('x', {'rows': [[i] for i in range(analyst_results.MAX_ROWS + 1)], 'row_count': 1001}) is False
        assert store.save('y', {'rows': [['z' * (analyst_results.MAX_BYTES + 10)]], 'row_count': 1}) is False
        assert store.save('z', {'rows': [[1]], 'row_count': 1, 'columns': []}) is True


def test_run_again_uses_the_saved_sql_on_current_data_without_the_ai_and_keeps_the_old_answer(tmp_path):
    provider = ControlledProvider(sql='SELECT SUM(revenue) AS total FROM data')
    app = create_app(tmp_path, provider=provider, embedder=ControlledEmbedding())
    with TestClient(app) as c:
        ds = dataset(c)
        first = finish(c, submit(c, ds))
        before = rows_of(c, first['id'])
        calls = {'n': 0}
        original = provider.generate
        def counting(*a, **k):
            calls['n'] += 1
            return original(*a, **k)
        provider.generate = counting
        r = c.post(f"/api/analyst/runs/{first['id']}/rerun")
        assert r.status_code == 201, r.text
        again = r.json()
        assert calls['n'] == 0                                   # no model call
        assert again['id'] != first['id'] and again['thread_id'] == first['thread_id'] and again['status'] == 'succeeded'
        assert again['executed_sql'] == first['executed_sql'] and again['results_available'] is True
        assert rows_of(c, again['id']) == before
        assert rows_of(c, first['id']) == before                 # the earlier answer is untouched
        assert c.get('/api/analyst/runs/' + again['id']).json()['id'] == again['id']


def test_run_again_refuses_unanswered_questions(tmp_path):
    with TestClient(boot(tmp_path, sql='SELECT nope FROM data')) as c:
        ds = dataset(c); failed = finish(c, submit(c, ds))
        assert failed['status'] == 'failed'
        assert c.post(f"/api/analyst/runs/{failed['id']}/rerun").status_code == 409
