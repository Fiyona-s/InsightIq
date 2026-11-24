import sys
from pathlib import Path
from uuid import uuid4

import duckdb
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import MAX_BYTES, MAX_ROWS, connect, create_app, parse_csv


@pytest.fixture
def workspace(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client, tmp_path


def upload(client, raw=b'id,value\n001,12.50\n002,\n', name='orders.csv'):
    return client.post('/api/datasets', files={'file': (name, raw, 'text/csv')})


def test_import_schema_preview_and_restart(workspace):
    client, root = workspace
    response = upload(client)
    assert response.status_code == 201
    data = response.json()
    assert data['rows'] == 2
    assert data['columns'] == [{'name': 'id', 'type': 'VARCHAR', 'null_count': 0}, {'name': 'value', 'type': 'VARCHAR', 'null_count': 1}]
    assert client.get('/api/datasets/' + data['id']).json() == data
    assert client.get('/api/datasets/' + data['id'] + '/preview').json()['rows'] == [['001', '12.50'], ['002', None]]
    with TestClient(create_app(root)) as restarted:
        assert restarted.get('/api/datasets').json() == [data]
        assert restarted.get('/api/datasets/' + data['id'] + '/preview?offset=1&limit=1').json()['rows'] == [['002', None]]


@pytest.mark.parametrize('raw', [b'', b'a,A\n1,2\n', b',b\n1,2\n', b'a,b\n1\n', b'a\n\xff', b'a\n"unclosed', b'a\nx\x00y\n'])
def test_invalid_csv_does_not_persist(workspace, raw):
    client, root = workspace
    assert upload(client, raw).status_code == 422
    assert client.get('/api/datasets').json() == []
    assert list(root.glob('*.duckdb')) == []


def test_bounds_and_missing(workspace):
    client, _ = workspace
    assert upload(client, name='bad.txt').status_code == 415
    assert upload(client, b'a' * (MAX_BYTES + 1)).status_code == 413
    identifier = upload(client).json()['id']
    for query in ['limit=101', 'limit=0', 'offset=-1', f'offset={MAX_ROWS + 1}']:
        assert client.get(f'/api/datasets/{identifier}/preview?{query}').status_code == 422
    assert client.get(f'/api/datasets/{uuid4()}').status_code == 404
    assert client.get('/api/datasets/../../etc/passwd/preview').status_code == 404
    assert client.get('/api/datasets/not-a-uuid').status_code == 422


def test_header_only_is_valid(workspace):
    client, _ = workspace
    data = upload(client, b'a,b\n').json()
    result = client.get(f"/api/datasets/{data['id']}/preview").json()
    assert result['total'] == 0
    assert result['rows'] == []
    assert result['columns'] == ['a', 'b']


def test_sql_content_is_inert_and_reader_is_restricted(workspace):
    client, root = workspace
    data = upload(client, b'"x\"\"; DROP TABLE records;--",normal\n"SELECT * FROM read_csv(secret)",safe\n', '../../orders.csv').json()
    assert data['name'] == 'orders.csv'
    assert client.get(f"/api/datasets/{data['id']}/preview").json()['rows'][0][1] == 'safe'
    with connect(root / (data['id'] + '.duckdb')) as db:
        with pytest.raises(duckdb.Error):
            db.execute('CREATE TABLE forbidden(i INT)')
        with pytest.raises(duckdb.Error):
            db.execute("SELECT * FROM read_csv('/etc/passwd')")
        assert db.execute('SELECT count(*) FROM records').fetchone() == (1,)


def test_parser_resource_limits():
    with pytest.raises(ValueError):
        parse_csv(('a\n' + 'x\n' * (MAX_ROWS + 1)).encode())
    with pytest.raises(ValueError):
        parse_csv((','.join('c'+str(i) for i in range(101))+'\n').encode())
    with pytest.raises(ValueError):
        parse_csv(b'a\n' + b'x' * 65537)


def test_entire_multipart_body_is_bounded(workspace):
    client, _ = workspace
    assert upload(client, b'x' * (MAX_BYTES + 65537)).status_code == 413
