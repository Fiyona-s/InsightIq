"""Stage 2: Projects. Items from project A never appear in project B, anywhere.

Covers the 14 isolation checks from docs/AUDIT.md §f plus the additional cases found while
building (direct-id access, body references, bulk actions, cookies, archived/unknown projects).
All data is throwaway; the controlled provider makes no live AI call.
"""
import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from tests.test_analyst import CSV
from tests.test_phase4 import make_app
from tests.test_automl import NoEmbeddings, NoProvider, regression_csv, start, finish as finish_ml
from app.main import create_app

H = 'X-InsightIQ-Project'


def use(client, project):
    client.headers[H] = project


def upload(client, name, raw=CSV):
    response = client.post('/api/datasets', files={'file': (name, raw, 'text/csv')})
    assert response.status_code == 201, response.text
    return response.json()['id']


def ask(client, dataset_id, question='What is total revenue by region?'):
    response = client.post('/api/analyst/runs', json={'dataset_id': dataset_id, 'question': question, 'type_mapping': {'revenue': 'DOUBLE'}})
    assert response.status_code == 202, response.text
    identifier = response.json()['id']
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get('/api/analyst/runs/' + identifier).json()
        if run['status'] in {'succeeded', 'failed', 'cancelled', 'needs_clarification', 'clarification'}:
            return run
        time.sleep(0.05)
    pytest.fail('run did not finish')


def chart_and_dashboard(client, run, title):
    chart = client.post('/api/saved-charts', json={'run_id': run['id'], 'title': title, 'spec': {'kind': 'bar', 'x': 0, 'y': 1},
                                                   'refresh_policy': 'manual', 'persist_snapshot_confirmed': True})
    assert chart.status_code == 201, chart.text
    board = client.post('/api/dashboards', json={'title': title + ' board', 'description': ''})
    assert board.status_code == 201, board.text
    attach = client.post(f"/api/dashboards/{board.json()['id']}/charts", json={'chart_id': chart.json()['id'], 'revision': board.json()['revision'], 'duplicate_action': 'cancel'})
    assert attach.status_code == 200, attach.text
    return chart.json(), board.json()


@pytest.fixture
def two_projects(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        legacy = upload(client, 'legacy-default.csv')  # created before any project: Default
        a = client.post('/api/projects', json={'name': 'Shop A'}).json()['id']
        b = client.post('/api/projects', json={'name': 'Shop B'}).json()['id']
        use(client, a); ds_a = upload(client, 'a-sales.csv'); run_a = ask(client, ds_a, 'PROJECT-A revenue by region'); chart_a, board_a = chart_and_dashboard(client, run_a, 'A chart')
        use(client, b); ds_b = upload(client, 'b-sales.csv'); run_b = ask(client, ds_b, 'PROJECT-B revenue by region'); chart_b, board_b = chart_and_dashboard(client, run_b, 'B chart')
        yield dict(client=client, tmp=tmp_path, legacy=legacy, a=a, b=b, ds_a=ds_a, ds_b=ds_b, run_a=run_a, run_b=run_b,
                   chart_a=chart_a, chart_b=chart_b, board_a=board_a, board_b=board_b)


def ids(response):
    assert response.status_code == 200, response.text
    return {item['id'] for item in response.json()}


# 1 · datasets list, selector and its search (selector filters this list client-side)
def test_01_datasets_list_and_references_show_only_the_active_project(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    assert ids(c.get('/api/datasets?include_archived=true')) == {t['ds_a']}
    assert {r['id'] for r in c.get('/api/datasets/references').json()} == {t['ds_a']}
    use(c, t['b'])
    assert ids(c.get('/api/datasets?include_archived=true')) == {t['ds_b']}
    use(c, 'default')
    assert ids(c.get('/api/datasets?include_archived=true')) == {t['legacy']}


# 2 · questions/runs, Home recent answers, Performance & errors, Execution traces (all read these)
def test_02_runs_analytics_and_traces_are_scoped(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    assert ids(c.get('/api/analyst/runs')) == {t['run_a']['id']}
    analytics = c.get('/api/analytics/runs').json()
    assert analytics['total_questions'] == 1
    assert c.get('/api/analytics/runs?search=PROJECT-B').json()['total_questions'] == 0  # search cannot reach B
    assert all(r['dataset_id'] == t['ds_a'] for r in analytics['recent'])
    assert c.get('/api/analyst/runs/' + t['run_b']['id']).status_code == 404
    assert c.get('/api/analyst/runs/' + t['run_b']['id'] + '/results').status_code == 404
    use(c, 'default')
    assert ids(c.get('/api/analyst/runs')) == set()


# 3 · dashboards, saved charts, pin destinations
def test_03_dashboards_and_saved_charts_are_scoped(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    assert ids(c.get('/api/dashboards')) == {t['board_a']['id']}
    assert ids(c.get('/api/saved-charts')) == {t['chart_a']['id']}
    assert c.get('/api/dashboards/' + t['board_b']['id']).status_code == 404
    assert c.get('/api/saved-charts/' + t['chart_b']['id']).status_code == 404
    assert c.get(f"/api/dashboards/{t['board_b']['id']}/report.pdf").status_code == 404
    use(c, 'default')
    assert ids(c.get('/api/dashboards')) == set() and ids(c.get('/api/saved-charts')) == set()


# 4 · cross-project chart attachment is rejected
def test_04_cannot_attach_a_chart_from_another_project(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    board = c.get('/api/dashboards/' + t['board_a']['id']).json()
    response = c.post(f"/api/dashboards/{t['board_a']['id']}/charts", json={'chart_id': t['chart_b']['id'], 'revision': board['revision'], 'duplicate_action': 'cancel'})
    assert response.status_code == 404
    assert c.get('/api/dashboards/' + t['board_a']['id']).json()['widgets'] == board['widgets']


# 5 · suggested questions
def test_05_suggestions_only_for_the_active_projects_datasets(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    assert c.get(f"/api/datasets/{t['ds_b']}/suggested-questions").status_code == 404
    assert c.get(f"/api/datasets/{t['ds_a']}/suggested-questions").status_code == 200


# 6 · RAG retrieval
def test_06_rag_retrieval_never_returns_another_projects_context(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    assert c.put(f"/api/datasets/{t['ds_a']}/knowledge", json={'description': 'SECRET-A-CONTEXT'}).status_code == 200
    use(c, t['b'])
    retrieved = c.post(f"/api/datasets/{t['ds_b']}/knowledge/retrieve", json={'question': 'SECRET-A-CONTEXT revenue', 'top_k': 6})
    assert retrieved.status_code == 200, retrieved.text
    body = json.dumps(retrieved.json())
    assert 'SECRET-A-CONTEXT' not in body
    assert all(d['dataset_id'] == t['ds_b'] for d in retrieved.json().get('documents', []))
    assert c.post(f"/api/datasets/{t['ds_a']}/knowledge/retrieve", json={'question': 'revenue', 'top_k': 6}).status_code == 404


# 7 · knowledge (definitions, drafts, review)
def test_07_knowledge_of_another_project_is_unreachable(two_projects):
    t = two_projects; c = t['client']
    use(c, t['b'])
    for path in ('/knowledge', '/knowledge/review', '/profile', '/profile-details', '/quality', '/confirmed-types'):
        assert c.get(f"/api/datasets/{t['ds_a']}{path}").status_code == 404, path
    assert c.put(f"/api/datasets/{t['ds_a']}/knowledge", json={'description': 'overwrite'}).status_code == 404


# 8 · AutoML experiments, models, predictions, batch prediction dataset
def test_08_automl_items_are_scoped(tmp_path, monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'PRIVATE-TEST-DO-NOT-INHERIT')
    with TestClient(create_app(tmp_path, provider=NoProvider(), embedder=NoEmbeddings())) as c:
        a = c.post('/api/projects', json={'name': 'ML A'}).json()['id']
        b = c.post('/api/projects', json={'name': 'ML B'}).json()['id']
        use(c, a); ds_a = upload(c, 'ml-a.csv', regression_csv()); job_a = finish_ml(c, start(c, ds_a))
        use(c, b); ds_b = upload(c, 'ml-b.csv', regression_csv())
        assert job_a['status'] == 'completed'
        use(c, a)
        models_a = c.get('/api/automl/models').json()
        assert {e['id'] for e in c.get('/api/automl/experiments').json()} == {job_a['id']} and models_a
        model = models_a[0]['id']
        assert c.post(f'/api/automl/models/{model}/predict', json={'dataset_id': ds_b}).status_code == 404  # batch from B rejected
        predicted = c.post(f'/api/automl/models/{model}/predict', json={'dataset_id': ds_a})
        assert predicted.status_code in (200, 201), predicted.text
        assert c.get('/api/automl/predictions').json()
        use(c, b)
        assert c.get('/api/automl/experiments').json() == []
        assert c.get('/api/automl/models').json() == []
        assert c.get('/api/automl/predictions').json() == []
        assert c.get('/api/automl/experiments/' + job_a['id']).status_code == 404
        assert c.get('/api/automl/models/' + model).status_code == 404
        assert c.post('/api/automl/experiments', json={'dataset_id': ds_a, 'task': 'regression'}).status_code == 404


# 9 · the Admin test benchmark is outside owner projects
def test_09_benchmark_is_not_an_owner_project_item(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    installed = c.post('/api/benchmarks/retail-v1/install').json()
    with sqlite3.connect(t['tmp'] / 'catalog.sqlite') as db:
        assert db.execute("SELECT COUNT(*) FROM project_items WHERE item_id=?", (installed['dataset_id'],)).fetchone()[0] == 0
    for project in (t['a'], t['b'], 'default'):
        use(c, project)
        listed = {d['id']: d for d in c.get('/api/datasets?include_archived=true').json()}
        assert listed[installed['dataset_id']]['is_benchmark'] is True  # owner views hide it (Stage 1)
        assert c.get('/api/evaluations').status_code == 200


# 10 · audit view (revision history + audit sources) and the editor
def test_10_audit_and_editor_views_are_scoped(two_projects):
    t = two_projects; c = t['client']
    use(c, t['b'])
    assert c.get(f"/api/datasets/{t['ds_a']}/revisions").status_code == 404
    assert c.get(f"/api/datasets/{t['ds_a']}/rows").status_code == 404
    assert c.get(f"/api/datasets/{t['ds_a']}/export").status_code == 404
    assert c.get(f"/api/datasets/{t['ds_a']}/dependencies").status_code == 404
    use(c, t['a'])
    assert c.get(f"/api/datasets/{t['ds_a']}/revisions").status_code == 200


# 11 · archive hides the project and blocks new work; restore brings everything back
def test_11_archive_is_reversible(two_projects):
    t = two_projects; c = t['client']
    use(c, 'default')
    assert c.post(f"/api/projects/{t['a']}/archive").json()['archived_at']
    use(c, t['a'])
    assert c.get('/api/datasets').status_code == 409
    assert c.post('/api/datasets', files={'file': ('x.csv', CSV, 'text/csv')}).status_code == 409
    assert c.get('/api/projects').status_code == 200
    use(c, 'default')
    assert ids(c.get('/api/datasets?include_archived=true')) == {t['legacy']}
    assert c.post(f"/api/projects/{t['a']}/restore").json()['archived_at'] is None
    use(c, t['a'])
    assert ids(c.get('/api/datasets?include_archived=true')) == {t['ds_a']}
    assert ids(c.get('/api/dashboards')) == {t['board_a']['id']}


# 12 · deleting a dataset in A keeps A's history in A and never surfaces in B
def test_12_deleted_dataset_history_stays_in_its_project(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    name = c.get('/api/datasets/' + t['ds_a']).json()['name']
    assert c.request('DELETE', '/api/datasets/' + t['ds_a'], json={'confirm_name': name, 'acknowledge_dependencies': True}).status_code == 204
    assert t['run_a']['id'] in ids(c.get('/api/analyst/runs'))
    for project in (t['b'], 'default'):
        use(c, project)
        assert t['run_a']['id'] not in ids(c.get('/api/analyst/runs'))
        assert all(r['id'] != t['ds_a'] for r in c.get('/api/datasets/references').json())


# 13 + 14 · additive migration: backup first, existing rows unchanged, Default = all pre-migration items
def dump_without_project_tables(path):
    with sqlite3.connect(path) as db:
        return [line for line in db.iterdump()
                if '"projects"' not in line and '"project_items"' not in line and 'TABLE projects' not in line
                and 'TABLE project_items' not in line and 'INDEX ix_project_items' not in line
                and not line.startswith('INSERT INTO "schema_migrations" VALUES(11,')]


def test_13_14_migration_is_additive_and_default_owns_everything(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        first = upload(c, 'pre-1.csv'); second = upload(c, 'pre-2.csv'); run = ask(c, first)
        board = c.post('/api/dashboards', json={'title': 'Pre-existing', 'description': ''}).json()
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:  # make it look like a version-10 catalog
        db.execute('DROP TABLE project_items'); db.execute('DROP TABLE projects')
        db.execute('DELETE FROM schema_migrations WHERE version=11')
    before = dump_without_project_tables(catalog)
    files = {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file() and 'backups' not in p.parts and not p.name.startswith('catalog.sqlite')}
    with TestClient(make_app(tmp_path)) as c:
        assert ids(c.get('/api/datasets')) == {first, second}
        assert ids(c.get('/api/analyst/runs')) == {run['id']}
        assert ids(c.get('/api/dashboards')) == {board['id']}
        assert c.get('/api/projects').json() == [{'id': 'default', 'name': 'Default project', 'is_default': True, 'archived_at': None, 'created_at': None}]
    with sqlite3.connect(catalog) as db:
        assert {'projects', 'project_items'} <= {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert db.execute('SELECT COUNT(*) FROM project_items').fetchone()[0] == 0  # virtual Default: no rows written
        assert 11 in {r[0] for r in db.execute('SELECT version FROM schema_migrations')}
    assert dump_without_project_tables(catalog) == before
    backups = sorted((tmp_path / 'backups').glob('projects-v11-*'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0] / 'catalog.sqlite') as db:
        assert 'projects' not in {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for relative, content in files.items():
        assert (backups[0] / 'storage' / relative).read_bytes() == content


# Extra cases
def test_new_items_are_created_in_the_active_project(two_projects):
    t = two_projects
    with sqlite3.connect(t['tmp'] / 'catalog.sqlite') as db:
        rows = set(db.execute('SELECT item_type,item_id,project_id FROM project_items'))
    assert ('dataset', t['ds_a'], t['a']) in rows and ('dataset', t['ds_b'], t['b']) in rows
    assert ('dashboard', t['board_a']['id'], t['a']) in rows and ('dashboard', t['board_b']['id'], t['b']) in rows
    assert not any(r[1] == t['legacy'] for r in rows)  # Default stays unmapped


def test_questions_and_bulk_actions_cannot_reference_another_project(two_projects):
    t = two_projects; c = t['client']
    use(c, t['a'])
    assert c.post('/api/analyst/runs', json={'dataset_id': t['ds_b'], 'question': 'x', 'type_mapping': {}}).status_code == 404
    assert c.post('/api/saved-charts', json={'run_id': t['run_b']['id'], 'title': 'x', 'spec': {'kind': 'bar', 'x': 0, 'y': 1}, 'refresh_policy': 'manual', 'persist_snapshot_confirmed': True}).status_code == 404
    assert c.post('/api/datasets/bulk-archive', json={'ids': [t['ds_a'], t['ds_b']]}).status_code == 404
    use(c, t['b'])
    assert c.get('/api/datasets/' + t['ds_b']).json()['archived_at'] is None


def test_project_management_rules(two_projects):
    t = two_projects; c = t['client']
    use(c, 'default')
    assert c.post('/api/projects', json={'name': 'shop a'}).status_code == 409  # names are unique (case-insensitive)
    assert c.post('/api/projects', json={'name': 'Default project'}).status_code == 409
    assert c.patch('/api/projects/default', json={'name': 'Main shop'}).json()['name'] == 'Main shop'
    assert c.patch(f"/api/projects/{t['a']}", json={'name': 'Shop A (north)'}).json()['name'] == 'Shop A (north)'
    assert c.post('/api/projects/default/archive').status_code == 409
    assert c.request('DELETE', '/api/projects/default', json={'confirm_name': 'Main shop'}).status_code == 409
    assert [p['name'] for p in c.get('/api/projects').json()][:1] == ['Main shop']


def test_delete_needs_typed_name_shows_dependencies_and_moves_items_to_default(two_projects):
    t = two_projects; c = t['client']
    use(c, 'default')
    deps = c.get(f"/api/projects/{t['b']}/dependencies").json()
    assert deps['counts']['datasets'] == 1 and deps['counts']['dashboards'] == 1 and deps['counts']['questions'] == 1 and deps['counts']['saved_charts'] == 1
    assert 'No data is deleted' in deps['on_delete']
    assert c.request('DELETE', f"/api/projects/{t['b']}", json={'confirm_name': 'shop b'}).status_code == 422
    with sqlite3.connect(t['tmp'] / 'catalog.sqlite') as db:
        datasets_before = db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0]
    assert c.request('DELETE', f"/api/projects/{t['b']}", json={'confirm_name': 'Shop B'}).json()['items_moved_to_default'] == 2
    assert ids(c.get('/api/datasets?include_archived=true')) == {t['legacy'], t['ds_b']}
    assert t['board_b']['id'] in ids(c.get('/api/dashboards'))
    with sqlite3.connect(t['tmp'] / 'catalog.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0] == datasets_before
    use(c, t['b'])
    assert c.get('/api/datasets').status_code == 404  # the project is gone


def test_cookie_selects_the_project_and_unknown_projects_are_refused(two_projects):
    t = two_projects; c = t['client']
    c.headers.pop(H, None)
    c.cookies.set('insightiq_project', t['b'])
    assert ids(c.get('/api/datasets')) == {t['ds_b']}
    c.cookies.set('insightiq_project', '00000000-0000-0000-0000-000000000000')
    assert c.get('/api/datasets').status_code == 404
    c.cookies.set('insightiq_project', 'not-a-uuid')
    assert c.get('/api/datasets').status_code == 404
    c.cookies.clear()
    assert ids(c.get('/api/datasets')) == {t['legacy']}


def test_owner_upgrade_script_is_additive_guarded_and_idempotent(tmp_path, capsys):
    import shutil
    from scripts.upgrade_projects import main as upgrade
    data = tmp_path / 'data'
    with TestClient(make_app(data)) as c:
        upload(c, 'existing.csv')
        c.post('/api/dashboards', json={'title': 'Existing', 'description': ''})
    catalog = data / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:  # simulate the original (version-9) workspace
        for table in ('project_items', 'projects', 'confirmed_column_types'):
            db.execute(f'DROP TABLE {table}')
        db.execute('DELETE FROM schema_migrations WHERE version IN (10, 11)')
    shutil.rmtree(data / 'backups', ignore_errors=True)
    before = sqlite3.connect(catalog).execute('SELECT COUNT(*) FROM datasets').fetchone()[0]
    with pytest.raises(SystemExit):
        upgrade(['--data-dir', str(data), '--backup', str(tmp_path / 'missing')])
    owner_backup = tmp_path / 'owner-backup'; owner_backup.mkdir()
    shutil.copy(catalog, owner_backup / 'catalog-consistent.sqlite')
    assert upgrade(['--data-dir', str(data), '--backup', str(owner_backup), '--dry-run']) == 0
    with sqlite3.connect(catalog) as db:
        assert 'projects' not in {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert upgrade(['--data-dir', str(data), '--backup', str(owner_backup)]) == 0
    out = capsys.readouterr().out
    assert 'Verified:' in out and 'project_items rows: 0' in out
    with sqlite3.connect(catalog) as db:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {'projects', 'project_items', 'confirmed_column_types'} <= tables
        assert {10, 11} <= {r[0] for r in db.execute('SELECT version FROM schema_migrations')}
        assert db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0] == before
    assert sorted(p.name.split('-v')[0] for p in (data / 'backups').iterdir()) == ['confirmed-types', 'projects']
    assert upgrade(['--data-dir', str(data), '--backup', str(owner_backup)]) == 0  # second run: nothing to do
    with TestClient(make_app(data)) as c:  # the upgraded workspace opens with everything in Default
        assert len(c.get('/api/datasets').json()) == before and len(c.get('/api/dashboards').json()) == 1
