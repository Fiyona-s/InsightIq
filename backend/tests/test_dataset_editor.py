"""Dataset edit integration tests use the real API, DuckDB and SQLite."""
import csv
import io
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import create_app, connect


@pytest.fixture
def workspace(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        item = client.post('/api/datasets', files={'file': ('unicode.csv', 'name,amount\nα,10\nβ,20\nγ,30\n'.encode(), 'text/csv')}).json()
        yield client, tmp_path, '/api/datasets/' + item['id']


def batch(version=1, **kw):
    return dict(expected_version=version, type_mapping={'name': 'VARCHAR', 'amount': 'BIGINT'}, **kw)


def test_edit_add_delete_restart_csv_profile(workspace):
    client, root, path = workspace
    page = client.get(path + '/rows?sort=name&descending=true&limit=1').json()
    assert page['rows'][0]['values'] == ['γ', '30']
    rid = page['rows'][0]['id']
    second = client.get(path + '/rows?offset=1&limit=1').json()['rows'][0]['id']
    edits = batch(updates=[{'id': rid, 'values': {'name': '你好,"quoted"\nline', 'amount': '40'}}], additions=[{'name': '', 'amount': None}], deletions=[second])
    assert client.post(path + '/edits/validate', json=edits).json() == {'valid': True}
    assert client.get(path + '/version').json()['version'] == 1
    saved = client.post(path + '/edits', json=edits)
    assert saved.status_code == 200, saved.text
    assert saved.json()['changed_rows'] == 3
    expected = [['α', '10'], ['你好,"quoted"\nline', '40'], ['', None]]
    assert client.get(path + '/preview').json()['rows'] == expected
    assert client.get(path).json()['columns'][1]['null_count'] == 1
    profile = client.get(path + '/profile').json()
    assert profile['rows'] == 3 and profile['columns'][1]['missing'] == 1
    output = list(csv.reader(io.StringIO(client.get(path + '/export').text)))
    assert output == [['name', 'amount'], ['α', '10'], ['你好,"quoted"\nline', '40'], ['', '']]
    with TestClient(create_app(root)) as restarted:
        assert restarted.get(path + '/preview').json()['rows'] == expected
        assert restarted.get(path + '/version').json()['version'] == 2
        assert restarted.get(path + '/rows').json()['rows'][1]['id'] == rid
    with connect(root / (path.split('/')[-1] + '.duckdb')) as db:
        assert db.execute('SELECT sum(TRY_CAST(amount AS BIGINT)) FROM records').fetchone()[0] == 50
        assert bytes(db.execute('SELECT original FROM _editor_state').fetchone()[0]).decode() == 'name,amount\nα,10\nβ,20\nγ,30\n'


@pytest.mark.parametrize('value', ['1.5', 'abc', '', '9223372036854775808'])
def test_invalid_batch_atomic(workspace, value):
    c, _, p = workspace
    rows = c.get(p + '/rows').json()['rows']
    result = c.post(p + '/edits', json=batch(updates=[{'id': rows[0]['id'], 'values': {'amount': '99'}}, {'id': rows[1]['id'], 'values': {'amount': value}}]))
    assert result.status_code == 422
    assert c.get(p + '/preview').json()['rows'][0] == ['α', '10']
    assert c.get(p + '/version').json()['version'] == 1


def test_stale_cross_dataset_schema_and_single_cell(workspace):
    c, _, p = workspace
    rid = c.get(p + '/rows').json()['rows'][0]['id']
    for edit in [batch(updates=[{'id': str(uuid4()), 'values': {'amount': '1'}}]), batch(updates=[{'id': rid, 'values': {'foreign': '1'}}]), batch(updates=[{'id': rid, 'values': {'amount': '1'}, 'extra': 'bad'}])]:
        assert c.post(p + '/edits', json=edit).status_code == 422
    other = c.post('/api/datasets', files={'file': ('other.csv', b'name,amount\nz,5\n')}).json()['id']
    assert c.post(f'/api/datasets/{other}/edits', json=batch(updates=[{'id': rid, 'values': {'amount': '1'}}])).status_code == 422
    edit = batch(updates=[{'id': rid, 'values': {'amount': '11'}}])
    assert c.post(p + '/edits', json=edit).status_code == 200
    assert c.post(p + '/edits', json=edit).status_code == 409
    assert c.get(p + '/preview').json()['rows'][0][1] == '11'


@pytest.mark.parametrize('typ,good,bad', [('DATE', '2026-11-06', 'wrong'), ('BOOLEAN', 'true', 'perhaps'), ('DOUBLE', '1.25', 'NaN'), ('TIMESTAMP', '2026-11-06 12:30:00', 'yesterday')])
def test_types(workspace, typ, good, bad):
    c, _, p = workspace
    rid = c.get(p + '/rows').json()['rows'][0]['id']
    # Existing values must also satisfy a newly confirmed validation mapping.
    if typ in ('DATE', 'TIMESTAMP', 'BOOLEAN'):
        rows = c.get(p + '/rows').json()['rows']
        c.post(p + '/edits', json=dict(expected_version=1, deletions=[r['id'] for r in rows[1:]], updates=[{'id': rid, 'values': {'amount': None}}]))
    version = c.get(p + '/version').json()['version']
    for value, status in [(bad, 422), (good, 200)]:
        edit = dict(expected_version=version, type_mapping={'amount': typ}, updates=[{'id': rid, 'values': {'amount': value}}])
        assert c.post(p + '/edits', json=edit).status_code == status


def test_failed_transaction_rolls_back(workspace, monkeypatch):
    c, root, p = workspace
    rid = c.get(p + '/rows').json()['rows'][0]['id']
    real = c.app.state.editor.connect
    class Failing:
        def __enter__(self):
            self.db = real(root / (p.split('/')[-1] + '.duckdb'), False)
            return self
        def __exit__(self, *args): self.db.close()
        def execute(self, sql, *args):
            if sql.startswith('UPDATE _editor_state'): raise RuntimeError('injected disk failure')
            return self.db.execute(sql, *args)
        def executemany(self, *args): return self.db.executemany(*args)
    monkeypatch.setattr(c.app.state.editor, 'connect', lambda path, read_only=True: real(path) if read_only else Failing())
    with TestClient(c.app, raise_server_exceptions=False) as failing:
        assert failing.post(p + '/edits', json=batch(updates=[{'id': rid, 'values': {'amount': '99'}}])).status_code == 500
    monkeypatch.setattr(c.app.state.editor, 'connect', real)
    assert c.get(p + '/version').json()['version'] == 1
    assert c.get(p + '/preview').json()['rows'][0][1] == '10'


def test_updated_analyst_and_historical_snapshots(tmp_path):
    from tests.test_analyst import ControlledProvider, submit, finish
    from tests.test_phase3 import ControlledEmbedding
    with TestClient(create_app(tmp_path, provider=ControlledProvider(), embedder=ControlledEmbedding())) as c:
        identifier = c.post('/api/datasets', files={'file': ('sales.csv', b'revenue\n10\n20\n')}).json()['id']
        path = '/api/datasets/' + identifier
        old = submit(c, identifier, mapping={'revenue': 'DOUBLE'})
        assert finish(c, old)['status'] == 'succeeded'
        assert c.get(f'/api/analyst/runs/{old}/results').json()['rows'] == [[30.0]]
        previous = c.app.state.knowledge.profile(identifier)['data_revision']
        rid = c.get(path + '/rows').json()['rows'][0]['id']
        assert c.post(path + '/edits', json=dict(expected_version=1, type_mapping={'revenue': 'DOUBLE'}, updates=[{'id': rid, 'values': {'revenue': '40'}}])).status_code == 200
        assert c.app.state.knowledge.profile(identifier)['data_revision'] != previous
        current = submit(c, identifier, mapping={'revenue': 'DOUBLE'})
        assert finish(c, current)['status'] == 'succeeded'
        assert c.get(f'/api/analyst/runs/{current}/results').json()['rows'] == [[60.0]]
        assert c.get(f'/api/analyst/runs/{old}/results').json()['rows'] == [[30.0]]


def test_concurrent_save_and_metadata_recovery(workspace):
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy.orm import Session
    c, root, path = workspace
    rid = c.get(path + '/rows').json()['rows'][0]['id']
    edit = batch(updates=[{'id': rid, 'values': {'amount': '50'}}])
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: c.post(path + '/edits', json=edit).status_code, range(2)))
    assert sorted(statuses) == [200, 409]
    editor = c.app.state.editor
    with Session(editor.engine) as s:
        item = s.get(editor.Dataset, path.split('/')[-1]); item.rows = 999; s.commit()
    with TestClient(create_app(root)) as restarted:
        assert restarted.get(path).json()['rows'] == 3
        assert restarted.get(path + '/version').json()['version'] == 2


def test_limits_and_schema_authorization(workspace):
    c, _, path = workspace
    assert c.post(path + '/edits', json=batch()).status_code == 422
    assert c.post(path + '/edits', json=batch(additions=[{'name': 'x', 'amount': '1'}] * 1001)).status_code == 422
    assert c.post(path + '/edits', content=b'x' * 131073, headers={'Content-Type': 'application/json'}).status_code == 413
    assert c.get(path + '/rows?sort=foreign').status_code == 422
    assert c.get('/api/datasets/' + str(uuid4()) + '/export').status_code == 404


def test_export_full_dataset_and_null_empty_distinction(workspace):
    c, _, path = workspace
    added = [{'name': f'row-{i}', 'amount': str(i)} for i in range(30)] + [{'name': '', 'amount': None}, {'name': None, 'amount': '0'}]
    assert c.post(path + '/edits', json=batch(additions=added)).status_code == 200
    assert len(c.get(path + '/rows').json()['rows']) == 25
    records = list(csv.reader(io.StringIO(c.get(path + '/export').text)))
    assert len(records) == 36
    last = c.get(path + '/rows?offset=33').json()['rows']
    assert last[0]['values'] == ['', None]
    assert last[1]['values'] == [None, '0']


def test_mapping_change_requires_confirmation_and_validates_all_rows(workspace):
    c, _, path = workspace
    rid = c.get(path + '/rows').json()['rows'][0]['id']
    assert c.post(path + '/edits', json=batch(updates=[{'id': rid, 'values': {'amount': '11'}}])).status_code == 200
    change = dict(expected_version=2, type_mapping={'name': 'VARCHAR', 'amount': 'DATE'}, updates=[{'id': rid, 'values': {'amount': '2026-11-06'}}])
    assert c.post(path + '/edits', json=change).status_code == 422
    change['types_confirmed'] = True
    assert c.post(path + '/edits', json=change).status_code == 422
    assert c.get(path + '/version').json()['version'] == 2


def test_user_column_named_rowid_does_not_change_internal_row_identity(workspace):
    c, root, _ = workspace
    item = c.post('/api/datasets', files={'file': ('rowid.csv', b'rowid,value\nz,first\na,second\n')}).json()
    path = '/api/datasets/' + item['id']
    rows = c.get(path + '/rows').json()['rows']
    first_id = rows[0]['id']
    second_id = rows[1]['id']
    edit = dict(expected_version=1, updates=[{'id': first_id, 'values': {'rowid': '0'}}])
    assert c.post(path + '/edits', json=edit).status_code == 200
    with TestClient(create_app(root)) as restarted:
        rows = restarted.get(path + '/rows?sort=rowid').json()['rows']
        assert rows[0] == {'id': first_id, 'values': ['0', 'first']}
        assert rows[1] == {'id': second_id, 'values': ['a', 'second']}


def test_existing_cells_preserve_identity_count_formatting_across_sorted_pages_and_restart(tmp_path):
    """The user's 001 / 1240.50 -> 1500.00 example, without additions/deletions."""
    raw = 'account,revenue,day,note\n' + ''.join(
        f'{i:03},{"1240.50" if i == 1 else str(i) + ".00"},2026-01-01,original\n'
        for i in range(1, 31))
    mapping = {'account': 'VARCHAR', 'revenue': 'DOUBLE', 'day': 'DATE', 'note': 'VARCHAR'}
    with TestClient(create_app(tmp_path)) as c:
        dataset = c.post('/api/datasets', files={'file': ('SYNTHETIC-existing-cell.csv', raw.encode())}).json()
        path = '/api/datasets/' + dataset['id']
        original = c.get(path + '/rows?limit=100').json()
        ids = [r['id'] for r in original['rows']]
        edit = dict(expected_version=1, types_confirmed=True, type_mapping=mapping,
                    updates=[{'id': ids[0], 'values': {'revenue': '1500.00'}}])
        saved = c.post(path + '/edits', json=edit)
        assert saved.status_code == 200, saved.text
        assert saved.json()['version'] == 2 and saved.json()['changed_rows'] == 1
        rows = c.get(path + '/rows?limit=100').json()
        assert rows['total'] == 30 and [r['id'] for r in rows['rows']] == ids
        assert rows['rows'][0] == {'id': ids[0], 'values': ['001', '1500.00', '2026-01-01', 'original']}
        assert '001,1500.00,2026-01-01,original\r\n' in c.get(path + '/export').text
        sorted_page = c.get(path + '/rows?sort=account&descending=true&offset=25&limit=2').json()
        changes = dict(expected_version=2, type_mapping=mapping, updates=[
            {'id': sorted_page['rows'][0]['id'], 'values': {'note': '你好,"edited"', 'day': '2026-02-03'}},
            {'id': sorted_page['rows'][1]['id'], 'values': {'account': '0004', 'revenue': None}},
        ])
        assert c.post(path + '/edits', json=changes).status_code == 200
        rows = c.get(path + '/rows?limit=100').json()
        assert rows['version'] == 3 and rows['total'] == 30
        assert [r['id'] for r in rows['rows']] == ids
        assert rows['rows'][4]['values'] == ['005', '5.00', '2026-02-03', '你好,"edited"']
        assert rows['rows'][3]['values'] == ['0004', None, '2026-01-01', 'original']
        invalid = dict(expected_version=3, type_mapping=mapping,
                       updates=[{'id': ids[0], 'values': {'revenue': 'not numeric', 'day': 'not a date'}}])
        assert c.post(path + '/edits', json=invalid).status_code == 422
        assert c.get(path + '/rows?limit=100').json() == rows
        assert c.get(path + '/profile').json()['columns'][1]['missing'] == 1
    with TestClient(create_app(tmp_path)) as restarted:
        assert restarted.get(path + '/rows?limit=100').json() == rows
        assert restarted.get(path).json()['rows'] == 30
    with connect(tmp_path / (dataset['id'] + '.duckdb')) as db:
        assert db.execute("SELECT account,revenue FROM records WHERE account='001'").fetchall() == [('001', '1500.00')]
        assert db.execute('SELECT count(*) FROM records').fetchone()[0] == 30


def test_cell_revision_updates_analyst_and_automl_without_mutating_past_runs_or_models(tmp_path):
    import hashlib
    import math
    from tests.test_analyst import ControlledProvider, submit, finish as finish_run
    from tests.test_phase3 import ControlledEmbedding
    from tests.test_automl import finish as finish_ml
    provider = ControlledProvider(sql="SELECT account,revenue FROM data WHERE account='001'")
    raw = 'account,x,revenue\n' + ''.join(
        f'{i+1:03},{math.sin(i) * 3 + i * .11},{"1240.50" if i == 0 else "1.00"}\n' for i in range(80))
    with TestClient(create_app(tmp_path, provider=provider, embedder=ControlledEmbedding())) as c:
        dataset = c.post('/api/datasets', files={'file': ('SYNTHETIC-revision.csv', raw.encode())}).json()
        identifier = dataset['id']; path = '/api/datasets/' + identifier
        run_id = submit(c, identifier, mapping={'account': 'VARCHAR', 'revenue': 'DOUBLE'})
        assert finish_run(c, run_id)['status'] == 'succeeded'
        old_rows = c.get('/api/analyst/runs/' + run_id + '/results').json()['rows']
        assert old_rows == [['001', 1240.5]]
        config = {'dataset_id': identifier, 'task': 'anomaly', 'features': [{'name': 'x', 'kind': 'numeric'}], 'confirm_feature_availability': True}
        accepted = c.post('/api/automl/experiments', json=config)
        assert accepted.status_code == 202, accepted.text
        old_job = finish_ml(c, accepted.json()); assert old_job['status'] == 'completed', old_job
        model_id = old_job['result']['selected_model_id']
        old_model = c.get('/api/automl/models/' + model_id).json()
        artifact = tmp_path / old_model['artifact_path']; old_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
        prediction = c.post('/api/automl/models/' + model_id + '/predict', json={'records': [{'x': '1.25'}]}).json()
        old_csv = c.get('/api/automl/predictions/' + prediction['id'] + '/export.csv').content
        before = c.get('/api/automl/datasets/' + identifier + '/profile?task=anomaly').json()
        rid = c.get(path + '/rows').json()['rows'][0]['id']
        edit = dict(expected_version=1, types_confirmed=True,
                    type_mapping={'account': 'VARCHAR', 'x': 'DOUBLE', 'revenue': 'DOUBLE'},
                    updates=[{'id': rid, 'values': {'revenue': '1500.00'}}])
        assert c.post(path + '/edits', json=edit).status_code == 200
        assert c.get('/api/automl/models/' + model_id).json() == old_model
        assert c.get('/api/automl/experiments/' + old_job['id']).json() == old_job
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == old_hash
        assert c.get('/api/automl/predictions/' + prediction['id'] + '/export.csv').content == old_csv
        rejected = c.post('/api/automl/models/' + model_id + '/predict', json={'records': [{'x': '1.25'}]})
        assert rejected.status_code == 409 and 'fingerprint changed' in rejected.text
        after = c.get('/api/automl/datasets/' + identifier + '/profile?task=anomaly').json()
        assert after['fingerprint'] != before['fingerprint'] and after['total_rows'] == 80
        fresh_job = finish_ml(c, c.post('/api/automl/experiments', json=config).json())
        assert fresh_job['status'] == 'completed' and fresh_job['dataset_fingerprint'] == after['fingerprint']
        fresh_run = submit(c, identifier, mapping={'account': 'VARCHAR', 'revenue': 'DOUBLE'})
        assert finish_run(c, fresh_run)['status'] == 'succeeded'
        assert c.get('/api/analyst/runs/' + fresh_run + '/results').json()['rows'] == [['001', 1500.0]]
        assert c.get('/api/analyst/runs/' + run_id + '/results').json()['rows'] == old_rows
        assert c.get(path + '/version').json()['version'] == 2
