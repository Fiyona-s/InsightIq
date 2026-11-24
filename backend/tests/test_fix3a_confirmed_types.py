"""Approved fix 3a: confirmed column types are remembered per dataset in a new additive table.

The type-confirmation rule still holds: nothing is remembered without an explicit confirm, a
changed schema invalidates the memory, and questions still carry their own explicit mapping.
"""
import json
import sqlite3

from fastapi.testclient import TestClient

from tests.test_analyst import dataset, finish
from tests.test_phase4 import make_app

CSV = b"id,revenue,region\n1,10,North\n2,20,South\n"
TYPES = {"id": "BIGINT", "revenue": "DOUBLE", "region": "VARCHAR"}


def upload(client):
    response = client.post('/api/datasets', files={'file': ('fix3a.csv', CSV, 'text/csv')})
    assert response.status_code == 201, response.text
    return response.json()['id']


def test_confirmed_types_survive_an_app_restart(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        identifier = upload(client)
        empty = client.get(f'/api/datasets/{identifier}/confirmed-types').json()
        assert empty['type_mapping'] is None and empty['current'] is False
        saved = client.put(f'/api/datasets/{identifier}/confirmed-types', json={'type_mapping': TYPES, 'confirm': True})
        assert saved.status_code == 200, saved.text
        assert saved.json()['type_mapping'] == TYPES and saved.json()['current'] is True
    # A fresh app on the same workspace (like leaving and returning, or a restart) still knows.
    with TestClient(make_app(tmp_path)) as client:
        again = client.get(f'/api/datasets/{identifier}/confirmed-types').json()
        assert again['type_mapping'] == TYPES and again['current'] is True and again['confirmed_at']
        cleared = client.delete(f'/api/datasets/{identifier}/confirmed-types')
        assert cleared.status_code == 200 and cleared.json()['type_mapping'] is None
        assert client.get(f'/api/datasets/{identifier}/confirmed-types').json()['type_mapping'] is None


def test_nothing_is_remembered_without_an_explicit_valid_confirmation(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        identifier = upload(client)
        url = f'/api/datasets/{identifier}/confirmed-types'
        assert client.put(url, json={'type_mapping': TYPES, 'confirm': False}).status_code == 422
        assert client.put(url, json={'type_mapping': {'id': 'BIGINT'}, 'confirm': True}).status_code == 422
        assert client.put(url, json={'type_mapping': {**TYPES, 'ghost': 'DOUBLE'}, 'confirm': True}).status_code == 422
        assert client.put(url, json={'type_mapping': {**TYPES, 'revenue': 'MONEY'}, 'confirm': True}).status_code == 422
        assert client.put(url, json={'type_mapping': TYPES}).status_code == 422
        assert client.get(url).json()['type_mapping'] is None
        missing = '00000000-0000-0000-0000-000000000000'
        assert client.get(f'/api/datasets/{missing}/confirmed-types').status_code == 404


def test_a_changed_schema_invalidates_remembered_types(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        identifier = upload(client)
        client.put(f'/api/datasets/{identifier}/confirmed-types', json={'type_mapping': TYPES, 'confirm': True})
        # Throwaway catalog only: simulate a later revision that added a column.
        with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
            schema = json.loads(db.execute('SELECT schema_json FROM datasets WHERE id=?', (identifier,)).fetchone()[0])
            schema.append({'name': 'added_later', 'type': 'VARCHAR', 'null_count': 0})
            db.execute('UPDATE datasets SET schema_json=? WHERE id=?', (json.dumps(schema), identifier))
        stale = client.get(f'/api/datasets/{identifier}/confirmed-types').json()
        assert stale['current'] is False and stale['type_mapping'] is None


def test_remembered_types_are_never_applied_to_a_question_by_themselves(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        identifier = dataset(client)
        columns = [c['name'] for c in client.get(f'/api/datasets/{identifier}').json()['columns']]
        mapping = {c: 'VARCHAR' for c in columns}
        mapping['revenue'] = 'DOUBLE'
        client.put(f'/api/datasets/{identifier}/confirmed-types', json={'type_mapping': mapping, 'confirm': True})
        # The question explicitly sends no conversions; the remembered DOUBLE must not be applied.
        response = client.post('/api/analyst/runs', json={'dataset_id': identifier, 'question': 'What is total revenue?', 'type_mapping': {}})
        assert response.status_code == 202, response.text
        run = finish(client, response.json()['id'])
        assert run['type_mapping'] == {}


def dump_without_new_table(path):
    with sqlite3.connect(path) as db:
        return [line for line in db.iterdump()
                if 'confirmed_column_types' not in line and not line.startswith('INSERT INTO "schema_migrations" VALUES(10,')]


def test_migration_is_additive_and_backs_up_first(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        upload(client)
    catalog = tmp_path / 'catalog.sqlite'
    # Make this workspace look like a pre-fix (version 9) catalog.
    with sqlite3.connect(catalog) as db:
        db.execute('DROP TABLE confirmed_column_types')
        db.execute('DELETE FROM schema_migrations WHERE version=10')
    before = dump_without_new_table(catalog)
    files_before = {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob('*')
                    if p.is_file() and 'backups' not in p.parts and not p.name.startswith('catalog.sqlite')}
    with TestClient(make_app(tmp_path)) as client:
        assert client.get('/api/datasets').status_code == 200
    with sqlite3.connect(catalog) as db:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        versions = {r[0] for r in db.execute('SELECT version FROM schema_migrations')}
    assert 'confirmed_column_types' in tables and 10 in versions
    assert dump_without_new_table(catalog) == before  # no existing row or table rewritten
    backups = sorted((tmp_path / 'backups').glob('confirmed-types-v10-*'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0] / 'catalog.sqlite') as db:
        backed_up = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'confirmed_column_types' not in backed_up  # the backup was taken before the DDL
    for relative, content in files_before.items():
        assert (backups[0] / 'storage' / relative).read_bytes() == content
        assert (tmp_path / relative).read_bytes() == content
