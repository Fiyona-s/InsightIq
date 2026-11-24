"""Accounts stage A4: people, one-time links, owner two-step sign-in, security log, operator tool.
Controlled fixtures only; no live AI. These tests prove the rules below. They do not claim that data is separate or protected."""
import json
import shutil
import sqlite3
from datetime import timedelta

import pyotp
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import auth, people
from scripts import accounts_cli
from tests.test_accounts_a1 import Clock, ORIGIN, PASSWORD, client, login, make, on, seed
from tests.test_phase4 import make_app

KEY = Fernet.generate_key().decode()
NEW = 'my own long passphrase'
GENERIC = {'detail': 'This link cannot be used. Ask the owner for a new one.'}


def hosted(tmp_path, totp=False, **cfg):
    application = make(tmp_path, on(owner_totp=totp, totp_key=KEY if totp else '', **cfg))
    clock = Clock()
    application.state.auth.clock = clock
    return application, application.state.auth, clock


def owner_client(application, email='owner@example.com', code=None):
    seed(application, email, 'owner')
    c = client(application)
    response = c.post('/api/auth/login', json={'email': email, 'password': PASSWORD, **({'code': code} if code else {})}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return c


def invite(c, email='new@example.com', role='analyst', name='New Person'):
    response = c.post('/api/users', json={'email': email, 'display_name': name, 'role': role}, headers=ORIGIN)
    assert response.status_code == 201, response.text
    return response.json()


def redeem(application, token, password=NEW, client_host=None):
    c = client(application)
    return c.post('/api/auth/redeem', json={'token': token, 'new_password': password}, headers=ORIGIN)


def user_id(c, email):
    return next(u['id'] for u in c.get('/api/users').json() if u['email'] == email)


# ---- people ----------------------------------------------------------------------------------------------------------
def test_the_people_list_shows_the_people_and_never_a_password_hash_or_token(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        seed(application, 'viewer@example.com', 'viewer')
        listing = c.get('/api/users')
        assert listing.status_code == 200
        text = listing.text
        assert 'argon2' not in text and 'password_hash' not in text and PASSWORD not in text and 'token' not in text
        row = next(u for u in listing.json() if u['email'] == 'owner@example.com')
        assert set(row) == {'id', 'email', 'display_name', 'role', 'active', 'status', 'last_sign_in', 'locked_seconds', 'two_step'}
        assert row['role'] == 'owner' and row['active'] is True and row['status'] == 'Active' and row['last_sign_in']


def test_only_owners_may_see_or_change_people_or_read_the_log(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        for role in ('viewer', 'analyst'):
            seed(application, f'{role}@example.com', role)
    for role in ('viewer', 'analyst'):
        c = client(application)
        login(c, f'{role}@example.com')
        assert c.get('/api/users').status_code == 403 and c.get('/api/audit-events').status_code == 403
        assert c.post('/api/users', json={'email': 'x@example.com', 'role': 'viewer'}, headers=ORIGIN).status_code == 403
        assert c.patch(f'/api/users/{"0" * 8}-0000-0000-0000-{"0" * 12}', json={'role': 'owner'}, headers=ORIGIN).status_code == 403


def test_inviting_creates_a_person_nobody_can_sign_in_as_until_they_use_their_link(tmp_path):
    application, service, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        made = invite(c)
        assert made['user']['status'] == 'Invited' and made['user']['role'] == 'analyst' and len(made['token']) >= 40 and made['expires_hours'] == 24
        assert c.post('/api/users', json={'email': 'NEW@example.com', 'role': 'viewer'}, headers=ORIGIN).status_code == 409        # email is unique
        assert c.post('/api/users', json={'email': 'nope', 'role': 'viewer'}, headers=ORIGIN).status_code == 400
        assert c.post('/api/users', json={'email': 'a@example.com', 'role': 'admin'}, headers=ORIGIN).status_code == 400
        for guess in (PASSWORD, NEW, made['token'], ''):
            assert login(client(application), 'new@example.com', guess or 'x' * 14).status_code == 401
        with Session(service.engine) as s:                                                  # only a hash of the token exists
            rows = s.scalars(select(service.m.PasswordReset)).all()
            assert [r.id for r in rows] == [auth._digest(made['token'])] and made['token'] not in json.dumps([r.id for r in rows])


def test_a_link_sets_the_persons_own_password_once_and_the_owner_never_knows_it(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        made = invite(c)
        weak = redeem(application, made['token'], 'short')
        assert weak.status_code == 400 and 'at least 12' in weak.json()['detail']          # a weak password does not use the link up
        assert redeem(application, made['token']).json() == {'ok': True}
        person = client(application)
        assert login(person, 'new@example.com', NEW).status_code == 200
        assert person.get('/api/auth/me').json()['must_change_password'] is False
        assert redeem(application, made['token'], 'another long passphrase').status_code == 400       # works once
        assert c.get('/api/users').json()[-1]['status'] in {'Active', 'Invited'} and 'passphrase' not in c.get('/api/users').text


def test_invalid_used_and_expired_links_give_the_same_answer(tmp_path):
    application, _, clock = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        used = invite(c, 'used@example.com')['token']
        expired = invite(c, 'expired@example.com')['token']
        redeem(application, used)
        clock.advance(hours=24, seconds=1)
        answers = [redeem(application, t) for t in (used, expired, 'not-a-real-token', '')]
        assert [a.status_code for a in answers] == [400] * 4 and all(a.json() == GENERIC for a in answers)


def test_a_new_link_replaces_the_old_one_and_a_deactivated_person_has_no_working_link(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        first = invite(c)['token']
        uid = user_id(c, 'new@example.com')
        second = c.post(f'/api/users/{uid}/reset-link', headers=ORIGIN).json()['token']
        assert redeem(application, first).json() == GENERIC                                  # the old link stopped working
        c.patch(f'/api/users/{uid}', json={'active': False}, headers=ORIGIN)
        assert redeem(application, second).json() == GENERIC
        assert c.post(f'/api/users/{uid}/reset-link', headers=ORIGIN).status_code == 404


def test_redeeming_ends_the_persons_other_sessions(tmp_path):
    application, service, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        seed(application, 'someone@example.com', 'analyst')
        person = client(application)
        login(person, 'someone@example.com')
        assert person.get('/api/datasets').status_code == 200
        link = c.post(f'/api/users/{user_id(c, "someone@example.com")}/reset-link', headers=ORIGIN).json()['token']
        assert redeem(application, link).json() == {'ok': True}
        assert person.get('/api/datasets').status_code == 401                                 # the old session is gone
        assert login(client(application), 'someone@example.com', PASSWORD).status_code == 401   # and so is the old password


def test_redeeming_is_rate_limited_per_address(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        owner_client(application)
        codes = [redeem(application, f'guess-{n}').status_code for n in range(12)]
        assert codes[:10] == [400] * 10 and codes[10] == 429
        assert 'retry-after' in redeem(application, 'guess-x').headers


def test_the_last_active_owner_can_never_be_demoted_or_deactivated_and_nobody_deactivates_themselves(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        me = user_id(c, 'owner@example.com')
        for body in ({'role': 'analyst'}, {'active': False}, {'role': 'viewer', 'active': False}):
            r = c.patch(f'/api/users/{me}', json=body, headers=ORIGIN)
            assert r.status_code == 409, body
        assert c.get('/api/users').json()[0]['role'] == 'owner'
        second = invite(c, 'second@example.com', 'owner')['user']['id']
        assert c.patch(f'/api/users/{me}', json={'active': False}, headers=ORIGIN).json()['detail'] == 'You cannot deactivate yourself.'     # even with a second owner
        assert c.patch(f'/api/users/{second}', json={'role': 'analyst'}, headers=ORIGIN).status_code == 200                                   # another owner may be demoted
        assert c.patch(f'/api/users/{me}', json={'role': 'analyst'}, headers=ORIGIN).status_code == 409                                      # but not the last one again
        assert c.patch('/api/users/' + '0' * 8 + '-0000-0000-0000-' + '0' * 12, json={'role': 'viewer'}, headers=ORIGIN).status_code == 404


def test_deactivating_ends_sessions_at_once_and_a_demotion_applies_to_the_next_request(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        for email, role in (('a@example.com', 'analyst'), ('b@example.com', 'analyst')):
            seed(application, email, role)
        a, b = client(application), client(application)
        login(a, 'a@example.com'); login(b, 'b@example.com')
        assert a.get('/api/datasets').status_code == 200 and b.get('/api/datasets').status_code == 200
        c.patch(f'/api/users/{user_id(c, "a@example.com")}', json={'active': False}, headers=ORIGIN)
        assert a.get('/api/datasets').status_code == 401                                      # refused on the very next request
        assert login(client(application), 'a@example.com').status_code == 401
        c.patch(f'/api/users/{user_id(c, "b@example.com")}', json={'role': 'viewer'}, headers=ORIGIN)
        refused = b.get('/api/datasets')
        assert refused.status_code == 403 and refused.json() == {'detail': 'Your role does not allow this.'}
        c.patch(f'/api/users/{user_id(c, "a@example.com")}', json={'active': True}, headers=ORIGIN)
        assert login(client(application), 'a@example.com').status_code == 200                 # reactivated


def test_an_owner_can_unlock_a_locked_person(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        seed(application, 'locked@example.com', 'viewer')
        for _ in range(5):
            login(client(application), 'locked@example.com', 'wrong password!!')
        assert login(client(application), 'locked@example.com').status_code == 429
        row = next(u for u in c.get('/api/users').json() if u['email'] == 'locked@example.com')
        assert row['status'] == 'Locked' and row['locked_seconds'] > 0
        c.post(f'/api/users/{row["id"]}/unlock', headers=ORIGIN)
        assert login(client(application), 'locked@example.com').status_code == 200


def test_the_voluntary_password_change_is_open_to_every_role(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        for role in ('viewer', 'analyst', 'owner'):
            seed(application, f'{role}@example.com', role)
    for role in ('viewer', 'analyst', 'owner'):
        c = client(application)
        login(c, f'{role}@example.com')
        assert c.post('/api/auth/change-password', json={'current_password': PASSWORD, 'new_password': NEW}, headers=ORIGIN).status_code == 200


# ---- owner two-step sign-in -------------------------------------------------------------------------------------------
def enrol(application, clock, email='owner@example.com'):
    """Signs in (password only), enrols with a real code, returns (client, secret, recovery_codes)."""
    seed(application, email, 'owner')
    c = client(application)
    assert login(c, email).status_code == 200
    started = c.post('/api/auth/two-step/start', headers=ORIGIN).json()
    secret = started['secret']
    assert started['uri'].startswith('otpauth://totp/') and email.replace('@', '%40') in started['uri']
    clock.advance(seconds=31)
    confirmed = c.post('/api/auth/two-step/confirm', json={'code': pyotp.TOTP(secret).at(clock.now)}, headers=ORIGIN)
    assert confirmed.status_code == 200, confirmed.text
    return c, secret, confirmed.json()['recovery_codes']


def code_at(secret, clock, offset=0):
    return pyotp.TOTP(secret).at(clock.now + timedelta(seconds=30 * offset))


def test_an_owner_must_set_up_the_second_step_after_the_password_and_cannot_use_anything_else_until_then(tmp_path):
    application, _, clock = hosted(tmp_path, totp=True)
    with client(application):
        seed(application, 'owner@example.com', 'owner')
        c = client(application)
        assert login(c).status_code == 200 and c.get('/api/auth/me').json()['must_enrol_two_step'] is True
        gate = {'detail': 'Set up two-step sign-in before continuing.', 'code': 'two_step_enrolment_required'}
        for path in ('/api/datasets', '/api/users', '/api/dashboards', '/api/audit-events'):
            r = c.get(path)
            assert r.status_code == 403 and r.json() == gate, path
        secret = c.post('/api/auth/two-step/start', headers=ORIGIN).json()['secret']
        wrong = c.post('/api/auth/two-step/confirm', json={'code': '000000'}, headers=ORIGIN)
        assert wrong.status_code == 400
        clock.advance(seconds=31)
        done = c.post('/api/auth/two-step/confirm', json={'code': code_at(secret, clock)}, headers=ORIGIN)
        assert done.status_code == 200 and len(done.json()['recovery_codes']) == 8 and len(set(done.json()['recovery_codes'])) == 8
        assert c.get('/api/datasets').status_code == 200 and c.get('/api/auth/me').json()['must_enrol_two_step'] is False
        assert c.post('/api/auth/two-step/start', headers=ORIGIN).status_code == 409           # already set up: only the operator can reset it


def test_analysts_and_viewers_are_never_asked_for_the_second_step(tmp_path):
    application, _, _ = hosted(tmp_path, totp=True)
    with client(application):
        for role in ('analyst', 'viewer'):
            seed(application, f'{role}@example.com', role)
    for role in ('analyst', 'viewer'):
        c = client(application)
        response = login(c, f'{role}@example.com')
        assert response.status_code == 200 and response.json()['must_enrol_two_step'] is False
        assert c.post('/api/auth/two-step/start', headers=ORIGIN).status_code == 403


def test_an_enrolled_owner_needs_the_password_and_a_code_and_a_code_works_once(tmp_path):
    application, _, clock = hosted(tmp_path, totp=True)
    with client(application):
        _, secret, _ = enrol(application, clock)
        fresh = client(application)
        step = login(fresh)
        assert step.status_code == 200 and step.json() == {'two_step_required': True} and 'set-cookie' not in step.headers      # no session from the password alone
        assert fresh.get('/api/datasets').status_code == 401
        clock.advance(seconds=31)
        good = code_at(secret, clock)
        ok = client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': good}, headers=ORIGIN)
        assert ok.status_code == 200 and ok.json()['role'] == 'owner' and 'set-cookie' in ok.headers
        replay = client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': good}, headers=ORIGIN)
        assert replay.status_code == 401 and replay.json() == {'detail': 'Email or password incorrect.'}      # the same time step is refused
        clock.advance(seconds=30)
        again = client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': code_at(secret, clock)}, headers=ORIGIN)
        assert again.status_code == 200                                                                     # the next step is fine
        earlier = client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': good}, headers=ORIGIN)
        assert earlier.status_code == 401                                                                   # and an older step stays refused


def test_wrong_codes_count_toward_the_same_lockout_and_password_only_probes_do_not(tmp_path):
    application, _, clock = hosted(tmp_path, totp=True)
    with client(application):
        _, secret, _ = enrol(application, clock)
        for _ in range(8):                                                                                   # right password, no code: nothing is counted
            assert login(client(application)).json() == {'two_step_required': True}
        statuses = []
        for _ in range(6):
            r = client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': '123456'}, headers=ORIGIN)
            statuses.append(r.status_code)
        assert statuses == [401] * 5 + [429]                                                                 # five wrong codes lock the account
        clock.advance(seconds=61)
        good = client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': code_at(secret, clock)}, headers=ORIGIN)
        assert good.status_code == 200


def test_recovery_codes_work_once_each_are_stored_hashed_and_are_shown_only_when_made(tmp_path):
    application, service, clock = hosted(tmp_path, totp=True)
    with client(application):
        _, secret, codes = enrol(application, clock)
        with Session(service.engine) as s:
            stored = [r.code_hash for r in s.scalars(select(service.m.RecoveryCode))]
            assert len(stored) == 8 and not (set(stored) & set(c.replace('-', '') for c in codes)) and all(len(h) == 64 for h in stored)
            row = s.get(service.m.UserTotp, s.scalars(select(service.m.User.id)).first())
            assert secret not in row.secret_enc and Fernet(KEY.encode()).decrypt(row.secret_enc.encode()).decode() == secret      # encrypted at rest
        attempt = lambda code: client(application).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': code}, headers=ORIGIN)
        assert attempt(codes[0]).status_code == 200
        assert attempt(codes[0]).status_code == 401                                                          # a recovery code works once
        assert attempt(codes[1].upper()).status_code == 200                                                  # case does not matter
        assert attempt('aaaaa-bbbbb').status_code == 401
        with Session(service.engine) as s:
            events = [e.event for e in s.scalars(select(service.m.AuditEvent))]
        assert events.count('recovery_code_used') == 2


def test_if_the_key_is_missing_an_enrolled_owner_cannot_sign_in_and_is_told_why(tmp_path):
    application, _, clock = hosted(tmp_path, totp=True)
    with client(application):
        _, secret, _ = enrol(application, clock)
    keyless = make(tmp_path, on(owner_totp=True, totp_key=''))
    keyless.state.auth.clock = clock
    with client(keyless):
        r = client(keyless).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': code_at(secret, clock, 1)}, headers=ORIGIN)
        assert r.status_code == 503 and 'key is missing' in r.json()['detail']
        assert 'set-cookie' not in r.headers
    other = make(tmp_path, on(owner_totp=True, totp_key=Fernet.generate_key().decode()))       # a different key cannot read the secret either
    other.state.auth.clock = clock
    with client(other):
        r = client(other).post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': code_at(secret, clock, 1)}, headers=ORIGIN)
        assert r.status_code == 401


def test_without_a_key_nobody_can_start_enrolment_and_production_needs_the_key():
    with pytest.raises(auth.ConfigError, match='AUTH_TOTP_KEY'):
        auth.AuthConfig.from_env({'AUTH_MODE': 'on', 'APP_ENV': 'production'}).check()
    with pytest.raises(auth.ConfigError, match='not a valid key'):
        auth.AuthConfig.from_env({'AUTH_MODE': 'on', 'AUTH_TOTP_KEY': 'not-a-key'}).check()
    with pytest.raises(auth.ConfigError, match='second step'):
        auth.AuthConfig.from_env({'AUTH_MODE': 'on', 'APP_ENV': 'production', 'AUTH_OWNER_TOTP': 'false', 'AUTH_TOTP_KEY': KEY}).check()
    with pytest.raises(auth.ConfigError, match='AUTH_ALLOWED_ORIGINS'):      # A5: hosted mode needs more than a key; the complete settings start in test_hosted_a5.py
        auth.AuthConfig.from_env({'AUTH_MODE': 'on', 'APP_ENV': 'production', 'AUTH_TOTP_KEY': KEY}).check()
    assert 'AUTH_TOTP_KEY' not in repr(auth.AuthConfig.from_env({'AUTH_MODE': 'on', 'AUTH_TOTP_KEY': KEY}))


def test_the_enrolment_start_refuses_without_a_key(tmp_path):
    application = make(tmp_path, on(owner_totp=True, totp_key=''))
    with client(application):
        seed(application, 'owner@example.com', 'owner')
        c = client(application)
        login(c)
        r = c.post('/api/auth/two-step/start', headers=ORIGIN)
        assert r.status_code == 503 and 'key is missing' in r.json()['detail']


def test_wrong_enrolment_codes_are_limited(tmp_path):
    application, _, clock = hosted(tmp_path, totp=True)
    with client(application):
        seed(application, 'owner@example.com', 'owner')
        c = client(application)
        login(c)
        c.post('/api/auth/two-step/start', headers=ORIGIN)
        codes = [c.post('/api/auth/two-step/confirm', json={'code': '000000'}, headers=ORIGIN).status_code for _ in range(6)]
        assert codes == [400] * 5 + [429]


# ---- the security log -------------------------------------------------------------------------------------------------
def test_the_security_log_records_the_events_newest_first_and_never_a_secret(tmp_path):
    application, service, clock = hosted(tmp_path, totp=True)
    with client(application):
        owner, secret, codes = enrol(application, clock)
        made = invite(owner, 'new@example.com', 'analyst')
        uid = made['user']['id']
        redeem(application, made['token'])
        owner.patch(f'/api/users/{uid}', json={'role': 'viewer'}, headers=ORIGIN)
        owner.patch(f'/api/users/{uid}', json={'active': False}, headers=ORIGIN)
        owner.patch(f'/api/users/{uid}', json={'active': True}, headers=ORIGIN)
        owner.post(f'/api/users/{uid}/reset-link', headers=ORIGIN)
        owner.post(f'/api/users/{uid}/unlock', headers=ORIGIN)
        login(client(application), 'nobody@example.com', 'a password typed in the email box')
        login(client(application), 'new@example.com', 'wrong password!!')
        owner.post('/api/auth/change-password', json={'current_password': PASSWORD, 'new_password': NEW}, headers=ORIGIN)
        events = owner.get('/api/audit-events').json()['events']
        names = [e['event'] for e in events]
        for expected in ('two_step_enrolled', 'user_invited', 'reset_link_used', 'role_changed', 'user_deactivated', 'user_reactivated', 'reset_link_created',
                         'user_unlocked', 'sign_in_failed', 'password_changed', 'sign_in_ok'):
            assert expected in names, expected
        assert names[0] in {'password_changed', 'sign_in_ok'} and [e['id'] for e in events] == sorted([e['id'] for e in events], reverse=True)   # newest first
        failed = owner.get('/api/audit-events?failed_only=true').json()['events']
        assert failed and {e['event'] for e in failed} <= {'sign_in_failed', 'account_locked'}
        blob = json.dumps(events) + json.dumps(owner.get('/api/audit-events?limit=200').json())
        for secret_text in (PASSWORD, NEW, secret, made['token'], 'a password typed in the email box', 'argon2', *codes, *(c.replace('-', '') for c in codes)):
            assert secret_text not in blob, secret_text
        assert any(e['event'] == 'sign_in_failed' and e['target'] is None and e['actor'] == 'unknown' for e in events)      # an unknown email is not stored
        with Session(service.engine) as s:
            rows = [vars(r) for r in s.scalars(select(service.m.AuditEvent))]
        assert all(len(str(r.get('detail') or '')) <= 200 for r in rows)


def test_the_log_is_append_only_no_route_changes_it_and_the_database_refuses_changes(tmp_path):
    application, service, _ = hosted(tmp_path)
    from app.projects import ROUTE_ACCESS
    assert [k for k in ROUTE_ACCESS if 'audit' in k] == ['GET /api/audit-events']                   # reading only: no update or delete route exists
    with client(application):
        c = owner_client(application)
        assert c.put('/api/audit-events', json={}, headers=ORIGIN).status_code in {404, 405}
        assert c.delete('/api/audit-events', headers=ORIGIN).status_code in {404, 405}
    with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM audit_events').fetchone()[0] > 0
        with pytest.raises(sqlite3.DatabaseError, match='append-only'):
            db.execute("UPDATE audit_events SET event='x'")
        with pytest.raises(sqlite3.DatabaseError, match='append-only'):
            db.execute('DELETE FROM audit_events')


def test_sign_in_sign_out_and_lock_are_recorded(tmp_path):
    application, service, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        seed(application, 'x@example.com', 'viewer')
        for _ in range(5):
            login(client(application), 'x@example.com', 'wrong password!!')
        c.post('/api/auth/logout', headers=ORIGIN)
        with Session(service.engine) as s:
            events = [(e.event, e.actor_label) for e in s.scalars(select(service.m.AuditEvent))]
        assert ('sign_out', 'owner@example.com') in events and ('account_locked', 'x@example.com') in events
        assert events.count(('sign_in_failed', 'x@example.com')) == 5


def test_the_log_pages_with_before(tmp_path):
    application, _, _ = hosted(tmp_path)
    with client(application):
        c = owner_client(application)
        for n in range(5):
            login(client(application), f'nobody{n}@example.com', 'wrong password!!')
        first = c.get('/api/audit-events?limit=3').json()
        assert len(first['events']) == 3 and first['next_before']
        second = c.get(f'/api/audit-events?limit=3&before={first["next_before"]}').json()
        assert second['events'] and second['events'][0]['id'] < first['events'][-1]['id']


# ---- another company's instance -----------------------------------------------------------------------------------------
def test_one_companys_owner_cannot_touch_another_companys_people_or_log(tmp_path):
    a, _, _ = hosted(tmp_path / 'a')
    b, _, _ = hosted(tmp_path / 'b')
    with client(a):
        ca = owner_client(a)
    with client(b):
        cb = owner_client(b)
        invite(cb, 'only-b@example.com')
    token = ca.cookies.get('insightiq_session')
    stolen = client(b)
    stolen.cookies.set('insightiq_session', token, domain='testserver.local')
    assert stolen.get('/api/users').status_code == 401 and stolen.get('/api/audit-events').status_code == 401
    assert stolen.post('/api/users', json={'email': 'x@example.com', 'role': 'owner'}, headers=ORIGIN).status_code == 401
    assert 'only-b@example.com' in cb.get('/api/users').text and 'only-b@example.com' not in ca.get('/api/users').text


def test_local_mode_has_none_of_this_the_new_routes_say_login_is_off(tmp_path):
    from fastapi.testclient import TestClient
    with TestClient(make_app(tmp_path)) as c:
        for method, path, body in (('GET', '/api/users', None), ('POST', '/api/users', {'email': 'a@b.co', 'role': 'viewer'}), ('GET', '/api/audit-events', None),
                                   ('POST', '/api/auth/redeem', {'token': 'x', 'new_password': 'y' * 14}), ('POST', '/api/auth/two-step/start', None)):
            assert c.request(method, path, json=body).status_code == 409, path


def test_migrations_16_and_17_create_their_tables_after_backups_and_the_triggers(tmp_path):
    with __import__('fastapi.testclient', fromlist=['TestClient']).TestClient(make_app(tmp_path)) as c:
        c.post('/api/datasets', files={'file': ('o.csv', 'a,b\n1,2\n', 'text/csv')})
    catalog = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(catalog) as db:
        for t in ('recovery_codes', 'user_totp', 'audit_events'):
            db.execute(f'DROP TABLE {t}')
        db.execute('DELETE FROM schema_migrations WHERE version IN (16, 17)')
    shutil.rmtree(tmp_path / 'backups', ignore_errors=True)
    with __import__('fastapi.testclient', fromlist=['TestClient']).TestClient(make_app(tmp_path)):
        pass
    with sqlite3.connect(catalog) as db:
        assert [r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')] == list(range(1, 18))
        assert {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")} >= {'audit_events_no_update', 'audit_events_no_delete'}
    for label, names in (('v16', auth.V16_TABLES), ('v17', auth.V17_TABLES)):
        backup = sorted((tmp_path / 'backups').glob(f'accounts-{label}-*'))
        assert len(backup) == 1
        with sqlite3.connect(backup[0] / 'catalog.sqlite') as db:
            assert not (set(names) & {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")})


# ---- operator tool ----------------------------------------------------------------------------------------------------
def cli_workspace(tmp_path, with_data=False):
    from fastapi.testclient import TestClient
    with TestClient(make_app(tmp_path)) as c:
        if with_data:
            c.post('/api/datasets', files={'file': ('o.csv', 'a,b\n1,2\n', 'text/csv')})
    answers = iter([PASSWORD, PASSWORD])
    accounts_cli.main(['create-company', '--data-dir', str(tmp_path), '--name', 'Acme', '--owner-email', 'owner@example.com'] +
                      (['--backup', str(_backup(tmp_path))] if with_data else []), prompt=lambda _t: next(answers), require_tty=False)
    return tmp_path


def _backup(root):
    folder = root.parent / (root.name + '-bk')
    folder.mkdir(exist_ok=True)
    shutil.copy(root / 'catalog.sqlite', folder / 'catalog-consistent.sqlite')
    return folder


def test_the_operator_tool_unlocks_resets_the_second_step_and_makes_links_and_records_each(tmp_path):
    root = cli_workspace(tmp_path)
    application = make(root, on(owner_totp=True, totp_key=KEY))
    clock = Clock()
    application.state.auth.clock = clock
    service = application.state.auth
    with client(application):
        owner = client(application)
        assert owner.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD}, headers=ORIGIN).status_code == 200
        # the first sign-in after the tool made the owner: a password change is required first
        assert owner.get('/api/auth/me').json()['must_change_password'] is True
    with Session(service.engine) as s:
        uid = s.scalars(select(service.m.User.id)).first()
    service.set_password(uid, NEW)
    # lock, then unlock with the tool
    for _ in range(5):
        service.clock = clock
        with pytest.raises(auth.LoginFailed):
            service.authenticate('owner@example.com', 'wrong password!!')
    with pytest.raises(auth.LockedOut):
        service.authenticate('owner@example.com', NEW)
    assert accounts_cli.main(['unlock', '--data-dir', str(root), '--email', 'owner@example.com']) == 0
    # enrol, then reset the second step with the tool
    with client(application):
        c = client(application)
        c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': NEW}, headers=ORIGIN)
        secret = c.post('/api/auth/two-step/start', headers=ORIGIN).json()['secret']
        clock.advance(seconds=31)
        assert c.post('/api/auth/two-step/confirm', json={'code': code_at(secret, clock)}, headers=ORIGIN).status_code == 200
    assert accounts_cli.main(['reset-2fa', '--data-dir', str(root), '--email', 'owner@example.com']) == 0
    with client(application):
        again = client(application)
        again.post('/api/auth/login', json={'email': 'owner@example.com', 'password': NEW}, headers=ORIGIN)
        assert again.get('/api/auth/me').json()['must_enrol_two_step'] is True                   # they enrol again
        assert c.get('/api/datasets').status_code == 401                                         # the old session was ended by the reset
    # a one-time link from the tool works through the public route
    import contextlib, io
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert accounts_cli.main(['reset-link', '--data-dir', str(root), '--email', 'owner@example.com']) == 0
    token = out.getvalue().split('#accept=')[1].split()[0]
    with client(application):
        assert redeem(application, token).json() == {'ok': True}
    with Session(service.engine) as s:
        events = [(e.event, e.actor_label) for e in s.scalars(select(service.m.AuditEvent))]
    for expected in (('company_created', 'operator'), ('user_unlocked', 'operator'), ('two_step_reset', 'operator'), ('reset_link_created', 'operator')):
        assert expected in events, expected


def test_the_operator_tool_needs_a_backup_on_a_workspace_with_data_supports_a_dry_run_and_never_takes_a_password(tmp_path):
    root = cli_workspace(tmp_path, with_data=True)
    base = ['--data-dir', str(root), '--email', 'owner@example.com']
    with pytest.raises(SystemExit) as refused:
        accounts_cli.main(['unlock'] + base)
    assert '--backup' in str(refused.value)
    assert accounts_cli.main(['unlock'] + base + ['--backup', str(_backup(root)), '--dry-run']) == 0
    with pytest.raises(SystemExit):
        accounts_cli.main(['reset-link'] + base + ['--password', 'x'])                            # no such argument
    with pytest.raises(SystemExit) as nobody:
        accounts_cli.main(['unlock', '--data-dir', str(root), '--email', 'nobody@example.com', '--backup', str(_backup(root))])
    assert 'No person' in str(nobody.value)
