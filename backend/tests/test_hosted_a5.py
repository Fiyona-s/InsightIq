"""Accounts stage A5 (backend part): hosted-mode settings that must stop the app, the trusted proxy, and the pinned password hashing.
Controlled fixtures only; no live AI. Nothing here claims data is separate or protected; it proves the rules listed."""
import pytest
from cryptography.fernet import Fernet
from starlette.requests import Request

from app import auth
from tests.test_accounts_a1 import ORIGIN, PASSWORD, client, make, on, seed

KEY = Fernet.generate_key().decode()
ORIGIN_PUBLIC = 'https://company.example'
PROXY = '172.28.0.2'


@pytest.fixture
def key_file(tmp_path):
    path = tmp_path / 'totp_key'
    path.write_text(KEY + '\n')
    return str(path)


def prod():
    return on(app_env='production', allowed_origins=(ORIGIN_PUBLIC,), trusted_proxies=(PROXY + '/32',), owner_totp=True, totp_key=KEY, totp_key_from_file=True)


def hosted_env(key_file, **over):
    env = {'AUTH_MODE': 'on', 'APP_ENV': 'production', 'INSIGHTIQ_BIND_HOST': '0.0.0.0', 'AUTH_ALLOWED_ORIGINS': ORIGIN_PUBLIC,
           'AUTH_TOTP_KEY_FILE': key_file, 'AUTH_TRUSTED_PROXIES': PROXY + '/32'}
    env.update(over)
    return {k: v for k, v in env.items() if v is not None}


def test_the_complete_hosted_settings_start(key_file):
    config = auth.AuthConfig.from_env(hosted_env(key_file)).check()
    assert config.on and config.totp_key == KEY and config.totp_key_from_file and config.allowed_origins == (ORIGIN_PUBLIC,)


@pytest.mark.parametrize('over,fragment', [
    ({'AUTH_ALLOWED_ORIGINS': None}, 'AUTH_ALLOWED_ORIGINS must name the public address'),
    ({'AUTH_ALLOWED_ORIGINS': 'http://company.example'}, 'exact https'),
    ({'AUTH_ALLOWED_ORIGINS': 'https://*.example'}, 'exact https'),
    ({'AUTH_ALLOWED_ORIGINS': 'https://company.example/app'}, 'exact https'),
    ({'AUTH_TOTP_KEY_FILE': None}, 'AUTH_TOTP_KEY is not set'),
    ({'AUTH_TOTP_KEY_FILE': None, 'AUTH_TOTP_KEY': KEY}, 'secret file'),
    ({'AUTH_TOTP_KEY': KEY}, 'not both'),
    ({'AUTH_TOTP_KEY_FILE': '/nonexistent/key'}, 'cannot be read'),
    ({'AUTH_TRUSTED_PROXIES': None}, 'AUTH_TRUSTED_PROXIES must name the reverse proxy'),
    ({'AUTH_TRUSTED_PROXIES': '0.0.0.0/0'}, 'every address'),
    ({'AUTH_TRUSTED_PROXIES': '::/0'}, 'every address'),
    ({'AUTH_TRUSTED_PROXIES': 'caddy'}, 'not an address or network'),
    ({'AUTH_COOKIE_SECURE': 'false'}, 'AUTH_COOKIE_SECURE'),
    ({'AUTH_OWNER_TOTP': 'false'}, 'second step'),
    ({'AUTH_MODE': 'off'}, 'APP_ENV=production'),
])
def test_hosted_mode_refuses_to_start_when_a_setting_is_missing_or_unsafe(key_file, over, fragment):
    with pytest.raises(auth.ConfigError, match=fragment):
        auth.AuthConfig.from_env(hosted_env(key_file, **over)).check()


def test_the_key_file_content_must_be_a_real_key(tmp_path, key_file):
    bad = tmp_path / 'bad'
    bad.write_text('not a key')
    with pytest.raises(auth.ConfigError, match='not a valid key'):
        auth.AuthConfig.from_env(hosted_env(str(bad))).check()


def test_the_app_itself_refuses_incomplete_hosted_settings(tmp_path, monkeypatch, key_file):
    from app.main import create_app
    for k, v in hosted_env(key_file, AUTH_TRUSTED_PROXIES=None).items():
        monkeypatch.setenv(k, v)
    with pytest.raises(auth.ConfigError, match='AUTH_TRUSTED_PROXIES'):
        create_app(tmp_path)


def test_development_settings_are_not_made_stricter(key_file):
    auth.AuthConfig.from_env({'AUTH_MODE': 'on', 'AUTH_COOKIE_SECURE': 'false'}).check()      # as before: no origins or proxy needed
    auth.AuthConfig.from_env({}).check()


# ---- the public address, not the proxy's Host header ----------------------------------------------------------------
def test_in_hosted_mode_only_the_stated_public_address_passes_the_origin_check(tmp_path, key_file):
    application = make(tmp_path, prod())
    with client(application):
        seed(application, role='analyst')
    with client(application, headers={'host': 'testserver'}) as c:
        assert c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD}, headers={'origin': 'https://testserver'}).status_code == 403    # Host fallback is off
        assert c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD}, headers={'origin': 'https://evil.example'}).status_code == 403
        assert c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD}, headers={'origin': ORIGIN_PUBLIC}).status_code == 200


# ---- trusted proxy ----------------------------------------------------------------------------------------------------
def request_from(peer, forwarded=(), proxies=(PROXY + '/32',)):
    headers = [(b'x-forwarded-for', f.encode()) for f in forwarded]
    scope = {'type': 'http', 'method': 'GET', 'path': '/', 'headers': headers, 'client': (peer, 40000), 'query_string': b''}
    return Request(scope), auth.AuthConfig(mode='on', trusted_proxies=tuple(proxies))


@pytest.mark.parametrize('peer,forwarded,expected', [
    ('203.0.113.9', ['198.51.100.7'], '203.0.113.9'),                          # a spoofed header from anyone but the proxy is ignored
    ('172.28.0.9', ['198.51.100.7'], '172.28.0.9'),                            # another address on the same network is not the proxy
    (PROXY, ['198.51.100.7'], '198.51.100.7'),                                 # the proxy: use the header
    (PROXY, [], PROXY),                                                        # the proxy without a header
    (PROXY, ['6.6.6.6, 198.51.100.7'], '198.51.100.7'),                        # a client-supplied first hop is not believed: right-most untrusted hop wins
    (PROXY, ['6.6.6.6', '198.51.100.7'], '198.51.100.7'),                      # several header lines
    (PROXY, ['not-an-address'], PROXY),                                        # malformed: do not guess
    (PROXY, ['2001:db8::1'], '2001:db8::1'),
])
def test_the_forwarded_address_is_used_only_when_the_request_comes_from_the_proxy(peer, forwarded, expected):
    request, config = request_from(peer, forwarded)
    assert auth.client_address(request, config) == expected


def test_without_a_configured_proxy_the_header_is_never_read():
    request, config = request_from(PROXY, ['198.51.100.7'], proxies=())
    assert auth.client_address(request, config) == PROXY


def test_a_chain_of_trusted_proxies_is_walked_from_the_right():
    request, config = request_from(PROXY, ['198.51.100.7, 172.28.0.77'], proxies=('172.28.0.0/24',))
    assert auth.client_address(request, config) == '198.51.100.7'


def test_two_clients_behind_the_proxy_are_throttled_separately_and_a_spoofed_header_does_not_help(tmp_path):
    application = make(tmp_path, prod())
    with client(application):
        seed(application, role='analyst')
    headers = {'origin': ORIGIN_PUBLIC}

    def attempt(peer, forwarded, email):
        extra = {'x-forwarded-for': forwarded} if forwarded else {}
        with client(application, client=(peer, 50000)) as c:
            return c.post('/api/auth/login', json={'email': email, 'password': 'wrong password!!'}, headers={**headers, **extra}).status_code
    # one real client (via the proxy) fails many times with different emails, so only the per-address limit can stop it
    codes = [attempt(PROXY, '198.51.100.7', f'nobody{i}@example.com') for i in range(auth.CLIENT_FAILURE_LIMIT + 2)]
    assert codes[0] == 401 and codes[-1] == 429
    assert attempt(PROXY, '198.51.100.8', 'nobody@example.com') == 401                   # a second client behind the same proxy is not affected
    # a non-proxy source cannot pick which address it is counted as
    for i in range(auth.CLIENT_FAILURE_LIMIT + 2):
        last = attempt('203.0.113.9', f'198.51.100.{100 + i}', f'other{i}@example.com')
    assert last == 429                                                                    # every spoofed value was counted as 203.0.113.9
    assert attempt('203.0.113.10', '198.51.100.7', 'nobody@example.com') == 401           # and 198.51.100.7's earlier lock is not applied to it


def test_the_audit_log_records_the_real_client_address(tmp_path):
    application = make(tmp_path, prod())
    with client(application):
        seed(application, role='analyst')
    with client(application, client=(PROXY, 50000)) as c:
        c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': 'wrong password!!'}, headers={'origin': ORIGIN_PUBLIC, 'x-forwarded-for': '198.51.100.7'})
    from sqlalchemy.orm import Session
    from sqlalchemy import select
    service = application.state.auth
    with Session(service.engine) as s:
        rows = s.scalars(select(service.m.AuditEvent).where(service.m.AuditEvent.event == 'sign_in_failed')).all()
    assert [r.client for r in rows] == ['198.51.100.7']


# ---- password hashing parameters ----------------------------------------------------------------------------------------
def test_the_production_password_hashing_parameters_are_pinned():
    hasher = auth._HASHER
    assert (hasher.type, hasher.memory_cost, hasher.time_cost, hasher.parallelism) == (auth.Type.ID, 19456, 2, 1)       # 19 MiB, 2 passes, 1 lane
    assert hasher.hash('a password') .startswith('$argon2id$v=19$m=19456,t=2,p=1$')


def test_the_launcher_does_not_let_the_server_rewrite_client_addresses(monkeypatch):
    from app import serve
    started = []
    for key in ('AUTH_MODE', 'APP_ENV', 'INSIGHTIQ_BIND_HOST'):
        monkeypatch.setenv(key, '')
    monkeypatch.setenv('AUTH_MODE', 'off')
    assert serve.main(['--host', '127.0.0.1', '--port', '9'], run=lambda *a, **k: started.append(k)) == 0
    assert started[0]['proxy_headers'] is False
