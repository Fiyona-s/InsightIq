"""Accounts stage A3 (backend part): first-login password change, how the frontend is served, and the pinned-rows check.
Controlled fixtures only; no live AI. Not a claim that data is separate or protected."""
import re
import time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import auth
from tests.test_accounts_a1 import PASSWORD, ORIGIN, client, login, make, seed
from tests.test_analyst import CSV
from tests.test_phase4 import make_app

NEW = 'a different long passphrase'
GATE = {'detail': 'Change your password before continuing.', 'code': 'password_change_required'}


def change(c, current=PASSWORD, new=NEW):
    return c.post('/api/auth/change-password', json={'current_password': current, 'new_password': new}, headers=ORIGIN)


def seed_must_change(application, email='first@example.com', role='owner'):
    service = application.state.auth
    with Session(service.engine) as s:
        company = service.company(s) or service.create_company(s, 'Acme')
        service.create_user(s, company.id, email, 'First Owner', role, PASSWORD, must_change=True)
        s.commit()


def test_a_user_who_must_change_the_password_can_only_reach_me_logout_and_change_password(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed_must_change(application)
        response = login(c, 'first@example.com')
        assert response.status_code == 200 and response.json()['must_change_password'] is True
        assert c.get('/api/auth/me').json()['must_change_password'] is True
        for method, path in (('GET', '/api/datasets'), ('GET', '/api/dashboards'), ('POST', '/api/analyst/runs'), ('GET', '/api/projects'),
                             ('GET', '/api/currency/status'), ('GET', '/api/no-such-route')):
            r = c.request(method, path, json={} if method == 'POST' else None, headers=ORIGIN)
            assert r.status_code == 403 and r.json() == GATE, (method, path, r.status_code)
        assert c.post('/api/auth/logout', headers=ORIGIN).status_code == 200


def test_changing_the_password_clears_the_requirement_keeps_you_signed_in_and_ends_other_sessions(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed_must_change(application)
        login(c, 'first@example.com')
        other = client(application)
        login(other, 'first@example.com')                                     # a second sign-in revoked the first one
        old_token = other.cookies.get('insightiq_session')
        response = change(c, PASSWORD, NEW)
        assert response.status_code == 200, response.text
        assert response.json()['must_change_password'] is False
        assert response.headers['set-cookie'].lower().count('httponly') == 1 and 'secure' in response.headers['set-cookie'].lower()
        assert application.state.auth.resolve_session(old_token) is None       # every earlier session ended
        assert c.get('/api/datasets').status_code == 200                       # the new session works at once
        c2 = client(application)
        assert login(c2, 'first@example.com', PASSWORD).status_code == 401     # the old password no longer works
        assert login(c2, 'first@example.com', NEW).status_code == 200


def test_a_wrong_current_password_a_weak_new_one_and_an_unchanged_one_are_refused_and_change_nothing(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed_must_change(application)
        login(c, 'first@example.com')
        wrong = change(c, 'not the password!!', NEW)
        assert wrong.status_code == 400 and wrong.json() == {'detail': 'Your current password is incorrect.'}
        assert change(c, PASSWORD, 'short').status_code == 400
        assert change(c, PASSWORD, 'passwordpassword').status_code == 400
        assert change(c, PASSWORD, PASSWORD).status_code == 400
        assert c.get('/api/auth/me').json()['must_change_password'] is True       # nothing changed, still signed in
        assert login(client(application), 'first@example.com', PASSWORD).status_code == 200


def test_repeated_wrong_current_passwords_lock_the_account_like_sign_in_does(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed_must_change(application)
        login(c, 'first@example.com')
        results = [change(c, 'not the password!!', NEW).status_code for _ in range(6)]
        assert results[:5] == [400] * 5 and results[5] == 429
        assert 'retry-after' in change(c, PASSWORD, NEW).headers


def test_change_password_needs_a_session_a_same_origin_request_and_login_to_be_on(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        assert change(c).status_code == 401                                   # no session
        login(c)
        body = {'current_password': PASSWORD, 'new_password': NEW}
        assert c.post('/api/auth/change-password', json=body, headers={'origin': 'https://evil.example'}).status_code == 403
        assert c.post('/api/auth/change-password', json=body).status_code == 403
        assert login(client(application)).status_code == 200                   # the refused calls changed nothing
    with TestClient(make_app(tmp_path / 'local')) as local:
        assert local.post('/api/auth/change-password', json=body).status_code == 409   # local mode: login is off


def test_every_role_may_change_its_own_password(tmp_path):
    application = make(tmp_path)
    with client(application):
        for role in ('viewer', 'analyst', 'owner'):
            seed(application, f'{role}@example.com', role)
    for role in ('viewer', 'analyst', 'owner'):
        c = client(application)
        login(c, f'{role}@example.com')
        assert change(c).status_code == 200 and c.get('/api/auth/me').json()['role'] == role


# ---- how the frontend is served ------------------------------------------------------------------------------------
def test_fastapi_serves_no_frontend_files_so_the_sign_in_page_comes_from_the_web_server(tmp_path):
    """The frontend is static files behind nginx (frontend/nginx.conf); the API only answers /api. The sign-in page therefore
    loads without a session and no API route has to be opened for it beyond the three public routes."""
    application = make(tmp_path)
    kinds = {type(r).__name__ for r in application.routes}
    assert 'Mount' not in kinds, 'the API must not mount static files'
    assert not any('StaticFiles' in Path(f).read_text() for f in Path('app').glob('*.py'))
    assert auth.PUBLIC_ROUTES == {('GET', '/api/health'), ('GET', '/api/auth/status'), ('POST', '/api/auth/login'), ('POST', '/api/auth/redeem')}      # redeem: A4
    with client(application) as c:
        for path in ('/', '/index.html', '/assets/index.js', '/favicon.svg'):
            assert c.get(path).status_code == 401                                # not served by the API, and not open without a session


def test_the_web_server_serves_the_pages_and_forwards_only_api_paths():
    conf = (Path(__file__).resolve().parents[2] / 'frontend' / 'nginx.conf').read_text()
    assert 'root /usr/share/nginx/html;' in conf
    locations = re.findall(r'location\s+(\S+)\s*\{([^}]*)\}', conf)
    proxied = [path for path, body in locations if 'proxy_pass' in body]
    assert proxied == ['/api/'], 'only /api/ may be forwarded to the application'
    assert dict(locations)['/'].strip().startswith('try_files $uri $uri/ /index.html')      # the single-page app, including the sign-in screen


# ---- saved chart vs pinned tile -------------------------------------------------------------------------------------
def test_a_saved_charts_payload_holds_nothing_beyond_what_a_pinned_tile_holds(tmp_path):
    """Checked for A3: viewers may read saved charts and dashboards. A saved chart's fields are exactly the tile's `source`
    fields, and its snapshot rows are exactly the tile's result rows. (Which saved charts a viewer can reach is a separate
    question: see docs/ACCOUNTS_A3_REVIEW.md.)"""
    with TestClient(make_app(tmp_path)) as c:
        dataset = c.post('/api/datasets', files={'file': ('o.csv', CSV, 'text/csv')}).json()
        run = c.post('/api/analyst/runs', json={'dataset_id': dataset['id'], 'question': 'q', 'type_mapping': {'revenue': 'DOUBLE'}}).json()
        for _ in range(60):
            if c.get('/api/analyst/runs/' + run['id']).json()['status'] == 'succeeded':
                break
            time.sleep(.2)
        chart = c.post('/api/saved-charts', json={'run_id': run['id'], 'title': 'T', 'persist_snapshot_confirmed': True}).json()
        full = c.get('/api/saved-charts/' + chart['id']).json()
        board = c.post('/api/dashboards', json={'title': 'D'}).json()
        c.put('/api/dashboards/' + board['id'], json={'title': 'D', 'description': '', 'revision': board['revision'], 'filters': [], 'widgets': [
            {'chart_id': chart['id'], 'kind': 'chart', 'title': 'T', 'width': 6, 'height': 4}]})
        tile = c.get('/api/dashboards/' + board['id']).json()['widgets'][0]
        assert set(full) - {'snapshot'} == set(tile['source'])
        assert full['snapshot']['rows'] == tile['result']['rows'] and full['snapshot']['columns'] == tile['result']['columns']
        assert {k: v for k, v in full.items() if k != 'snapshot'} == {k: v for k, v in tile['source'].items()}


def test_the_public_status_route_names_only_the_caller_s_own_session_and_nothing_secret(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        assert c.get('/api/auth/status').json()['user'] is None                       # no session: no user, and no failing call needed
        login(c)
        status = c.get('/api/auth/status').json()
        assert status['user']['email'] == 'owner@example.com' and status['user']['role'] == 'owner'
        assert set(status['user']) == {'email', 'display_name', 'role', 'company', 'must_change_password', 'must_enrol_two_step'}
        assert 'hash' not in str(status) and PASSWORD not in str(status)
        anonymous = client(application)
        anonymous.cookies.set('insightiq_session', 'not-a-session', domain='testserver.local')
        assert anonymous.get('/api/auth/status').json()['user'] is None                # a forged cookie names nobody
        c.post('/api/auth/logout', headers=ORIGIN)
        assert c.get('/api/auth/status').json()['user'] is None                        # and a signed-out cookie names nobody
