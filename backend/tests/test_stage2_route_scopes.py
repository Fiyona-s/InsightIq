"""Every API route is explicitly classified as project-scoped or global, and the classification
matches what is actually enforced. A new route without a classification fails this test.

Accounts A2: the same test is also the ACCESS test. Every route must carry a minimum role in ROUTE_ACCESS, and a route
without one fails here (and is refused at run time: default deny)."""
import re

from fastapi.routing import APIRoute

from app import auth
from app.projects import CODE_FILTERED_LISTS, Projects, ROUTE_ACCESS, ROUTE_SCOPES
from tests.test_phase4 import make_app
from tests.test_stage2_projects import two_projects, use  # noqa: F401  (fixture)

UUID = '00000000-0000-4000-8000-000000000000'


def routes(app):
    return {f'{m} {r.path}' for r in app.routes if isinstance(r, APIRoute) for m in r.methods}


def test_every_route_is_classified_and_no_classification_is_stale(tmp_path):
    actual = routes(make_app(tmp_path))
    unclassified = sorted(actual - set(ROUTE_SCOPES))
    stale = sorted(set(ROUTE_SCOPES) - actual)
    assert unclassified == [], 'Classify these routes in app/projects.py ROUTE_SCOPES: ' + ', '.join(unclassified)
    assert stale == [], 'Remove routes that no longer exist from ROUTE_SCOPES: ' + ', '.join(stale)


def test_classification_matches_enforcement():
    problems = []
    for key, scope in ROUTE_SCOPES.items():
        method, path = key.split(' ', 1)
        concrete = re.sub(r'\{[^}]+\}', UUID, path)
        if scope == 'path':
            if not any(p.match(concrete) for p, _ in Projects.PATHS):
                problems.append(f'{key}: classified path-scoped but no path guard matches')
        elif scope == 'list':
            if method != 'GET' or path not in CODE_FILTERED_LISTS | set(Projects.LIST_FILTERS):
                problems.append(f'{key}: classified list but not a filtered list endpoint')
        elif scope in ('create', 'body'):
            if method not in ('POST', 'PUT', 'PATCH'):
                problems.append(f'{key}: {scope} must be a write')
        elif scope.startswith('global:'):
            if not Projects.EXEMPT.match(concrete):
                problems.append(f'{key}: global but not exempt from the project middleware')
            if len(scope) < len('global:') + 10:
                problems.append(f'{key}: global without a reason')
        else:
            problems.append(f'{key}: unknown scope {scope}')
        if scope != 'path' and not scope.startswith('global:') and any(p.match(concrete) for p, _ in Projects.PATHS):
            problems.append(f'{key}: also matches a path guard; classify it as path')
    assert problems == []


def test_every_path_scoped_route_refuses_another_projects_items(two_projects):  # noqa: F811
    """Call each dataset/run/chart/dashboard route with project A's ids while project B is active."""
    t = two_projects; c = t['client']
    owner = {'datasets': t['ds_a'], 'runs': t['run_a']['id'], 'saved-charts': t['chart_a']['id'], 'dashboards': t['board_a']['id']}
    checked = 0
    use(c, t['b'])
    for key, scope in ROUTE_SCOPES.items():
        method, path = key.split(' ', 1)
        match = re.match(r'^/api/(?:analyst/)?(datasets|runs|saved-charts|dashboards)/\{[^}]+\}', path)
        if scope != 'path' or not match:
            continue
        first = owner[match.group(1)]
        concrete = re.sub(r'\{[^}]+\}', first, path, count=1)
        concrete = re.sub(r'\{revision\}', '1', concrete)
        concrete = re.sub(r'\{[^}]+\}', UUID, concrete)
        response = c.request(method, concrete, json={} if method in ('POST', 'PUT', 'PATCH', 'DELETE') else None)
        assert response.status_code == 404 and response.json().get('detail') == 'Not found in this project.', (key, response.status_code, response.text[:200])
        checked += 1
    # Every non-AutoML path-scoped route was exercised; AutoML item routes need trained-model ids and are
    # covered by test_classification_matches_enforcement plus test_08 (real local training).
    assert checked == sum(1 for k, v in ROUTE_SCOPES.items() if v == 'path' and '/api/automl/' not in k)
    use(c, t['a'])  # nothing was changed by the refused calls
    assert c.get('/api/datasets/' + t['ds_a']).status_code == 200
    assert c.get('/api/dashboards/' + t['board_a']['id']).json()['widgets']
    assert c.get('/api/saved-charts/' + t['chart_a']['id']).status_code == 200


# ---- Accounts A2: every route has a minimum role -------------------------------------------------------------------
def test_every_route_has_an_access_level_and_none_is_stale(tmp_path):
    actual = routes(make_app(tmp_path))
    missing = sorted(actual - set(ROUTE_ACCESS))
    stale = sorted(set(ROUTE_ACCESS) - actual)
    assert missing == [], 'Give these routes a minimum role in app/projects.py ROUTE_ACCESS: ' + ', '.join(missing)
    assert stale == [], 'Remove routes that no longer exist from ROUTE_ACCESS: ' + ', '.join(stale)
    assert set(ROUTE_ACCESS) == set(ROUTE_SCOPES)                       # the two tables describe exactly the same routes


def test_access_levels_are_valid_and_the_public_list_is_exactly_the_public_routes():
    assert set(ROUTE_ACCESS.values()) <= auth.ACCESS_LEVELS
    assert {tuple(k.split(' ', 1)) for k, v in ROUTE_ACCESS.items() if v == 'public'} == set(auth.PUBLIC_ROUTES)


def test_access_levels_follow_the_decided_rules():
    """The role table of docs/ACCOUNTS_PLAN.md section 4 with the A2 details, pinned so a change has to be deliberate."""
    expected_owner = {'GET /api/analytics/runs', 'DELETE /api/projects/{identifier}', 'DELETE /api/dashboards/{identifier}',
                      'DELETE /api/datasets/{dataset_id}', 'POST /api/datasets/bulk-delete',
                      # A4: people and the security log
                      'GET /api/users', 'POST /api/users', 'PATCH /api/users/{user_id}', 'POST /api/users/{user_id}/unlock',
                      'POST /api/users/{user_id}/reset-link', 'GET /api/audit-events'}
    assert {k for k, v in ROUTE_ACCESS.items() if v == 'owner'} == expected_owner
    assert all(v == 'operator' for k, v in ROUTE_ACCESS.items() if '/api/benchmarks' in k or '/api/evaluations' in k)
    assert all(v == 'analyst' for k, v in ROUTE_ACCESS.items() if k.split(' ', 1)[1].startswith(('/api/analyst', '/api/automl')))
    # a viewer may reach exactly these: dashboards and saved answers (pinned rows only), plus names, currency status and projects (read)
    viewer = {k for k, v in ROUTE_ACCESS.items() if v == 'viewer'}
    assert viewer == {
        'POST /api/auth/logout', 'GET /api/auth/me', 'POST /api/auth/change-password', 'GET /api/currency/status', 'POST /api/currency/convert', 'GET /api/projects',
        'GET /api/datasets/references',
        'GET /api/dashboards', 'GET /api/dashboards/{identifier}', 'GET /api/dashboards/{identifier}/report.json', 'GET /api/dashboards/{identifier}/report.pdf',
        'GET /api/dashboards/{identifier}/widgets/{widget_id}/results.csv', 'GET /api/dashboards/{dashboard}/widgets/{identifier}/history',
        # A4: saved-chart reads are analyst-level, so a viewer reaches only what is pinned to a dashboard
        'POST /api/auth/two-step/start', 'POST /api/auth/two-step/confirm'}
    # nothing that returns raw dataset rows or a dataset export is open to a viewer
    for key, level in ROUTE_ACCESS.items():
        path = key.split(' ', 1)[1]
        if path.startswith('/api/datasets/{') and level not in ('analyst', 'owner'):
            raise AssertionError(f'{key} must not be open to a viewer')
