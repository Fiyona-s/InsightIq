"""Stage 6 logic fixes: schema registry (v12, v13), owner-set sample flag, per-item metric approval, status wording.

Controlled fixtures only; no live AI call.
"""
import shutil
import sqlite3

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base

from app.persistence import migrate as record_versions, register_phase4
from scripts import upgrade_projects
from tests.test_analyst import CSV
from tests.test_knowledge_review import draft, overview, route, setup
from tests.test_phase4 import make_app

H = 'X-InsightIQ-Project'


def upload(client, name='orders.csv'):
    response = client.post('/api/datasets', files={'file': (name, CSV, 'text/csv')})
    assert response.status_code == 201, response.text
    return response.json()


def versions(catalog):
    with sqlite3.connect(catalog) as db:
        return [r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]


def tables(catalog):
    with sqlite3.connect(catalog) as db:
        return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def rows_of(catalog, table):
    with sqlite3.connect(catalog) as db:
        return db.execute(f'SELECT * FROM {table}').fetchall()


# ---- Item 1: registry -------------------------------------------------------------------------
def test_fresh_database_registers_every_version_with_its_tables(tmp_path):
    with TestClient(make_app(tmp_path)):
        pass
    catalog = tmp_path / 'catalog.sqlite'
    assert versions(catalog) == list(range(1, 18))
    assert {'analyst_run_results', 'dataset_sample_flags'} <= tables(catalog)


def test_database_with_the_v12_table_but_no_row_gets_only_the_missing_rows(tmp_path):
    """The real workspace's shape: v1-11 registered, saved-answers table present, no row 12, no flags table."""
    with TestClient(make_app(tmp_path)) as c:
        upload(c)
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:
        db.execute("INSERT INTO analyst_run_results VALUES ('run-1','{\"rows\":[]}',0,'2026-01-01')")
        db.execute('DROP TABLE dataset_sample_flags')
        db.execute('DELETE FROM schema_migrations WHERE version IN (12, 13)')
    shutil.rmtree(tmp_path / 'backups', ignore_errors=True)
    before = {t: rows_of(catalog, t) for t in ('datasets', 'analyst_run_results', 'projects', 'confirmed_column_types')}
    with TestClient(make_app(tmp_path)):
        pass
    assert versions(catalog) == list(range(1, 18))
    assert {t: rows_of(catalog, t) for t in before} == before            # nothing existing rewritten
    assert rows_of(catalog, 'dataset_sample_flags') == []                   # no backfill (Rule 6)
    assert not list((tmp_path / 'backups').glob('analyst-results-v12-*'))   # table existed: no new v12 backup needed
    backup = list((tmp_path / 'backups').glob('sample-flags-v13-*'))
    assert len(backup) == 1                                                 # backup taken before the new table
    assert 'dataset_sample_flags' not in tables(backup[0] / 'catalog.sqlite')


def test_database_already_at_the_new_list_is_left_alone(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        upload(c)
    catalog = tmp_path / 'catalog.sqlite'
    registry = rows_of(catalog, 'schema_migrations')
    backups = sorted(p.name for p in (tmp_path / 'backups').glob('*')) if (tmp_path / 'backups').exists() else []
    with TestClient(make_app(tmp_path)):
        pass
    assert rows_of(catalog, 'schema_migrations') == registry
    after = sorted(p.name for p in (tmp_path / 'backups').glob('*')) if (tmp_path / 'backups').exists() else []
    assert after == backups


def test_a_registry_row_is_never_written_for_a_table_that_does_not_exist(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "x.sqlite"}')
    base = declarative_base()
    migration, _ = register_phase4(base)
    migration.__table__.create(engine)
    from sqlalchemy.orm import Session
    with Session(engine) as session:
        for v in range(1, 12):
            session.add(migration(version=v, applied_at='2026-01-01'))
        session.commit()
    with pytest.raises(RuntimeError, match='missing table'):
        record_versions(engine, base, migration)          # v12 table is not registered on this Base
    assert 12 not in [r[0] for r in sqlite3.connect(tmp_path / 'x.sqlite').execute('SELECT version FROM schema_migrations')]


def make_old_workspace(tmp_path, drop_results_table):
    with TestClient(make_app(tmp_path)) as c:
        upload(c)
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:
        if drop_results_table:
            db.execute('DROP TABLE analyst_run_results')
        else:
            db.execute("INSERT INTO analyst_run_results VALUES ('run-1','{\"rows\":[]}',0,'2026-01-01')")
        db.execute('DROP TABLE dataset_sample_flags')
        db.execute('DELETE FROM schema_migrations WHERE version IN (12, 13)')
    backup = tmp_path / 'owner-backup'
    backup.mkdir()
    shutil.copy(catalog, backup / 'catalog-consistent.sqlite')
    return catalog, backup


@pytest.mark.parametrize('drop_results_table', [False, True])
def test_upgrade_script_creates_each_table_with_its_row_and_verifies_existing_data(tmp_path, capsys, drop_results_table):
    catalog, backup = make_old_workspace(tmp_path, drop_results_table)
    assert upgrade_projects.main(['--data-dir', str(tmp_path), '--backup', str(backup)]) == 0
    out = capsys.readouterr().out
    assert 'Verified:' in out
    assert versions(catalog) == list(range(1, 18))
    assert {'analyst_run_results', 'dataset_sample_flags'} <= tables(catalog)
    if not drop_results_table:
        assert rows_of(catalog, 'analyst_run_results') == [('run-1', '{"rows":[]}', 0, '2026-01-01')]
    assert upgrade_projects.main(['--data-dir', str(tmp_path), '--backup', str(backup)]) == 0
    assert 'Nothing to do.' in capsys.readouterr().out


def test_upgrade_script_cannot_record_a_version_without_its_table(tmp_path, capsys):
    catalog, backup = make_old_workspace(tmp_path, True)
    upgrade_projects.main(['--data-dir', str(tmp_path), '--backup', str(backup)])
    capsys.readouterr()
    present = tables(catalog)
    with sqlite3.connect(catalog) as db:
        registered = {r[0] for r in db.execute('SELECT version FROM schema_migrations')}
    assert (12 not in registered or 'analyst_run_results' in present) and (13 not in registered or 'dataset_sample_flags' in present)


# ---- Item 2: owner-set sample flag --------------------------------------------------------------
def test_no_dataset_is_a_sample_unless_the_owner_marks_it(tmp_path):
    names = ['InsightIQ_Retail_Demo_2400.csv', 'illustrative-e2e-1.csv', 'SYNTHETIC-x.csv', 'verification.csv', 'orders.csv']
    with TestClient(make_app(tmp_path)) as c:
        made = {n: upload(c, n)['id'] for n in names}
        assert all(d['is_sample'] is False for d in c.get('/api/datasets').json())
        demo = made['InsightIQ_Retail_Demo_2400.csv']
        r = c.put(f'/api/datasets/{demo}/sample', json={'is_sample': True})
        assert r.status_code == 200 and r.json()['is_sample'] is True
        assert c.get(f'/api/datasets/{demo}').json()['is_sample'] is True
        flagged = {d['name'] for d in c.get('/api/datasets').json() if d['is_sample']}
        assert flagged == {'InsightIQ_Retail_Demo_2400.csv'}
        assert c.put(f'/api/datasets/{demo}/sample', json={'is_sample': False}).json()['is_sample'] is False
        assert c.put(f'/api/datasets/{demo}/sample', json={'is_sample': True, 'x': 1}).status_code == 422
        assert c.put(f'/api/datasets/{demo}/sample', json={}).status_code == 422
        assert c.put('/api/datasets/00000000-0000-0000-0000-000000000000/sample', json={'is_sample': True}).status_code == 404
    with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM dataset_sample_flags').fetchone()[0] == 1     # only what the owner touched


def test_bulk_marking_and_persistence_across_restart(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        ids = [upload(c, f'a{i}.csv')['id'] for i in range(3)]
        assert c.post('/api/datasets/bulk-sample', json={'ids': ids[:2], 'is_sample': True}).json() == {'updated': 2, 'is_sample': True}
        assert c.post('/api/datasets/bulk-sample', json={'ids': [], 'is_sample': True}).status_code == 422
    with TestClient(make_app(tmp_path)) as c:
        assert {d['id'] for d in c.get('/api/datasets').json() if d['is_sample']} == set(ids[:2])
        c.post('/api/datasets/bulk-sample', json={'ids': ids[:1], 'is_sample': False})
        assert {d['id'] for d in c.get('/api/datasets').json() if d['is_sample']} == {ids[1]}


def test_sample_flag_routes_respect_projects(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        other = c.post('/api/projects', json={'name': 'Other'}).json()['id']
        mine = upload(c)['id']
        c.headers[H] = other
        assert c.put(f'/api/datasets/{mine}/sample', json={'is_sample': True}).status_code in {403, 404}
        assert c.post('/api/datasets/bulk-sample', json={'ids': [mine], 'is_sample': True}).status_code in {403, 404}
        c.headers[H] = 'default'
        assert c.get(f'/api/datasets/{mine}').json()['is_sample'] is False


# ---- Item 4: metric approval is per item ---------------------------------------------------------
def test_approve_all_refuses_metric_ids_but_still_approves_text_items(tmp_path):
    client, _ = setup(tmp_path)
    with client as c:
        _, path = route(c)
        drafts = draft(c, path)
        revision = overview(c, path)['revision']
        target = path + '/drafts/approve-all'
        metric = next(d for d in drafts if d['item_type'] == 'metric')
        text = [d for d in drafts if d['item_type'] != 'metric'][:1]
        r = c.post(target, json={'ids': [metric['id']], 'confirm_count': 1, 'confirm_revision': revision})
        assert r.status_code == 409 and 'one at a time' in r.json()['detail']
        r = c.post(target, json={'ids': [metric['id']] + [t['id'] for t in text], 'confirm_count': 1 + len(text), 'confirm_revision': revision})
        assert r.status_code == 409
        assert c.get(path).json()['settings']['metrics'] == []                       # nothing was approved by the refused call
        assert c.post(target, json={'ids': [t['id'] for t in text], 'confirm_count': len(text), 'confirm_revision': revision}).status_code == 200
        # The metric can still be approved on its own, explicitly.
        again = overview(c, path)
        ok = c.patch(f"{path}/drafts/{metric['id']}", json={'action': 'approve', 'confirm_revision': again['revision']})
        assert ok.status_code == 200, ok.text


# ---- Item 7: wording ------------------------------------------------------------------------------
def test_status_label_is_plain_and_other_statuses_pass_through():
    from app.reports import status_label
    assert status_label(None) == 'Saved before change tracking'
    assert status_label('Revision not recorded') == 'Saved before change tracking'
    assert status_label('Current') == 'Current'
    assert status_label('Source changed') == 'Source changed'
