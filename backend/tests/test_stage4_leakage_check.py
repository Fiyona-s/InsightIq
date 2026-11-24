"""Stage 4: the read-only data-leakage warning (approved exception 3c, WARNING ONLY).

Throwaway data and no AI. Proves the detection rules and thresholds of docs/LEAKAGE_WARNING.md, that
the check never writes, never blocks, is project-scoped, and does not touch the protected AutoML code.
"""
import hashlib
import pathlib
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import leakage_check as lc
from app.leakage_check import check
from tests.test_phase4 import make_app
from tests.test_stage2_projects import H, upload, use

HEAD = ['order_id', 'region', 'units', 'status', 'revenue']


def orders(n=200, cancelled_every=5):
    rows = []
    for i in range(n):
        cancelled = i % cancelled_every == 0
        units = 1 + i % 6
        rows.append([str(1000 + i), ['N', 'S', 'E', 'W'][i % 4], str(units), 'cancelled' if cancelled else 'completed', '0' if cancelled else str(units * 25)])
    return rows


def test_rule_a_a_value_that_always_means_one_outcome():
    found = check(HEAD, orders(), 'classification', 'status', ['region', 'units', 'revenue'])
    assert [f['column'] for f in found] == ['revenue']
    f = found[0]
    assert f['rule'] == 'A' and f['evidence'] == {'value': '0', 'outcome': 'cancelled', 'rows': 40}
    assert f['sentence'] == 'When revenue is 0, status is always cancelled (40 of 40 rows).'


def test_rule_a_needs_enough_rows_and_not_the_usual_outcome():
    few = orders(n=200, cancelled_every=40)                  # only 5 cancelled rows: below 10 rows
    assert [f['rule'] for f in check(HEAD, few, 'classification', 'status', ['revenue'])] != ['A']   # too few rows for rule A
    usual = [r[:3] + ['completed'] + [r[4]] for r in orders()]  # one outcome only: nothing to give away
    assert check(HEAD, usual, 'classification', 'status', ['revenue']) == []


def test_rule_b_a_column_that_nearly_decides_the_target():
    mapping = {'a': 'cancelled', 'b': 'cancelled', 'c': 'completed', 'd': 'completed'}
    rows = []
    for i in range(200):
        group = 'abcd'[i % 4]
        outcome = mapping[group] if i >= 4 else ('completed' if mapping[group] == 'cancelled' else 'cancelled')   # one exception per group
        rows.append([str(i), group, outcome])
    found = check(['id', 'payment', 'status'], rows, 'classification', 'status', ['payment'])
    assert [f['rule'] for f in found] == ['B']
    assert found[0]['evidence']['coverage'] >= lc.RULE_B_COVERAGE


def test_an_identifier_is_not_mistaken_for_a_rule():
    rows = [[str(i), 'cancelled' if i % 5 == 0 else 'completed'] for i in range(200)]
    assert check(['order_id', 'status'], rows, 'classification', 'status', ['order_id']) == []   # 200 distinct values


def test_rule_c_numeric_near_copy_and_exact_copy():
    rows = [[str(i), str(i * 2), str(i * 2 + (i % 2) * 0.01), str((i * 7) % 13)] for i in range(100)]
    head = ['id', 'total', 'total_with_tax', 'noise']
    found = check(head, [[r[0], r[1], r[2], r[3]] for r in rows], 'regression', 'total', ['total_with_tax', 'noise'])
    assert [f['column'] for f in found] == ['total_with_tax'] and found[0]['rule'] == 'C'
    exact = check(['a', 'b'], [[str(i), str(i)] for i in range(30)], 'regression', 'a', ['b'])
    assert exact[0]['rule'] == 'C' and exact[0]['evidence']['correlation'] == 1.0


def test_other_tasks_and_unknown_columns_return_nothing():
    for task in ('clustering', 'anomaly', 'forecasting'):
        assert check(HEAD, orders(), task, 'status', ['revenue']) == []
    assert check(HEAD, orders(), 'classification', 'nope', ['revenue']) == []
    assert check(HEAD, orders(), 'classification', 'status', ['status', 'missing']) == []


def csv_bytes(rows=None):
    return ('\n'.join([','.join(HEAD)] + [','.join(r) for r in (rows or orders())]) + '\n').encode()


def fingerprint(root):
    digest = hashlib.sha256()
    for path in sorted(pathlib.Path(root).rglob('*')):
        if path.is_file() and 'backups' not in path.parts and path.suffix in {'.duckdb', '.sqlite'} and 'catalog' not in path.name:
            digest.update(path.read_bytes())
    with sqlite3.connect(pathlib.Path(root) / 'catalog.sqlite') as db:
        digest.update(repr([db.execute(f'SELECT COUNT(*) FROM {t}').fetchone() for t in ('datasets', 'analyst_runs', 'ml_experiments', 'ml_models')]).encode())
    return digest.hexdigest()


def test_route_returns_findings_never_writes_and_never_trains(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        ds = upload(c, 'orders.csv', csv_bytes())
        before = fingerprint(tmp_path)
        r = c.post(f'/api/datasets/{ds}/leakage-check', json={'task': 'classification', 'target': 'status', 'features': ['region', 'units', 'revenue']})
        assert r.status_code == 200, r.text
        body = r.json()
        assert [f['column'] for f in body['findings']] == ['revenue'] and body['rows_checked'] == 200
        assert body['thresholds']['rule_c_correlation'] == 0.98
        assert fingerprint(tmp_path) == before                       # read-only: nothing changed
        assert c.get('/api/automl/experiments').json() == []         # and nothing was trained
        bad = c.post(f'/api/datasets/{ds}/leakage-check', json={'task': 'classification', 'target': 'nope', 'features': []})
        assert bad.status_code == 422
        extra = c.post(f'/api/datasets/{ds}/leakage-check', json={'task': 'classification', 'target': 'status', 'features': [], 'train': True})
        assert extra.status_code == 422


def test_route_is_project_scoped(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        a = c.post('/api/projects', json={'name': 'Shop A'}).json()['id']
        b = c.post('/api/projects', json={'name': 'Shop B'}).json()['id']
        use(c, a)
        ds = upload(c, 'a-orders.csv', csv_bytes())
        assert c.post(f'/api/datasets/{ds}/leakage-check', json={'task': 'classification', 'target': 'status', 'features': ['revenue']}).status_code == 200
        use(c, b)
        assert c.post(f'/api/datasets/{ds}/leakage-check', json={'task': 'classification', 'target': 'status', 'features': ['revenue']}).status_code == 404


def test_the_module_never_touches_the_protected_automl_package():
    source = pathlib.Path(lc.__file__).read_text()
    assert 'automl' not in source.replace('protected `automl` package', '').replace('`automl`', '')
    assert 'import' in source and 'openai' not in source and 'provider' not in source
