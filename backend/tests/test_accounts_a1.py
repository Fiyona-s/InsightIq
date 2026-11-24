"""Accounts stage A1: the authentication core. Controlled fixtures only; no live AI call.

These tests prove what A1 builds (hashing, sessions, lockout, start-up rules, the default-deny middleware, the operator
tool, the migrations). They do NOT prove that data is separate or protected: roles are not enforced until A2.
"""
import shutil
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, declarative_base

import app.main as main
from app import auth
from app.main import create_app
from app.persistence import register_phase4
from app.projects import ROUTE_SCOPES
from scripts import accounts_cli
from tests.test_analyst import CSV
from tests.test_phase4 import make_app

PASSWORD = 'correct horse battery'
ORIGIN = {'origin': 'https://testserver'}


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 22, 9, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


def on(**kw):
    return auth.AuthConfig(mode='on', **kw)


def build(tmp_path, config=None):
    """An app with login required, plus a company with an owner (created through the same module the CLI uses)."""
    application = create_app(tmp_path, provider=make_app(tmp_path).state.analyst.provider if False else None, embedder=None, auth_config=config or on())
    return application


def make(tmp_path, config=None):
    from tests.test_phase4 import ControlledProvider, ControlledEmbedding
    return create_app(tmp_path, provider=ControlledProvider('SELECT 1 AS n'), embedder=ControlledEmbedding(), auth_config=config or on())


def seed(application, email='owner@example.com', role='owner', password=PASSWORD, company='Acme'):
    service = application.state.auth
    with Session(service.engine) as s:
        existing = service.company(s)
        company_row = existing or service.create_company(s, company)
        user = service.create_user(s, company_row.id, email, 'Ola Owner', role, password, must_change=False)
        s.commit()
        return user.id


def client(application, **kw):
    return TestClient(application, base_url='https://testserver', **kw)


def login(c, email='owner@example.com', password=PASSWORD):
    return c.post('/api/auth/login', json={'email': email, 'password': password}, headers=ORIGIN)


# ---- migrations ---------------------------------------------------------------------------------------------------
def tables(path):
    with sqlite3.connect(path) as db:
        return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def versions(path):
    with sqlite3.connect(path) as db:
        return [r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]


def test_fresh_database_creates_v14_and_v15_with_their_registry_rows(tmp_path):
    with TestClient(make_app(tmp_path)):
        pass
    catalog = tmp_path / 'catalog.sqlite'
    assert set(auth.V14_TABLES + auth.V15_TABLES) <= tables(catalog)
    assert versions(catalog) == list(range(1, 18))
    with sqlite3.connect(catalog) as db:
        assert db.execute('SELECT COUNT(*) FROM companies').fetchone()[0] == 0 and db.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0


def test_existing_database_without_the_account_tables_gets_a_backup_first_then_only_additions(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        c.post('/api/datasets', files={'file': ('orders.csv', CSV, 'text/csv')})
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:
        for t in auth.V17_TABLES + auth.V16_TABLES + auth.V15_TABLES + auth.V14_TABLES:
            db.execute(f'DROP TABLE {t}')
        db.execute('DELETE FROM schema_migrations WHERE version IN (14, 15, 16, 17)')
    shutil.rmtree(tmp_path / 'backups', ignore_errors=True)
    with sqlite3.connect(catalog) as db:
        before = {t: db.execute(f'SELECT * FROM {t}').fetchall() for t in ('datasets', 'projects', 'analyst_runs', 'dataset_audit', 'schema_migrations')}
    with TestClient(make_app(tmp_path)):
        pass
    assert versions(catalog) == list(range(1, 18))
    with sqlite3.connect(catalog) as db:
        after = {t: db.execute(f'SELECT * FROM {t}').fetchall() for t in before}
    assert {k: v for k, v in after.items() if k != 'schema_migrations'} == {k: v for k, v in before.items() if k != 'schema_migrations'}
    assert after['schema_migrations'][:len(before['schema_migrations'])] == before['schema_migrations']       # existing rows untouched
    for label, names in (('v14', auth.V14_TABLES), ('v15', auth.V15_TABLES), ('v16', auth.V16_TABLES), ('v17', auth.V17_TABLES)):
        backups = sorted((tmp_path / 'backups').glob(f'accounts-{label}-*'))
        assert len(backups) == 1
        assert not (set(names) & tables(backups[0] / 'catalog.sqlite'))        # each backup is taken BEFORE its own tables exist
        assert (backups[0] / 'storage').is_dir()


def test_a_database_already_at_the_new_list_is_left_alone(tmp_path):
    with TestClient(make_app(tmp_path)):
        pass
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:
        registry = db.execute('SELECT * FROM schema_migrations').fetchall()
    folders = sorted(p.name for p in (tmp_path / 'backups').glob('*')) if (tmp_path / 'backups').exists() else []
    with TestClient(make_app(tmp_path)):
        pass
    with sqlite3.connect(catalog) as db:
        assert db.execute('SELECT * FROM schema_migrations').fetchall() == registry
    assert (sorted(p.name for p in (tmp_path / 'backups').glob('*')) if (tmp_path / 'backups').exists() else []) == folders


def test_tables_present_but_rows_missing_only_gets_the_rows(tmp_path):
    with TestClient(make_app(tmp_path)):
        pass
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:
        db.execute('DELETE FROM schema_migrations WHERE version IN (14, 15)')
    shutil.rmtree(tmp_path / 'backups', ignore_errors=True)
    with TestClient(make_app(tmp_path)):
        pass
    assert versions(catalog) == list(range(1, 18))
    assert not list((tmp_path / 'backups').glob('accounts-*')) if (tmp_path / 'backups').exists() else True


# ---- passwords ----------------------------------------------------------------------------------------------------
def test_passwords_are_argon2id_salted_verified_and_policy_checked():
    first, second = auth.hash_password(PASSWORD), auth.hash_password(PASSWORD)
    assert first.startswith('$argon2id$') and first != second and PASSWORD not in first
    assert auth.verify_password(first, PASSWORD) and not auth.verify_password(first, PASSWORD + 'x') and not auth.verify_password('not a hash', PASSWORD)
    assert not auth.needs_rehash(first)
    weak = auth.PasswordHasher(time_cost=1, memory_cost=8, parallelism=1, type=auth.Type.ID).hash(PASSWORD)
    assert auth.needs_rehash(weak)
    for bad in ('short', 'a' * 129, 'passwordpassword', 'aaaaaaaaaaaaaaaa', 'owner-name-owner'):
        with pytest.raises(auth.PolicyError):
            auth.validate_password(bad, 'owner-name@example.com')
    auth.validate_password('a long and unusual sentence', 'x@example.com')       # length matters, not composition


def test_a_weaker_stored_hash_is_upgraded_at_the_next_sign_in(tmp_path):
    application = make(tmp_path)
    with client(application):
        uid = seed(application)
    service = application.state.auth
    weak = auth.PasswordHasher(time_cost=1, memory_cost=8, parallelism=1, type=auth.Type.ID).hash(PASSWORD)
    with Session(service.engine) as s:
        s.get(service.m.User, uid).password_hash = weak
        s.commit()
    service.authenticate('owner@example.com', PASSWORD)
    with Session(service.engine) as s:
        assert not auth.needs_rehash(s.get(service.m.User, uid).password_hash)


# ---- sessions -----------------------------------------------------------------------------------------------------
def service_with_clock(tmp_path, **cfg):
    application = make(tmp_path, on(**cfg))
    clock = Clock()
    application.state.auth.clock = clock
    return application, application.state.auth, clock


def test_sessions_are_random_hashed_at_rest_expire_and_can_be_revoked(tmp_path):
    application, service, clock = service_with_clock(tmp_path, idle_seconds=3600, absolute_seconds=7200)
    with client(application):
        uid = seed(application)
        token = service.start_session(uid, 'UA')
        other = service.start_session(uid, 'UA')
        assert token != other and len(token) >= 40
        with Session(service.engine) as s:
            ids = {r.id for r in s.scalars(select(service.m.AuthSession))}
        assert token not in ids and auth._digest(token) in ids                    # only the hash is stored
        assert service.resolve_session(token).email == 'owner@example.com'
        clock.advance(seconds=3599)
        assert service.resolve_session(token) is not None                          # activity renews the idle window
        clock.advance(seconds=3601)
        assert service.resolve_session(token) is None                              # idle expiry
        clock.now -= timedelta(seconds=3601)
        fresh = service.start_session(uid)
        for _ in range(3):
            clock.advance(seconds=3000)
            service.resolve_session(fresh)
        assert service.resolve_session(fresh) is None                              # absolute expiry despite activity
        revoked = service.start_session(uid)
        service.revoke_session(revoked)
        assert service.resolve_session(revoked) is None
        assert service.resolve_session('') is None and service.resolve_session('x' * 300) is None


def test_password_change_and_deactivation_end_every_session(tmp_path):
    application, service, _ = service_with_clock(tmp_path)
    with client(application):
        uid = seed(application)
        a, b = service.start_session(uid), service.start_session(uid)
        service.set_password(uid, 'another long passphrase')
        assert service.resolve_session(a) is None and service.resolve_session(b) is None
        with pytest.raises(auth.LoginFailed):
            service.authenticate('owner@example.com', PASSWORD)
        assert service.authenticate('owner@example.com', 'another long passphrase') == uid
        c = service.start_session(uid)
        service.set_active(uid, False)
        assert service.resolve_session(c) is None                                  # deactivated users lose their sessions at once
        with pytest.raises(auth.LoginFailed):
            service.authenticate('owner@example.com', 'another long passphrase')


# ---- lockout ------------------------------------------------------------------------------------------------------
def test_five_failures_lock_the_account_with_growing_delays_and_success_resets(tmp_path):
    application, service, clock = service_with_clock(tmp_path)
    with client(application):
        uid = seed(application)
        for _ in range(5):
            with pytest.raises(auth.LoginFailed):
                service.authenticate('owner@example.com', 'wrong password!!', client='10.0.0.1')
        with pytest.raises(auth.LockedOut) as locked:
            service.authenticate('owner@example.com', PASSWORD, client='10.0.0.1')       # even the right password is refused while locked
        assert 1 <= locked.value.retry_after <= 60
        clock.advance(seconds=61)
        with pytest.raises(auth.LoginFailed):
            service.authenticate('owner@example.com', 'wrong password!!', client='10.0.0.1')   # 6th failure: longer lock
        with pytest.raises(auth.LockedOut) as longer:
            service.authenticate('owner@example.com', PASSWORD, client='10.0.0.1')
        assert 60 < longer.value.retry_after <= 120
        clock.advance(seconds=121)
        assert service.authenticate('owner@example.com', PASSWORD, client='10.0.0.1') == uid
        for _ in range(4):
            with pytest.raises(auth.LoginFailed):
                service.authenticate('owner@example.com', 'wrong password!!', client='10.0.0.2')
        assert service.authenticate('owner@example.com', PASSWORD, client='10.0.0.2') == uid   # a success clears the count
        for _ in range(4):
            with pytest.raises(auth.LoginFailed):
                service.authenticate('owner@example.com', 'wrong password!!', client='10.0.0.2')   # counting starts again from zero
        assert service.authenticate('owner@example.com', PASSWORD, client='10.0.0.2') == uid


def test_lock_never_exceeds_fifteen_minutes_and_locked_attempts_do_not_extend_it(tmp_path):
    application, service, clock = service_with_clock(tmp_path)
    with client(application):
        seed(application)
        for _ in range(5):
            with pytest.raises(auth.LoginFailed):
                service.authenticate('owner@example.com', 'x' * 14)
        for _ in range(30):                       # attempts while locked are refused and not counted
            with pytest.raises(auth.LockedOut):
                service.authenticate('owner@example.com', 'x' * 14)
        clock.advance(seconds=61)
        with pytest.raises(auth.LoginFailed):
            service.authenticate('owner@example.com', 'x' * 14)
        for _ in range(12):
            clock.advance(seconds=950)
            with pytest.raises(auth.LoginFailed):
                service.authenticate('owner@example.com', 'x' * 14)
        with pytest.raises(auth.LockedOut) as lock:
            service.authenticate('owner@example.com', 'x' * 14)
        assert lock.value.retry_after <= auth.LOCK_MAX_SECONDS


def test_unknown_emails_behave_like_known_ones_and_one_address_is_throttled(tmp_path):
    application, service, clock = service_with_clock(tmp_path)
    with client(application):
        seed(application)
        outcomes = []
        for email in ('owner@example.com', 'nobody@example.com'):
            row = []
            for _ in range(6):
                try:
                    service.authenticate(email, 'wrong password!!', client=f'ip-{email}')
                    row.append('ok')
                except auth.LoginFailed:
                    row.append('failed')
                except auth.LockedOut:
                    row.append('locked')
            outcomes.append(row)
        assert outcomes[0] == outcomes[1] == ['failed'] * 5 + ['locked']         # identical sequence: nothing reveals which emails exist
        for n in range(auth.CLIENT_FAILURE_LIMIT):                               # one address trying many accounts is throttled
            try:
                service.authenticate(f'user{n}@example.com', 'wrong password!!', client='198.51.100.9')
            except auth.LoginFailed:
                pass
        with pytest.raises(auth.LockedOut):
            service.authenticate('fresh@example.com', 'wrong password!!', client='198.51.100.9')
        seed(application, 'second@example.com', 'analyst')
        assert service.authenticate('second@example.com', PASSWORD, client='203.0.113.5')   # other addresses and accounts are unaffected
        clock.advance(seconds=auth.CLIENT_WINDOW_SECONDS + 1)
        with pytest.raises(auth.LoginFailed):
            service.authenticate('fresh@example.com', 'wrong password!!', client='198.51.100.9')


def test_an_unknown_email_costs_the_same_hashing_work_as_a_known_one(tmp_path, monkeypatch):
    application, service, _ = service_with_clock(tmp_path)
    with client(application):
        seed(application)
        seen = []
        real = auth.verify_password
        monkeypatch.setattr(auth, 'verify_password', lambda stored, password: seen.append(stored) or real(stored, password))
        for email in ('owner@example.com', 'nobody@example.com'):
            with pytest.raises(auth.LoginFailed):
                service.authenticate(email, 'wrong password!!')
        assert len(seen) == 2 and all(h.startswith('$argon2id$') for h in seen)      # both took a full Argon2id verification


# ---- start-up rules (fail closed) ---------------------------------------------------------------------------------
@pytest.mark.parametrize('env,fragment', [
    ({'AUTH_MODE': 'maybe'}, 'must be "off" or "on"'),
    ({'AUTH_MODE': 'off', 'APP_ENV': 'production'}, 'APP_ENV=production'),
    ({'AUTH_MODE': 'off', 'INSIGHTIQ_BIND_HOST': '0.0.0.0'}, 'loopback'),
    ({'AUTH_MODE': 'off', 'INSIGHTIQ_BIND_HOST': '192.168.1.20'}, 'loopback'),
    ({'AUTH_MODE': 'off', 'INSIGHTIQ_BIND_HOST': 'example.com'}, 'loopback'),
    ({'AUTH_MODE': 'on', 'APP_ENV': 'production', 'AUTH_COOKIE_SECURE': 'false'}, 'AUTH_COOKIE_SECURE'),
    ({'AUTH_MODE': 'on', 'AUTH_COOKIE_SECURE': 'sometimes'}, 'true or false'),
    ({'AUTH_MODE': 'on', 'AUTH_IDLE_SECONDS': 'abc'}, 'whole number'),
    ({'AUTH_MODE': 'on', 'AUTH_IDLE_SECONDS': '999999', 'AUTH_ABSOLUTE_SECONDS': '600'}, 'must not exceed'),
])
def test_unsafe_or_invalid_settings_refuse_to_start(env, fragment):
    with pytest.raises(auth.ConfigError, match=fragment):
        auth.AuthConfig.from_env(env).check()


@pytest.mark.parametrize('env', [
    {}, {'AUTH_MODE': 'off'}, {'AUTH_MODE': 'off', 'INSIGHTIQ_BIND_HOST': '127.0.0.1'}, {'AUTH_MODE': 'off', 'INSIGHTIQ_BIND_HOST': 'localhost'},
    {'AUTH_MODE': 'off', 'INSIGHTIQ_BIND_HOST': '::1'}, {'AUTH_MODE': 'on', 'INSIGHTIQ_BIND_HOST': '0.0.0.0'},      # A5: the complete production settings are tested in test_hosted_a5.py
    {'AUTH_MODE': 'on', 'AUTH_COOKIE_SECURE': 'false'},
])
def test_safe_settings_start(env):
    auth.AuthConfig.from_env(env).check()


def test_the_default_is_local_mode_and_the_app_itself_refuses_unsafe_settings(tmp_path, monkeypatch):
    assert auth.AuthConfig.from_env({}).mode == 'off'
    monkeypatch.setenv('AUTH_MODE', 'off')
    monkeypatch.setenv('APP_ENV', 'production')
    with pytest.raises(auth.ConfigError):
        create_app(tmp_path)                       # starting uvicorn directly with unsafe settings also stops
    monkeypatch.setenv('APP_ENV', 'development')
    monkeypatch.setenv('INSIGHTIQ_BIND_HOST', '0.0.0.0')
    with pytest.raises(auth.ConfigError):
        create_app(tmp_path)


def test_the_launcher_refuses_before_starting_the_server(monkeypatch, capsys):
    from app import serve
    started = []
    for key in ('AUTH_MODE', 'APP_ENV', 'INSIGHTIQ_BIND_HOST'):
        monkeypatch.setenv(key, '')          # registers the variable so the launcher's own os.environ write is undone at teardown
    assert serve.main(['--host', '0.0.0.0', '--port', '9'], run=lambda *a, **k: started.append((a, k))) == 2
    assert 'loopback' in capsys.readouterr().err and started == []
    monkeypatch.setenv('INSIGHTIQ_BIND_HOST', '')
    assert serve.main(['--host', '127.0.0.1', '--port', '9'], run=lambda *a, **k: started.append((a, k))) == 0 and len(started) == 1
    monkeypatch.setenv('AUTH_MODE', 'on')
    assert serve.main(['--host', '0.0.0.0', '--port', '9'], run=lambda *a, **k: started.append((a, k))) == 0     # login on: any address is allowed


# ---- the access middleware ----------------------------------------------------------------------------------------
def test_local_mode_is_unchanged_and_says_login_is_off(tmp_path):
    with TestClient(make_app(tmp_path)) as c:
        assert c.get('/api/datasets').status_code == 200
        assert c.get('/api/auth/status').json() == {'mode': 'off', 'login_required': False, 'user': None}   # A3: `user` added
        assert c.post('/api/auth/login', json={'email': 'a@b.co', 'password': 'x' * 14}).status_code == 409
        assert c.get('/api/auth/me').status_code == 409 and c.post('/api/auth/logout').status_code == 409
        assert 'set-cookie' not in c.get('/api/health').headers and 'x-frame-options' not in c.get('/api/health').headers


def test_with_login_on_only_the_public_routes_work_without_a_session_and_every_other_route_is_refused(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        assert c.get('/api/health').status_code == 200
        assert c.get('/api/auth/status').json() == {'mode': 'on', 'login_required': True, 'user': None}   # A3: `user` added
        assert login(c, 'nobody@example.com', PASSWORD).status_code == 401
        refused = []
        for route in ROUTE_SCOPES:
            method, path = route.split(' ', 1)
            if (method, path) in auth.PUBLIC_ROUTES:
                continue
            path = path.replace('{dataset_id}', '0' * 8 + '-0000-0000-0000-' + '0' * 12).replace('{identifier}', 'default')
            path = path.replace('{case_id}', 'q01').replace('{revision}', '1').replace('{dashboard}', '0' * 8 + '-0000-0000-0000-' + '0' * 12)
            import re
            path = re.sub(r'\{[a-z_]+\}', '0' * 8 + '-0000-0000-0000-' + '0' * 12, path)
            response = c.request(method, path, json={} if method != 'GET' else None, headers=ORIGIN)
            if response.status_code != 401:
                refused.append((route, response.status_code))
        assert refused == [], f'routes reachable without a session: {refused}'
        for extra in ('/docs', '/openapi.json', '/redoc', '/nope'):
            assert c.get(extra).status_code == 401                              # default deny, including unknown paths and the API docs


def test_every_route_is_either_public_or_needs_a_session_and_nothing_else_is_public(tmp_path):
    # A4 added ('POST', '/api/auth/redeem') knowingly: redeeming a one-time link happens before there is a session.
    assert auth.PUBLIC_ROUTES == {('GET', '/api/health'), ('GET', '/api/auth/status'), ('POST', '/api/auth/login'), ('POST', '/api/auth/redeem')}
    known = set(ROUTE_SCOPES)
    assert {f'{m} {p}' for m, p in auth.PUBLIC_ROUTES} <= known


def test_sign_in_sets_a_secure_httponly_samesite_cookie_and_the_session_opens_the_api(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        response = login(c)
        assert response.status_code == 200
        profile = response.json()
        assert profile['email'] == 'owner@example.com' and profile['role'] == 'owner' and profile['company'] == 'Acme'
        assert 'password_hash' not in profile and 'argon2' not in str(profile) and PASSWORD not in str(profile)
        cookie = response.headers['set-cookie']
        lowered = cookie.lower()
        assert 'httponly' in lowered and 'secure' in lowered and 'samesite=lax' in lowered and 'path=/' in lowered and cookie.startswith('insightiq_session=')
        assert c.get('/api/datasets').status_code == 200
        assert c.get('/api/auth/me').json()['email'] == 'owner@example.com'
        sent = c.get('/api/health')
        assert sent.headers['cache-control'] == 'private, no-store' and sent.headers['x-content-type-options'] == 'nosniff' and sent.headers['x-frame-options'] == 'DENY'


def test_wrong_password_and_unknown_email_get_the_same_answer_and_a_locked_account_gets_429(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        wrong = login(c, password='wrong password!!')
        unknown = login(c, 'nobody@example.com', 'wrong password!!')
        assert wrong.status_code == unknown.status_code == 401 and wrong.json() == unknown.json()
        assert 'set-cookie' not in wrong.headers
        for _ in range(4):
            login(c, password='wrong password!!')
        locked = login(c, password=PASSWORD)
        assert locked.status_code == 429 and int(locked.headers['retry-after']) >= 1
        assert 'set-cookie' not in locked.headers


def test_logout_ends_the_session_everywhere_and_each_sign_in_issues_a_new_one(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        login(c)
        first = c.cookies.get('insightiq_session')
        login(c)
        second = c.cookies.get('insightiq_session')
        assert first != second
        stale = client(application)
        stale.cookies.set('insightiq_session', first, domain='testserver.local')
        assert c.get('/api/auth/me').status_code == 200
        assert application.state.auth.resolve_session(first) is None             # signing in again revoked the previous session
        assert c.post('/api/auth/logout', headers=ORIGIN).status_code == 200
        assert application.state.auth.resolve_session(second) is None
        assert c.get('/api/datasets').status_code == 401


def test_a_session_cookie_that_was_forged_or_revoked_gets_nothing(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        c.cookies.set('insightiq_session', 'forged-token-value')
        assert c.get('/api/datasets').status_code == 401
        c.cookies.clear()
        login(c)
        token = c.cookies.get('insightiq_session')
        application.state.auth.revoke_session(token)
        assert c.get('/api/datasets').status_code == 401


def test_a_user_deactivated_mid_session_is_refused_on_the_next_request(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        uid = seed(application)
        login(c)
        assert c.get('/api/datasets').status_code == 200
        application.state.auth.set_active(uid, False)
        assert c.get('/api/datasets').status_code == 401


def test_cross_origin_state_changing_requests_are_refused_even_with_a_valid_session(tmp_path):
    application = make(tmp_path)
    with client(application) as c:
        seed(application)
        login(c)
        body = {'file': ('orders.csv', CSV, 'text/csv')}
        assert c.post('/api/datasets', files=body, headers={'origin': 'https://evil.example'}).status_code == 403
        assert c.post('/api/datasets', files=body, headers={'origin': 'null'}).status_code == 403
        assert c.post('/api/datasets', files=body).status_code == 403                                   # neither Origin nor Referer
        assert c.post('/api/datasets', files=body, headers={'referer': 'https://evil.example/page'}).status_code == 403
        assert c.get('/api/datasets').json() == []                                                      # nothing was created
        assert c.post('/api/datasets', files=body, headers={'referer': 'https://testserver/app'}).status_code == 201
        assert c.post('/api/datasets', files=body, headers=ORIGIN).status_code == 201
        assert c.get('/api/datasets', headers={'origin': 'https://evil.example'}).status_code == 200    # reads are not state-changing
        assert c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD}, headers={'origin': 'https://evil.example'}).status_code == 403
    configured = make(tmp_path / 'other', on(allowed_origins=('https://app.example.com',)))
    with client(configured) as c:
        seed(configured)
        login(c)
        assert c.post('/api/datasets', files={'file': ('orders.csv', CSV, 'text/csv')}, headers={'origin': 'https://app.example.com'}).status_code == 201


def test_roles_are_enforced_from_a2_so_a_viewer_no_longer_reaches_analyst_routes(tmp_path):
    """Changed knowingly in A2: in A1 this test pinned that NO role was enforced (a viewer could call any route).
    From A2 a viewer is refused on analyst routes; the full matrix is in test_accounts_a2_access.py."""
    application = make(tmp_path)
    with client(application) as c:
        seed(application, 'viewer@example.com', 'viewer')
        login(c, 'viewer@example.com')
        assert c.get('/api/auth/me').json()['role'] == 'viewer'
        refused = c.get('/api/datasets')
        assert refused.status_code == 403 and refused.json() == {'detail': 'Your role does not allow this.'}


# ---- operator tool ------------------------------------------------------------------------------------------------
def cli(args, typed=(PASSWORD, PASSWORD)):
    answers = iter(typed)
    return accounts_cli.main(args, prompt=lambda _text: next(answers), require_tty=False)


def workspace(tmp_path, with_data=False):
    with TestClient(make_app(tmp_path)) as c:
        if with_data:
            c.post('/api/datasets', files={'file': ('orders.csv', CSV, 'text/csv')})
    return tmp_path


def test_the_operator_tool_creates_the_company_and_first_owner_without_touching_existing_rows(tmp_path):
    root = workspace(tmp_path)
    assert cli(['create-company', '--data-dir', str(root), '--name', 'Acme Ltd', '--owner-email', 'Owner@Example.com', '--owner-name', 'Ola']) == 0
    engine = create_engine(f'sqlite:///{root / "catalog.sqlite"}')
    base = declarative_base()
    models = auth.register(base)
    service = auth.AuthService(engine, models, on())
    with Session(engine) as s:
        company, user = service.company(s), s.scalars(select(models.User)).one()
        assert company.name == 'Acme Ltd' and user.email == 'owner@example.com' and user.role == 'owner' and user.company_id == company.id
        assert user.must_change_password is True and user.password_hash.startswith('$argon2id$') and PASSWORD not in user.password_hash
    assert service.authenticate('owner@example.com', PASSWORD)
    # a second company is refused: one workspace, one company
    with pytest.raises(SystemExit) as refused:
        cli(['create-company', '--data-dir', str(root), '--name', 'Second', '--owner-email', 'b@example.com'])
    assert 'already has a company' in str(refused.value)


def test_the_operator_tool_never_accepts_a_password_as_an_argument_a_pipe_or_a_weak_or_mismatched_one(tmp_path):
    root = workspace(tmp_path)
    base = ['create-company', '--data-dir', str(root), '--name', 'Acme', '--owner-email', 'owner@example.com']
    with pytest.raises(SystemExit):
        accounts_cli.main(base + ['--password', PASSWORD], prompt=lambda _t: PASSWORD, require_tty=False)       # no such argument
    with pytest.raises(SystemExit) as piped:
        accounts_cli.main(base, prompt=lambda _t: PASSWORD, require_tty=True)                                   # stdin is not a terminal under pytest
    assert 'typed at a terminal' in str(piped.value)
    with pytest.raises(SystemExit) as differ:
        cli(base, typed=(PASSWORD, PASSWORD + 'x'))
    assert 'differ' in str(differ.value)
    with pytest.raises(SystemExit) as weak:
        cli(base, typed=('short', 'short'))
    assert 'Password refused' in str(weak.value)
    with sqlite3.connect(root / 'catalog.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM companies').fetchone()[0] == 0 and db.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0


def test_the_operator_tool_needs_your_backup_on_a_workspace_that_holds_data_and_supports_a_dry_run(tmp_path):
    root = workspace(tmp_path, with_data=True)
    base = ['create-company', '--data-dir', str(root), '--name', 'Acme', '--owner-email', 'owner@example.com']
    with pytest.raises(SystemExit) as no_backup:
        cli(base)
    assert '--backup' in str(no_backup.value)
    backup = tmp_path.parent / (tmp_path.name + '-backup')
    backup.mkdir()
    with pytest.raises(SystemExit):
        cli(base + ['--backup', str(backup)])                                      # an empty folder is not a backup
    shutil.copy(root / 'catalog.sqlite', backup / 'catalog-consistent.sqlite')
    with sqlite3.connect(root / 'catalog.sqlite') as db:
        before = [db.execute(f'SELECT * FROM {t}').fetchall() for t in ('datasets', 'projects', 'schema_migrations')]
    assert cli(base + ['--backup', str(backup), '--dry-run'], typed=()) == 0
    with sqlite3.connect(root / 'catalog.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM companies').fetchone()[0] == 0
    assert cli(base + ['--backup', str(backup)]) == 0
    with sqlite3.connect(root / 'catalog.sqlite') as db:
        after = [db.execute(f'SELECT * FROM {t}').fetchall() for t in ('datasets', 'projects', 'schema_migrations')]
    assert after == before                                                          # existing rows are byte-for-byte what they were


def test_the_operator_tool_refuses_a_folder_that_is_not_a_workspace(tmp_path):
    with pytest.raises(SystemExit) as nothing:
        cli(['create-company', '--data-dir', str(tmp_path), '--name', 'Acme', '--owner-email', 'o@example.com'])
    assert 'No catalog' in str(nothing.value)


def test_an_owner_made_by_the_tool_can_sign_in_over_http_and_must_change_the_password(tmp_path):
    root = workspace(tmp_path)
    cli(['create-company', '--data-dir', str(root), '--name', 'Acme', '--owner-email', 'owner@example.com'])
    application = make(root)
    with client(application) as c:
        response = login(c)
        assert response.status_code == 200 and response.json()['must_change_password'] is True
