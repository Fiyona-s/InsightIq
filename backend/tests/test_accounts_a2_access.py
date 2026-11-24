"""Accounts stage A2: a minimum role on every route, enforced when AUTH_MODE=on. Controlled fixtures only; no live AI.

For every route in ROUTE_ACCESS (125 today): unauthenticated gets 401 except the public list; a viewer calling an analyst
or owner route and an analyst calling an owner route get 403 with the catalog unchanged; a session of one instance is
refused on another instance; a route without an access level is refused. In local mode (AUTH_MODE=off) nothing changes.
This proves the ROLE CHECK on each route. It does not prove that data is separate or protected.
"""
import hashlib
import re
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.projects import ROUTE_ACCESS, ROUTE_SCOPES
from tests.test_accounts_a1 import PASSWORD, client, login, make, on, seed
from tests.test_phase4 import make_app

ZERO = '0' * 8 + '-0000-0000-0000-' + '0' * 12
ROLE_REFUSED = {'detail': 'Your role does not allow this.'}
HOSTED_ONLY = {'detail': 'This area is not available in hosted mode.'}
NO_LEVEL = {'detail': 'This route has no access level and is refused.'}
ROUTES = sorted(ROUTE_ACCESS)


def concrete(path):
    path = path.replace('{case_id}', 'q01').replace('{revision}', '1')
    return re.sub(r'\{[a-z_]+\}', ZERO, path)


def call(c, key):
    method, path = key.split(' ', 1)
    body = {} if method != 'GET' else None
    return c.request(method, concrete(path), json=body, headers={'origin': 'https://testserver'})


def catalog_hash(root):
    with sqlite3.connect(root / 'catalog.sqlite') as db:
        return hashlib.sha256('\n'.join(db.iterdump()).encode()).hexdigest()


@pytest.fixture
def hosted(tmp_path):
    application = make(tmp_path)
    people = {}
    with client(application) as base:
        for role in ('viewer', 'analyst', 'owner'):
            seed(application, f'{role}@example.com', role)
    for role in ('viewer', 'analyst', 'owner'):
        c = client(application)
        assert login(c, f'{role}@example.com').status_code == 200
        people[role] = c
    anonymous = client(application)
    yield application, tmp_path, people, anonymous


def detail(response):
    try:
        body = response.json()
    except ValueError:
        return ''
    return body.get('detail') if isinstance(body, dict) else ''


def refusal(response):
    return response.status_code == 403 and response.json() == ROLE_REFUSED


def test_there_are_134_routes_and_every_one_has_a_level():
    # A3 added POST /api/auth/change-password (125); A4 added 9 routes (redeem, two-step start and confirm, users x5, audit events): 134.
    assert len(ROUTES) == len(ROUTE_SCOPES) == 134 and set(ROUTE_ACCESS.values()) <= auth.ACCESS_LEVELS


def test_unauthenticated_gets_401_on_every_route_except_the_public_ones(hosted):
    _, _, _, anonymous = hosted
    wrong = []
    for key in ROUTES:
        method, path = key.split(' ', 1)
        if ROUTE_ACCESS[key] == 'public':
            continue
        response = call(anonymous, key)
        if response.status_code != 401:
            wrong.append((key, response.status_code))
    assert wrong == []
    assert anonymous.get('/api/health').status_code == 200 and anonymous.get('/api/auth/status').status_code == 200


def test_a_viewer_is_refused_on_every_analyst_and_owner_route_and_the_catalog_does_not_change(hosted):
    _, root, people, _ = hosted
    before = catalog_hash(root)
    wrong, refused = [], 0
    for key in ROUTES:
        level = ROUTE_ACCESS[key]
        if level in ('analyst', 'owner'):
            response = call(people['viewer'], key)
            if not refusal(response):
                wrong.append((key, response.status_code, response.text[:80]))
            refused += 1
    assert wrong == [] and refused == 91 + 11
    assert catalog_hash(root) == before


def test_an_analyst_is_refused_on_every_owner_route_and_the_catalog_does_not_change(hosted):
    _, root, people, _ = hosted
    before = catalog_hash(root)
    owner_routes = [k for k in ROUTES if ROUTE_ACCESS[k] == 'owner']
    assert len(owner_routes) == 11
    wrong = [(k, call(people['analyst'], k).status_code) for k in owner_routes if not refusal(call(people['analyst'], k))]
    assert wrong == []
    assert catalog_hash(root) == before


def test_what_each_role_is_allowed_is_not_refused_by_the_role_check(hosted):
    """For every route a role may call, the answer is never the role refusal (the handler may still say 404 or 422 for the fake ids)."""
    _, _, people, _ = hosted
    rank = auth.RANK
    wrong = []
    for key in ROUTES:
        level = ROUTE_ACCESS[key]
        if level in ('public', 'operator'):
            continue
        for role, c in people.items():
            if rank[role] >= rank[level]:
                response = call(c, key)
                if refusal(response) or detail(response) == NO_LEVEL['detail']:
                    wrong.append((role, key, response.status_code))
    assert wrong == []


def test_benchmark_and_evaluation_routes_are_not_served_to_anyone_in_hosted_mode(hosted):
    _, _, people, anonymous = hosted
    operator_routes = [k for k in ROUTES if ROUTE_ACCESS[k] == 'operator']
    assert len(operator_routes) == 13
    for role, c in people.items():
        for key in operator_routes:
            response = call(c, key)
            assert response.status_code == 404 and response.json() == HOSTED_ONLY, (role, key)
    for key in operator_routes:
        assert call(anonymous, key).status_code == 401               # authentication still comes first


def test_local_mode_serves_the_benchmark_and_evaluation_routes_exactly_as_before(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        assert c.get('/api/benchmarks').status_code == 200
        assert c.get('/api/evaluations').status_code == 200
        assert c.get('/api/analytics/runs').status_code == 200 and c.get('/api/datasets').status_code == 200
        assert c.delete(f'/api/dashboards/{ZERO}', ).status_code != 403           # no role check exists in local mode


def test_a_route_without_an_access_level_is_refused_even_for_the_owner(hosted):
    application, _, people, _ = hosted

    @application.get('/api/_added_later')
    def added():
        return {'ok': True}

    response = people['owner'].get('/api/_added_later')
    assert response.status_code == 403 and response.json() == NO_LEVEL
    assert people['viewer'].get('/api/_added_later').status_code == 403
    assert client(application).get('/api/_added_later').status_code == 401        # and unauthenticated still gets 401
    for doc in ('/docs', '/openapi.json', '/redoc'):
        assert people['owner'].get(doc).status_code == 403                         # framework routes have no level either


def test_head_requests_never_return_data_and_unknown_paths_are_404_only_after_signing_in(hosted):
    _, _, people, anonymous = hosted
    assert people['viewer'].head('/api/datasets').status_code == 405          # the API does not serve HEAD at all, so no data and no role question
    assert anonymous.head('/api/datasets').status_code == 401
    assert people['viewer'].get('/api/no-such-route').status_code == 404
    assert anonymous.get('/api/no-such-route').status_code == 401


def test_a_session_from_one_instance_is_refused_on_every_route_of_another(tmp_path):
    a, b = make(tmp_path / 'company-a'), make(tmp_path / 'company-b')
    with client(a):
        seed(a, 'owner@example.com', 'owner', company='Company A')
    with client(b):
        seed(b, 'owner@example.com', 'owner', company='Company B')        # even the same email and password
    ca, cb = client(a), client(b)
    assert login(ca).status_code == 200
    token = ca.cookies.get('insightiq_session')
    stolen = client(b)
    stolen.cookies.set('insightiq_session', token, domain='testserver.local')
    wrong = []
    for key in ROUTES:
        if ROUTE_ACCESS[key] == 'public':
            continue
        if call(stolen, key).status_code != 401:
            wrong.append(key)
    assert wrong == []
    assert ca.get('/api/auth/me').json()['company'] == 'Company A'
    assert login(cb).json()['company'] == 'Company B'                         # each instance knows only its own company


def test_me_returns_the_role_for_each_role(hosted):
    _, _, people, _ = hosted
    assert {role: c.get('/api/auth/me').json()['role'] for role, c in people.items()} == {'viewer': 'viewer', 'analyst': 'analyst', 'owner': 'owner'}


def test_a_viewer_reaches_the_dashboard_exports_and_nothing_with_raw_dataset_rows(hosted):
    """Dashboard PDF, CSV and JSON contain only pinned rows, so they stay viewer-allowed; dataset rows and exports do not."""
    _, _, people, _ = hosted
    viewer = people['viewer']
    for key in ('GET /api/dashboards/{identifier}/report.pdf', 'GET /api/dashboards/{identifier}/report.json',
                'GET /api/dashboards/{identifier}/widgets/{widget_id}/results.csv', 'GET /api/dashboards'):
        assert not refusal(call(viewer, key)), key
    for key in ('GET /api/datasets/{dataset_id}/rows', 'GET /api/datasets/{dataset_id}/preview', 'GET /api/datasets/{dataset_id}/export',
                'GET /api/analyst/runs/{run_id}/results', 'GET /api/analyst/runs/{run_id}/results.csv',
                'GET /api/automl/predictions/{identifier}/export.csv', 'GET /api/datasets', 'POST /api/analyst/runs',
                'GET /api/saved-charts', 'GET /api/saved-charts/{identifier}', 'GET /api/saved-charts/{identifier}/history'):          # A4: only what is pinned
        assert refusal(call(viewer, key)), key


def test_a_deactivated_user_or_changed_role_takes_effect_on_the_next_request(hosted):
    application, _, people, _ = hosted
    service = application.state.auth
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    with Session(service.engine) as s:
        analyst = s.scalars(select(service.m.User).where(service.m.User.email == 'analyst@example.com')).one()
        analyst.role = 'viewer'
        s.commit()
    assert people['analyst'].get('/api/auth/me').json()['role'] == 'viewer'                 # the role is read afresh on every request
    assert refusal(people['analyst'].get('/api/datasets'))                                  # the demotion applies immediately
