"""P4: the independent checker (scripts/verify_demo.py) agrees with a plain-Python calculation, so it can be trusted as a second opinion."""
import csv
import json

import pytest

pd = pytest.importorskip('pandas')
import importlib.util  # noqa: E402
from pathlib import Path  # noqa: E402

_spec = importlib.util.spec_from_file_location('verify_demo', Path(__file__).resolve().parents[2] / 'scripts' / 'verify_demo.py')
verify_demo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(verify_demo)

ROWS = [['o1', 'North', '3', '10.5'], ['o2', 'South', '1', '4'], ['o3', 'North', '5', '2.25'], ['o4', 'East', '2', '8']]


def test_each_supported_form_matches_plain_python(tmp_path, capsys):
    path = tmp_path / 'f.csv'
    with open(path, 'w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['order_id', 'region', 'quantity', 'price'])
        writer.writerows(ROWS)
    questions = [
        {'question': 'count', 'compute': {'op': 'count'}},
        {'question': 'total', 'compute': {'op': 'sum', 'column': 'price'}},
        {'question': 'by region', 'compute': {'op': 'sum', 'column': 'price', 'by': 'region', 'order': 'desc'}},
        {'question': 'north', 'compute': {'op': 'sum', 'column': 'price', 'where': [{'column': 'region', 'is': 'North'}]}},
        {'question': 'big orders', 'compute': {'op': 'count', 'column': 'order_id', 'where': [{'column': 'quantity', 'gt': 2}]}},
    ]
    qpath = tmp_path / 'q.json'
    qpath.write_text(json.dumps(questions))
    out = tmp_path / 'out.json'
    assert verify_demo.main(['--csv', str(path), '--questions', str(qpath), '--json', str(out)]) == 0
    got = {r['question']: r['expected'] for r in json.loads(out.read_text())}
    assert got['count'] == 4
    assert got['total'] == pytest.approx(sum(float(r[3]) for r in ROWS))
    assert got['by region'][0] == ['North', pytest.approx(12.75)]
    assert got['north'] == pytest.approx(12.75)
    assert got['big orders'] == 2
    assert 'Expected answer (pandas)' in capsys.readouterr().out
