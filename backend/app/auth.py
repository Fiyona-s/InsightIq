"""Accounts stage A1: the authentication core (docs/ACCOUNTS_PLAN.md). No user interface yet.

What this module is, honestly:
  * tables for one company and its users, server-side sessions, login attempts and reset tokens (migrations v14, v15);
  * Argon2id password hashing, revocable server-side sessions, account and client lockout;
  * AUTH_MODE (off = today's local mode, on = login required) with a fail-closed start-up check;
  * an access middleware that, with AUTH_MODE=on, refuses every route except a short public list unless the request
    carries a valid session, and refuses cross-origin state-changing requests.

What it is NOT: roles are stored but not yet enforced per route (stage A2), there is no login screen (A3), no TOTP
(A4), no per-company hosting package (A5). With AUTH_MODE=on every valid session is treated alike until A2. Nothing
here is a claim that data is separate or protected; the claim ladder in the plan governs all wording.
"""
import hashlib
import ipaddress
import math
import os
import re
import secrets
import shutil
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit
from uuid import uuid4

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.routing import Match
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Boolean, Column, Integer, String, Text, delete, inspect, select, text
from sqlalchemy.orm import Session

from .persistence import utcnow

ROLES = ('viewer', 'analyst', 'owner')
RANK = {role: position for position, role in enumerate(ROLES)}
ACCESS_LEVELS = frozenset({'public', 'viewer', 'analyst', 'owner', 'operator'})
SESSION_COOKIE = 'insightiq_session'
LOOPBACK_NAMES = {'localhost', 'ip6-localhost'}
# The only routes reachable without a session when AUTH_MODE=on (everything else is refused by default).
PUBLIC_ROUTES = frozenset({('GET', '/api/health'), ('GET', '/api/auth/status'), ('POST', '/api/auth/login'), ('POST', '/api/auth/redeem')})
UNSAFE_METHODS = frozenset({'POST', 'PUT', 'PATCH', 'DELETE'})

ACCOUNT_LOCK_AFTER = 5          # failed sign-ins for one email before it is locked
LOCK_BASE_SECONDS = 60          # first lock; doubles with every further failure
LOCK_MAX_SECONDS = 900          # never longer than 15 minutes
CLIENT_WINDOW_SECONDS = 900
CLIENT_FAILURE_LIMIT = 20       # failed sign-ins from one address inside the window
FAILURE_MEMORY_SECONDS = 24 * 3600
TOUCH_EVERY_SECONDS = 60        # last_seen is written at most this often
MIN_PASSWORD = 12
MAX_PASSWORD = 128

# A small list of very common passwords. A real deployment can extend it; length is what matters most.
COMMON_PASSWORDS = frozenset('''
password password1 password12 password123 password1234 passw0rd12 123456789012 1234567890123 12345678910
qwertyuiop12 qwertyuiopas qwerty123456 qwertyuiop123 iloveyou1234 letmein12345 welcome12345 admin1234567
administrator changeme1234 changemenow1 trustno1trustno1 abc123abc123 abcdefghijkl 111111111111 000000000000
123123123123 1q2w3e4r5t6y 1qaz2wsx3edc zaq12wsxcde3 monkey123456 dragon123456 football1234 baseball1234
princess1234 sunshine1234 master123456 superman1234 batman123456 internet1234 computer1234 whatever1234
insightiq1234 insightiq12345 company12345 business1234 passwordpassword
'''.split())


class ConfigError(RuntimeError):
    """The authentication settings are invalid or unsafe. The app refuses to start."""


class PolicyError(ValueError):
    """A password or email does not meet the policy."""


class LoginFailed(Exception):
    """Email or password incorrect (the same error for an unknown email)."""


class TwoStepRequired(Exception):
    """The password was right; this person must now give a code from their authenticator app (or a recovery code)."""


class TwoStepUnavailable(Exception):
    """An enrolled owner cannot sign in because the server's key for the second step is missing."""


class LockedOut(Exception):
    def __init__(self, retry_after):
        super().__init__('Too many failed sign-ins.')
        self.retry_after = retry_after


# ---- configuration -----------------------------------------------------------------------------------------------
def _is_loopback(host):
    host = (host or '').strip().strip('[]').lower()
    if not host:
        return None            # not declared
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False           # any other name or address is not loopback


@dataclass(frozen=True)
class AuthConfig:
    mode: str = 'off'
    app_env: str = 'development'
    bind_host: str = ''
    cookie_secure: bool = True
    idle_seconds: int = 12 * 3600
    absolute_seconds: int = 7 * 24 * 3600
    allowed_origins: tuple = ()
    owner_totp: bool = False                       # owners must use a second step (A4); on by default in hosted use (from_env)
    totp_key: str = field(default='', repr=False)  # Fernet key that encrypts the second-step secrets; never printed
    totp_key_from_file: bool = False               # hosted mode (A5) reads the key from a per-company secret file, never an env value
    trusted_proxies: tuple = ()                    # addresses or networks of the reverse proxy; X-Forwarded-For is honoured only from these (A5)

    @property
    def on(self):
        return self.mode == 'on'

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env

        def number(name, default, low, high):
            raw = (env.get(name) or '').strip()
            if not raw:
                return default
            try:
                value = int(raw)
            except ValueError as exc:
                raise ConfigError(f'{name} must be a whole number.') from exc
            if not low <= value <= high:
                raise ConfigError(f'{name} must be between {low} and {high}.')
            return value

        secure_raw = (env.get('AUTH_COOKIE_SECURE') or 'true').strip().lower()
        if secure_raw not in {'true', 'false'}:
            raise ConfigError('AUTH_COOKIE_SECURE must be true or false.')
        origins = tuple(o.strip().rstrip('/').lower() for o in (env.get('AUTH_ALLOWED_ORIGINS') or '').split(',') if o.strip())
        totp_raw = (env.get('AUTH_OWNER_TOTP') or 'true').strip().lower()
        if totp_raw not in {'true', 'false'}:
            raise ConfigError('AUTH_OWNER_TOTP must be true or false.')
        key, from_file = (env.get('AUTH_TOTP_KEY') or '').strip(), False
        key_file = (env.get('AUTH_TOTP_KEY_FILE') or '').strip()
        if key_file:
            if key:
                raise ConfigError('Set AUTH_TOTP_KEY_FILE or AUTH_TOTP_KEY, not both.')
            try:
                key, from_file = Path(key_file).read_text(encoding='utf-8').strip(), True
            except OSError as exc:
                raise ConfigError(f'AUTH_TOTP_KEY_FILE ({key_file}) cannot be read: {exc.strerror or "error"}.') from exc
        proxies = tuple(p.strip() for p in (env.get('AUTH_TRUSTED_PROXIES') or '').split(',') if p.strip())
        return cls(mode=(env.get('AUTH_MODE') or 'off').strip().lower(), owner_totp=totp_raw == 'true', totp_key=key, totp_key_from_file=from_file,
                   trusted_proxies=proxies, app_env=(env.get('APP_ENV') or 'development').strip().lower(),
                   bind_host=(env.get('INSIGHTIQ_BIND_HOST') or '').strip(), cookie_secure=secure_raw == 'true',
                   idle_seconds=number('AUTH_IDLE_SECONDS', 12 * 3600, 60, 30 * 24 * 3600),
                   absolute_seconds=number('AUTH_ABSOLUTE_SECONDS', 7 * 24 * 3600, 300, 90 * 24 * 3600), allowed_origins=origins)

    def check(self):
        """Fail closed. Raises ConfigError for anything unsafe; the application must not start."""
        if self.mode not in {'off', 'on'}:
            raise ConfigError(f'AUTH_MODE must be "off" or "on", not "{self.mode}".')
        if self.mode == 'off':
            if self.app_env == 'production':
                raise ConfigError('Refusing to start: AUTH_MODE=off is not allowed when APP_ENV=production.')
            if _is_loopback(self.bind_host) is False:
                raise ConfigError(f'Refusing to start: AUTH_MODE=off is only allowed on a loopback address, not on {self.bind_host}. '
                                  'Set AUTH_MODE=on or bind to 127.0.0.1.')
        if self.mode == 'on' and not self.cookie_secure and self.app_env == 'production':
            raise ConfigError('Refusing to start: AUTH_COOKIE_SECURE=false is not allowed when APP_ENV=production.')
        if self.mode == 'on' and self.app_env == 'production' and not self.owner_totp:
            raise ConfigError('Refusing to start: owners must use the second step when APP_ENV=production (AUTH_OWNER_TOTP).')
        if self.mode == 'on' and self.owner_totp and self.app_env == 'production' and not self.totp_key:
            raise ConfigError('Refusing to start: AUTH_TOTP_KEY is not set, so owners could not sign in with the second step.')
        if self.mode == 'on' and self.app_env == 'production':
            self._check_hosted()
        if self.totp_key:
            from .two_step import valid_key
            if not valid_key(self.totp_key):
                raise ConfigError('AUTH_TOTP_KEY is not a valid key (it must be a 32-byte url-safe base64 Fernet key).')
        if self.idle_seconds > self.absolute_seconds:
            raise ConfigError('AUTH_IDLE_SECONDS must not exceed AUTH_ABSOLUTE_SECONDS.')
        for item in self.trusted_proxies:
            self._network(item)
        return self

    @staticmethod
    def _network(item):
        try:
            net = ipaddress.ip_network(item, strict=False)
        except ValueError as exc:
            raise ConfigError(f'AUTH_TRUSTED_PROXIES has an entry that is not an address or network: {item!r}.') from exc
        if net.prefixlen == 0:
            raise ConfigError('AUTH_TRUSTED_PROXIES must not trust every address (a /0 network).')
        return net

    def proxy_networks(self):
        return tuple(self._network(p) for p in self.trusted_proxies)

    def _check_hosted(self):
        """Hosted (production) mode needs a stated public address, a key from a secret file and a named proxy. Nothing is guessed."""
        if not self.allowed_origins:
            raise ConfigError('Refusing to start: AUTH_ALLOWED_ORIGINS must name the public address (for example https://company.example) when APP_ENV=production.')
        for origin in self.allowed_origins:
            parts = urlsplit(origin)
            if parts.scheme != 'https' or not parts.netloc or parts.path not in ('', '/') or parts.query or parts.fragment or '*' in origin:
                raise ConfigError(f'Refusing to start: AUTH_ALLOWED_ORIGINS entries must be exact https addresses, not {origin!r}.')
        if self.owner_totp and not self.totp_key_from_file:
            raise ConfigError('Refusing to start: in hosted mode AUTH_TOTP_KEY must come from a secret file (AUTH_TOTP_KEY_FILE), not an environment value.')
        if not self.trusted_proxies:
            raise ConfigError('Refusing to start: AUTH_TRUSTED_PROXIES must name the reverse proxy when APP_ENV=production, or every person would share one address for lockouts.')


# ---- tables and migrations (v14, v15) ----------------------------------------------------------------------------
def register(base):
    class Company(base):
        __tablename__ = 'companies'
        id = Column(String(36), primary_key=True)
        name = Column(String(200), nullable=False)
        created_at = Column(String(40), nullable=False)

    class User(base):
        __tablename__ = 'users'
        id = Column(String(36), primary_key=True)
        company_id = Column(String(36), nullable=False, index=True)
        email = Column(String(254), nullable=False, unique=True)
        display_name = Column(String(120), nullable=False)
        role = Column(String(10), nullable=False)
        password_hash = Column(String(255), nullable=False)
        active = Column(Boolean, nullable=False, default=True)
        must_change_password = Column(Boolean, nullable=False, default=True)
        created_at = Column(String(40), nullable=False)
        last_login_at = Column(String(40), nullable=True)
        password_changed_at = Column(String(40), nullable=True)

    class AuthSession(base):
        __tablename__ = 'sessions'
        id = Column(String(64), primary_key=True)          # SHA-256 of the cookie token; the token itself is never stored
        user_id = Column(String(36), nullable=False, index=True)
        company_id = Column(String(36), nullable=False)
        created_at = Column(String(40), nullable=False)
        last_seen_at = Column(String(40), nullable=False)
        expires_at = Column(String(40), nullable=False)    # absolute expiry
        revoked_at = Column(String(40), nullable=True)
        user_agent = Column(String(200), nullable=True)

    class LoginAttempt(base):
        __tablename__ = 'login_attempts'
        id = Column(Integer, primary_key=True, autoincrement=True)
        kind = Column(String(10), nullable=False)          # 'account' or 'client'
        key = Column(String(64), nullable=False)           # SHA-256 of the lower-cased email / client address
        at = Column(String(40), nullable=False)
        ok = Column(Boolean, nullable=False)

    class PasswordReset(base):
        __tablename__ = 'password_resets'
        id = Column(String(64), primary_key=True)          # SHA-256 of the one-time token
        user_id = Column(String(36), nullable=False, index=True)
        created_at = Column(String(40), nullable=False)
        expires_at = Column(String(40), nullable=False)
        used_at = Column(String(40), nullable=True)
        created_by = Column(String(36), nullable=True)

    class AuditEvent(base):
        __tablename__ = 'audit_events'                      # append-only: no route updates or deletes it (and SQLite triggers refuse it)
        id = Column(Integer, primary_key=True, autoincrement=True)
        at = Column(String(40), nullable=False, index=True)
        event = Column(String(40), nullable=False)
        actor_id = Column(String(36), nullable=True)
        actor_label = Column(String(254), nullable=False)   # the person's email, or 'operator' / 'system'
        target_id = Column(String(36), nullable=True)
        target_label = Column(String(254), nullable=True)
        detail = Column(String(200), nullable=True)         # a short fixed phrase; never a password, token, code or data row
        client = Column(String(64), nullable=True)

    class UserTotp(base):
        __tablename__ = 'user_totp'
        user_id = Column(String(36), primary_key=True)
        secret_enc = Column(Text, nullable=False)           # Fernet-encrypted; unreadable without the company's key
        enrolled_at = Column(String(40), nullable=True)     # null while enrolment is unfinished
        last_step = Column(Integer, nullable=False, default=0)
        created_at = Column(String(40), nullable=False)

    class RecoveryCode(base):
        __tablename__ = 'recovery_codes'
        id = Column(Integer, primary_key=True, autoincrement=True)
        user_id = Column(String(36), nullable=False, index=True)
        code_hash = Column(String(64), nullable=False)      # SHA-256; the code itself is shown once and never stored
        used_at = Column(String(40), nullable=True)

    class Models:
        pass
    Models.Company, Models.User, Models.AuthSession, Models.LoginAttempt, Models.PasswordReset = Company, User, AuthSession, LoginAttempt, PasswordReset
    Models.AuditEvent, Models.UserTotp, Models.RecoveryCode = AuditEvent, UserTotp, RecoveryCode
    return Models


V14_TABLES = ('companies', 'users')
V15_TABLES = ('sessions', 'login_attempts', 'password_resets')
V16_TABLES = ('audit_events',)
V17_TABLES = ('user_totp', 'recovery_codes')


def _create_after_backup(engine, root, models, names, label):
    """Additive: create the tables once, after a full storage + consistent SQLite backup of an existing catalog."""
    inspector = inspect(engine)
    if all(inspector.has_table(n) for n in names):
        return
    if inspector.has_table('datasets'):
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError(f'Accounts migration {label} requires a verified SQLite backup before DDL.')
        folder = Path(root) / 'backups' / (f'accounts-{label}-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    for table in models_tables(models, names):
        table.create(engine, checkfirst=True)
    if 'audit_events' in names and engine.dialect.name == 'sqlite':
        with engine.begin() as connection:
            for verb in ('UPDATE', 'DELETE'):
                connection.execute(text(f"CREATE TRIGGER IF NOT EXISTS audit_events_no_{verb.lower()} BEFORE {verb} ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END"))


def models_tables(models, names):
    by_name = {m.__table__.name: m.__table__ for m in (models.Company, models.User, models.AuthSession, models.LoginAttempt, models.PasswordReset, models.AuditEvent, models.UserTotp, models.RecoveryCode)}
    return [by_name[n] for n in names]


def migrate(engine, root, models):
    _create_after_backup(engine, root, models, V14_TABLES, 'v14')
    _create_after_backup(engine, root, models, V15_TABLES, 'v15')
    _create_after_backup(engine, root, models, V16_TABLES, 'v16')
    _create_after_backup(engine, root, models, V17_TABLES, 'v17')


# ---- passwords ---------------------------------------------------------------------------------------------------
_HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)   # OWASP Argon2id minimum
_dummy_lock = threading.Lock()
_dummy_hash = None


def hash_password(password):
    return _HASHER.hash(password)


def verify_password(stored, password):
    try:
        return _HASHER.verify(stored, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored):
    try:
        return _HASHER.check_needs_rehash(stored)
    except InvalidHashError:
        return True


def _dummy():
    """A real Argon2id hash used to spend the same time when the email is unknown."""
    global _dummy_hash
    with _dummy_lock:
        if _dummy_hash is None:
            _dummy_hash = _HASHER.hash(secrets.token_hex(16))
        return _dummy_hash


def validate_password(password, email=''):
    problems = []
    if len(password) < MIN_PASSWORD:
        problems.append(f'Use at least {MIN_PASSWORD} characters.')
    if len(password) > MAX_PASSWORD:
        problems.append(f'Use at most {MAX_PASSWORD} characters.')
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or re.fullmatch(r'(.)\1+', password or ''):
        problems.append('That password is too common.')
    local = (email or '').split('@')[0].lower()
    if local and len(local) >= 4 and local in lowered:
        problems.append('Do not use your email name in your password.')
    if problems:
        raise PolicyError(' '.join(problems))


EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def normalize_email(email):
    value = (email or '').strip().lower()
    if not EMAIL_RE.match(value) or len(value) > 254:
        raise PolicyError('Enter a valid email address.')
    return value


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _iso(moment):
    return moment.astimezone(timezone.utc).isoformat()


def _parse(text):
    return datetime.fromisoformat(text)


@dataclass(frozen=True)
class SessionInfo:
    user_id: str
    company_id: str
    email: str
    display_name: str
    role: str
    must_change_password: bool
    company_name: str
    must_enrol_two_step: bool = False


# ---- service -----------------------------------------------------------------------------------------------------
class AuthService:
    def __init__(self, engine, models, config, clock: Optional[Callable[[], datetime]] = None):
        self.engine, self.m, self.config = engine, models, config
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        from .two_step import TwoStep
        self.two_step = TwoStep(self)

    # audit (append-only records: who did what, when; never a secret) ------------------------------------------------
    def _audit(self, s, event, actor_id=None, actor_label='system', target_id=None, target_label=None, detail=None, client=None):
        s.add(self.m.AuditEvent(at=_iso(self.clock()), event=event, actor_id=actor_id, actor_label=(actor_label or 'system')[:254],
                                target_id=target_id, target_label=(target_label or None) and target_label[:254], detail=(detail or None) and detail[:200],
                                client=(client or None) and client[:64]))

    def audit(self, event, actor_id=None, actor_label='system', target_id=None, target_label=None, detail=None, client=None):
        with Session(self.engine) as s:
            self._audit(s, event, actor_id, actor_label, target_id, target_label, detail, client)
            s.commit()

    # companies and users (the operator CLI and later stages use these)
    def company(self, session=None):
        def read(s):
            return s.scalars(select(self.m.Company).order_by(self.m.Company.created_at)).first()
        if session is not None:
            return read(session)
        with Session(self.engine) as s:
            return read(s)

    def create_company(self, session, name):
        name = (name or '').strip()
        if not name or len(name) > 200:
            raise PolicyError('Give the company a name of 1 to 200 characters.')
        if session.scalars(select(self.m.Company)).first() is not None:
            raise PolicyError('This workspace already has a company. One workspace belongs to one company.')
        company = self.m.Company(id=str(uuid4()), name=name, created_at=utcnow())
        session.add(company)
        return company

    def create_user(self, session, company_id, email, display_name, role, password, must_change=True):
        email = normalize_email(email)
        if role not in ROLES:
            raise PolicyError('Role must be viewer, analyst or owner.')
        validate_password(password, email)
        if session.scalars(select(self.m.User).where(self.m.User.email == email)).first() is not None:
            raise PolicyError('A user with this email already exists.')
        user = self.m.User(id=str(uuid4()), company_id=company_id, email=email, display_name=(display_name or email).strip()[:120] or email,
                           role=role, password_hash=hash_password(password), active=True, must_change_password=must_change,
                           created_at=utcnow(), password_changed_at=utcnow())
        session.add(user)
        return user

    def set_password(self, user_id, new_password):
        """Changes the password, ends every session of the user (stale sessions must not survive a password change)."""
        with Session(self.engine) as s:
            user = s.get(self.m.User, user_id)
            if user is None:
                raise PolicyError('Unknown user.')
            validate_password(new_password, user.email)
            user.password_hash, user.must_change_password, user.password_changed_at = hash_password(new_password), False, utcnow()
            self._revoke_user(s, user_id)
            s.commit()

    def set_active(self, user_id, active):
        with Session(self.engine) as s:
            user = s.get(self.m.User, user_id)
            if user is None:
                raise PolicyError('Unknown user.')
            user.active = bool(active)
            if not active:
                self._revoke_user(s, user_id)
            s.commit()

    # lockout --------------------------------------------------------------------------------------------------------
    def _account_lock(self, s, key, now):
        rows = s.scalars(select(self.m.LoginAttempt).where(self.m.LoginAttempt.kind == 'account', self.m.LoginAttempt.key == key)
                         .order_by(self.m.LoginAttempt.id.desc()).limit(60)).all()
        failures, last = 0, None
        for row in rows:
            if row.ok or (now - _parse(row.at)).total_seconds() > FAILURE_MEMORY_SECONDS:
                break
            failures += 1
            last = last or _parse(row.at)
        if failures < ACCOUNT_LOCK_AFTER:
            return 0
        lock = min(LOCK_MAX_SECONDS, LOCK_BASE_SECONDS * 2 ** (failures - ACCOUNT_LOCK_AFTER))
        return max(0, math.ceil((last + timedelta(seconds=lock) - now).total_seconds()))

    def _client_lock(self, s, key, now):
        since = _iso(now - timedelta(seconds=CLIENT_WINDOW_SECONDS))
        rows = s.scalars(select(self.m.LoginAttempt).where(self.m.LoginAttempt.kind == 'client', self.m.LoginAttempt.key == key,
                                                           self.m.LoginAttempt.ok.is_(False), self.m.LoginAttempt.at >= since)
                         .order_by(self.m.LoginAttempt.id.desc()).limit(CLIENT_FAILURE_LIMIT)).all()
        if len(rows) < CLIENT_FAILURE_LIMIT:
            return 0
        oldest = _parse(rows[-1].at)
        return max(0, math.ceil((oldest + timedelta(seconds=CLIENT_WINDOW_SECONDS) - now).total_seconds()))

    def authenticate(self, email, password, client='unknown', code=None, second_step=True):
        """Returns the user id on success. Raises LockedOut, LoginFailed, TwoStepRequired or TwoStepUnavailable.
        Unknown emails take the same path and time. For an owner with the second step, a wrong code counts toward the same
        lockout as a wrong password, and nothing is recorded as a success until BOTH steps are right."""
        now = self.clock()
        try:
            email_n = normalize_email(email)
        except PolicyError:
            email_n = (email or '').strip().lower()[:254]
        account_key, client_key = _digest('a:' + email_n), _digest('c:' + (client or 'unknown'))
        with Session(self.engine) as s:
            wait = max(self._account_lock(s, account_key, now), self._client_lock(s, client_key, now))
            if wait:
                raise LockedOut(wait)           # attempts made while locked are not counted, so a lock cannot be extended forever
            user = s.scalars(select(self.m.User).where(self.m.User.email == email_n)).first()
            stored = user.password_hash if (user is not None and user.active) else _dummy()
            ok = verify_password(stored, password or '') and user is not None and bool(user.active)
            reason, second = 'email not recognised' if user is None else 'wrong password' if ok is False else '', None
            if ok and second_step and self.two_step.required_for(user.role) and self.two_step.is_enrolled(s, user.id):
                if not self.two_step.available:
                    raise TwoStepUnavailable()
                if not (code or '').strip():
                    raise TwoStepRequired()      # the password was right; nothing is counted until the code is given
                second = self.two_step.verify(s, user, code, now)
                ok, reason = second is not None, '' if second is not None else 'wrong code'
            for kind, key in (('account', account_key), ('client', client_key)):
                s.add(self.m.LoginAttempt(kind=kind, key=key, at=_iso(now), ok=ok))
            if ok:
                if needs_rehash(user.password_hash):
                    user.password_hash = hash_password(password)
                user.last_login_at = _iso(now)
                user_id = user.id
                self._audit(s, 'sign_in_ok', user.id, user.email, user.id, user.email, 'recovery code' if second == 'recovery' else None, client)
                if second == 'recovery':
                    self._audit(s, 'recovery_code_used', user.id, user.email, user.id, user.email, None, client)
            else:
                known = user is not None and bool(user.active) or user is not None
                self._audit(s, 'sign_in_failed', user.id if user else None, user.email if user else 'unknown', user.id if user else None,
                            user.email if user else None, reason or 'wrong password', client)
                s.flush()
                if self._account_lock(s, account_key, now) > 0:
                    self._audit(s, 'account_locked', user.id if user else None, user.email if user else 'unknown', user.id if user else None,
                                user.email if user else None, 'too many failed sign-ins', client)
            s.execute(delete(self.m.LoginAttempt).where(self.m.LoginAttempt.at < _iso(now - timedelta(days=7))))
            s.commit()
        if not ok:
            raise LoginFailed()
        return user_id

    # sessions -------------------------------------------------------------------------------------------------------
    def start_session(self, user_id, user_agent=''):
        """A fresh random 256-bit token every time (so a session id is never reused or fixed). Only its SHA-256 is stored."""
        token = secrets.token_urlsafe(32)
        now = self.clock()
        with Session(self.engine) as s:
            user = s.get(self.m.User, user_id)
            s.add(self.m.AuthSession(id=_digest(token), user_id=user_id, company_id=user.company_id, created_at=_iso(now), last_seen_at=_iso(now),
                                     expires_at=_iso(now + timedelta(seconds=self.config.absolute_seconds)), user_agent=(user_agent or '')[:200]))
            s.commit()
        return token

    def resolve_session(self, token):
        if not token or len(token) > 200:
            return None
        now = self.clock()
        with Session(self.engine) as s:
            row = s.get(self.m.AuthSession, _digest(token))
            if row is None or row.revoked_at is not None or now >= _parse(row.expires_at):
                return None
            if (now - _parse(row.last_seen_at)).total_seconds() >= self.config.idle_seconds:
                return None
            user = s.get(self.m.User, row.user_id)
            if user is None or not user.active:
                return None
            if (now - _parse(row.last_seen_at)).total_seconds() >= TOUCH_EVERY_SECONDS:
                row.last_seen_at = _iso(now)
                s.commit()
            company = s.get(self.m.Company, user.company_id)
            must_enrol = self.two_step.required_for(user.role) and not self.two_step.is_enrolled(s, user.id)
            return SessionInfo(user.id, user.company_id, user.email, user.display_name, user.role, bool(user.must_change_password),
                               company.name if company else '', must_enrol)

    def revoke_session(self, token):
        with Session(self.engine) as s:
            row = s.get(self.m.AuthSession, _digest(token or ''))
            if row is not None and row.revoked_at is None:
                row.revoked_at = _iso(self.clock())
                s.commit()

    def _revoke_user(self, s, user_id):
        now = _iso(self.clock())
        for row in s.scalars(select(self.m.AuthSession).where(self.m.AuthSession.user_id == user_id, self.m.AuthSession.revoked_at.is_(None))):
            row.revoked_at = now

    def revoke_user_sessions(self, user_id):
        with Session(self.engine) as s:
            self._revoke_user(s, user_id)
            s.commit()


# ---- HTTP: routes and middleware ---------------------------------------------------------------------------------
class LoginBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str
    password: str
    code: Optional[str] = None              # the second step (owners): a 6-digit code or a recovery code


class ChangePasswordBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    current_password: str
    new_password: str


# While a user must still choose their own password, only these routes work (A3).
PASSWORD_CHANGE_ROUTES = frozenset({'GET /api/auth/me', 'POST /api/auth/logout', 'POST /api/auth/change-password'})
# While an owner has not set up the second step (A4), only these routes work.
TWO_STEP_ROUTES = frozenset({'GET /api/auth/me', 'POST /api/auth/logout', 'POST /api/auth/two-step/start', 'POST /api/auth/two-step/confirm'})


def _no_store(headers):
    headers['Cache-Control'] = 'private, no-store'


def same_origin(request: Request, config: AuthConfig):
    """True when the Origin (or, failing that, the Referer) names this site. Used for state-changing requests."""
    origin = request.headers.get('origin')
    if origin is None:
        referer = request.headers.get('referer')
        if not referer:
            return False
        parts = urlsplit(referer)
        origin = f'{parts.scheme}://{parts.netloc}'
    origin = origin.strip().rstrip('/').lower()
    if origin == 'null':
        return False
    if origin in config.allowed_origins:
        return True
    if config.app_env == 'production':
        return False            # hosted: only the stated public address counts; the proxy's Host header is never trusted
    host = (request.headers.get('host') or '').lower()
    return bool(host) and urlsplit(origin).netloc == host


def client_address(request: Request, config: AuthConfig):
    """The address used for per-address lockouts and the log. X-Forwarded-For is read only when the request really comes from a
    configured proxy; then the right-most hop that is not itself a proxy is the client. Anything else is ignored."""
    peer = request.client.host if request.client else 'unknown'
    if not config.trusted_proxies:
        return peer
    nets = config.proxy_networks()

    def trusted(address):
        try:
            return any(ipaddress.ip_address(address) in n for n in nets)
        except ValueError:
            return False
    if not trusted(peer):
        return peer
    hops = [h.strip() for value in request.headers.getlist('x-forwarded-for') for h in value.split(',') if h.strip()]
    for hop in reversed(hops):
        try:
            address = ipaddress.ip_address(hop)
        except ValueError:
            return peer            # a malformed hop: do not guess
        if not trusted(hop):
            return str(address)
    return str(ipaddress.ip_address(hops[0])) if hops and _valid_ip(hops[0]) else peer


def _valid_ip(value):
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def build_router(service: AuthService):
    router = APIRouter(prefix='/api/auth', tags=['auth'])
    config = service.config

    def profile(info: SessionInfo):
        return {'email': info.email, 'display_name': info.display_name, 'role': info.role, 'company': info.company_name,
                'must_change_password': info.must_change_password, 'must_enrol_two_step': info.must_enrol_two_step}

    def off():
        return JSONResponse({'detail': 'Login is off in this mode (AUTH_MODE=off).'}, status_code=409)

    @router.get('/status')
    def status(request: Request):
        # Public on purpose: the sign-in screen needs to know the mode before there is a session. `user` is the person the
        # request's own session cookie belongs to (None without a valid session), so the page can load without a failing call.
        info = service.resolve_session(request.cookies.get(SESSION_COOKIE)) if config.on else None
        return {'mode': config.mode, 'login_required': config.on, 'user': profile(info) if info else None}

    @router.post('/login')
    def login(body: LoginBody, request: Request):
        if not config.on:
            return off()
        client = client_address(request, config)
        try:
            user_id = service.authenticate(body.email, body.password, client, body.code)
        except TwoStepRequired:
            return JSONResponse({'two_step_required': True})
        except TwoStepUnavailable:
            return JSONResponse({'detail': "Two-step sign-in is not available because the server's key is missing. Ask the person who runs this server."}, status_code=503)
        except LockedOut as exc:
            response = JSONResponse({'detail': 'Too many failed sign-ins. Try again later.'}, status_code=429)
            response.headers['Retry-After'] = str(exc.retry_after)
            return response
        except LoginFailed:
            return JSONResponse({'detail': 'Email or password incorrect.'}, status_code=401)
        previous = request.cookies.get(SESSION_COOKIE)
        if previous:
            service.revoke_session(previous)      # a new session at every sign-in; the old one cannot be kept or fixed
        token = service.start_session(user_id, request.headers.get('user-agent', ''))
        info = service.resolve_session(token)
        response = JSONResponse(profile(info))
        response.set_cookie(SESSION_COOKIE, token, max_age=config.absolute_seconds, httponly=True, secure=config.cookie_secure, samesite='lax', path='/')
        return response

    @router.post('/logout')
    def logout(request: Request):
        if not config.on:
            return off()
        info = service.resolve_session(request.cookies.get(SESSION_COOKIE, ''))
        service.revoke_session(request.cookies.get(SESSION_COOKIE, ''))
        if info is not None:
            service.audit('sign_out', info.user_id, info.email, info.user_id, info.email)
        response = JSONResponse({'signed_out': True})
        response.delete_cookie(SESSION_COOKIE, path='/', secure=config.cookie_secure, httponly=True, samesite='lax')
        return response

    @router.post('/change-password')
    def change_password(body: ChangePasswordBody, request: Request):
        if not config.on:
            return off()
        info = getattr(request.state, 'auth', None)
        if info is None:
            return JSONResponse({'detail': 'Sign in required.'}, status_code=401)
        client = client_address(request, config)
        try:
            service.authenticate(info.email, body.current_password, client, second_step=False)      # same lockout rules; the session is already two-step
        except LockedOut as exc:
            response = JSONResponse({'detail': 'Too many failed attempts. Try again later.'}, status_code=429)
            response.headers['Retry-After'] = str(exc.retry_after)
            return response
        except LoginFailed:
            return JSONResponse({'detail': 'Your current password is incorrect.'}, status_code=400)
        if body.new_password == body.current_password:
            return JSONResponse({'detail': 'Choose a password you have not used just now.'}, status_code=400)
        try:
            service.set_password(info.user_id, body.new_password)               # ends every session of this user, including this one
        except PolicyError as exc:
            return JSONResponse({'detail': str(exc)}, status_code=400)
        service.audit('password_changed', info.user_id, info.email, info.user_id, info.email, 'own password', client)
        token = service.start_session(info.user_id, request.headers.get('user-agent', ''))
        response = JSONResponse(profile(service.resolve_session(token)))
        response.set_cookie(SESSION_COOKIE, token, max_age=config.absolute_seconds, httponly=True, secure=config.cookie_secure, samesite='lax', path='/')
        return response

    @router.get('/me')
    def me(request: Request):
        if not config.on:
            return off()
        info = getattr(request.state, 'auth', None)
        if info is None:
            return JSONResponse({'detail': 'Sign in required.'}, status_code=401)
        return profile(info)
    return router


def authorise(info, key, access):
    """None when the session's role may call the route, otherwise the refusal. Default deny: no level means no access."""
    if key is None:
        return None                                    # no such route: the router answers 404 (a session was still required)
    level = access.get(key)
    if level is None or level not in ACCESS_LEVELS:
        return JSONResponse({'detail': 'This route has no access level and is refused.'}, status_code=403)
    if level == 'operator':
        return JSONResponse({'detail': 'This area is not available in hosted mode.'}, status_code=404)
    if level == 'public':
        return None
    if RANK.get(info.role, -1) < RANK[level]:
        return JSONResponse({'detail': 'Your role does not allow this.'}, status_code=403)
    return None


def route_key(routes, scope):
    """'METHOD /template' of the route this request would reach, or None when no route matches (the router will answer 404)."""
    method = scope['method'].upper()
    lookup = 'GET' if method == 'HEAD' else method
    for route in routes:
        methods = getattr(route, 'methods', None)
        if methods is None or method not in methods:
            continue
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return f'{lookup} {route.path}'
    return None


def make_middleware(service: AuthService, routes=lambda: (), access=None):
    """`routes` returns the application's live routes; `access` maps 'METHOD /template' to a minimum role (ROUTE_ACCESS)."""
    config = service.config
    access = {} if access is None else access

    async def middleware(request: Request, call_next):
        if not config.on:
            return await call_next(request)
        route = (request.method.upper(), request.url.path)
        token = request.cookies.get(SESSION_COOKIE)
        if route in PUBLIC_ROUTES:
            if route[0] in UNSAFE_METHODS and not same_origin(request, config) and request.headers.get('origin') is not None:
                response = JSONResponse({'detail': 'Cross-origin request refused.'}, status_code=403)
            else:
                response = await call_next(request)
        else:
            info = service.resolve_session(token) if token else None
            if info is None:
                response = JSONResponse({'detail': 'Sign in required.'}, status_code=401)
            elif route[0] in UNSAFE_METHODS and not same_origin(request, config):
                response = JSONResponse({'detail': 'Cross-origin request refused.'}, status_code=403)
            else:
                key = route_key(routes(), request.scope)
                if info.must_change_password and key not in PASSWORD_CHANGE_ROUTES:
                    refusal = JSONResponse({'detail': 'Change your password before continuing.', 'code': 'password_change_required'}, status_code=403)
                elif info.must_enrol_two_step and key not in TWO_STEP_ROUTES:
                    refusal = JSONResponse({'detail': 'Set up two-step sign-in before continuing.', 'code': 'two_step_enrolment_required'}, status_code=403)
                else:
                    refusal = authorise(info, key, access)
                if refusal is not None:
                    response = refusal
                else:
                    request.state.auth = info
                    response = await call_next(request)
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('X-Frame-Options', 'DENY')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        if request.url.path.startswith('/api/'):
            _no_store(response.headers)
        return response
    return middleware


def ensure_schema(engine, root, base, migration_model, models):
    """For the operator CLI: create v14/v15 (after a backup) and register their versions, never one without the other."""
    from .persistence import migrate as record_versions
    migrate(engine, root, models)
    record_versions(engine, base, migration_model)
