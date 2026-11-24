"""Accounts A4: people (owner only), one-time links, security log.

* Invite and reset are by one-time link, no email: the owner gets the link once to copy. The token is random (256 bits), only its
  SHA-256 is stored, it works once, expires after 24 hours and redeeming it is rate-limited. The page that uses it reads the token
  from the URL fragment (#), which a browser never sends to a server.
* The server enforces: the last active owner can never be demoted or deactivated; nobody deactivates themselves; emails are unique;
  deactivating ends that person's sessions at once; no route returns a password, a hash, a token after creation, or a second-step secret.
* audit_events is append-only: there is no route that updates or deletes it. It records who did what and when.
"""
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .auth import (CLIENT_FAILURE_LIMIT, client_address, CLIENT_WINDOW_SECONDS, LockedOut, PolicyError, ROLES, _digest, _iso, _parse, hash_password,
                   normalize_email, validate_password)

LINK_HOURS = 24
REDEEM_FAILURE_LIMIT = 10
GENERIC_LINK_ERROR = 'This link cannot be used. Ask the owner for a new one.'


# ---- operations (also used by the operator tool) --------------------------------------------------------------------
def _owner_count(service, s):
    return len(s.scalars(select(service.m.User.id).where(service.m.User.role == 'owner', service.m.User.active.is_(True))).all())


def issue_link(service, s, user, created_by):
    """A new one-time link for this person; earlier unused links stop working. Returns the token (shown once, never stored)."""
    now = service.clock()
    for row in s.scalars(select(service.m.PasswordReset).where(service.m.PasswordReset.user_id == user.id, service.m.PasswordReset.used_at.is_(None))):
        if _parse(row.expires_at) > now:
            row.expires_at = _iso(now)
    token = secrets.token_urlsafe(32)
    s.add(service.m.PasswordReset(id=_digest(token), user_id=user.id, created_at=_iso(now), expires_at=_iso(now + timedelta(hours=LINK_HOURS)), used_at=None, created_by=created_by))
    return token


def account_lock_seconds(service, s, email):
    return service._account_lock(s, _digest('a:' + email), service.clock())


def unlock_account(service, s, email):
    """Forget the failed sign-ins of this email: a success marker ends the count, exactly as a correct sign-in would."""
    s.add(service.m.LoginAttempt(kind='account', key=_digest('a:' + email), at=_iso(service.clock()), ok=True))


def redeem_link(service, token, new_password, client):
    """Sets the person's own password from a valid one-time link. Same answer for an invalid, used or expired link.
    Returns the user email on success. Raises LockedOut (too many bad links from one address) or PolicyError (weak password)."""
    now = service.clock()
    client_key = _digest('l:' + (client or 'unknown'))
    with Session(service.engine) as s:
        since = _iso(now - timedelta(seconds=CLIENT_WINDOW_SECONDS))
        recent = s.scalars(select(service.m.LoginAttempt).where(service.m.LoginAttempt.kind == 'link', service.m.LoginAttempt.key == client_key,
                                                                service.m.LoginAttempt.ok.is_(False), service.m.LoginAttempt.at >= since)
                           .order_by(service.m.LoginAttempt.id.desc()).limit(REDEEM_FAILURE_LIMIT)).all()
        if len(recent) >= REDEEM_FAILURE_LIMIT:
            raise LockedOut(max(1, int(CLIENT_WINDOW_SECONDS - (now - _parse(recent[-1].at)).total_seconds())))
        row = s.get(service.m.PasswordReset, _digest(token)) if token and len(token) <= 200 else None
        user = s.get(service.m.User, row.user_id) if row is not None else None
        valid = row is not None and row.used_at is None and _parse(row.expires_at) > now and user is not None and bool(user.active)
        if not valid:
            s.add(service.m.LoginAttempt(kind='link', key=client_key, at=_iso(now), ok=False))
            s.commit()
            return None
        validate_password(new_password, user.email)                       # a weak password does not use up the link
        claimed = s.execute(update(service.m.PasswordReset).where(service.m.PasswordReset.id == row.id, service.m.PasswordReset.used_at.is_(None))
                            .values(used_at=_iso(now))).rowcount
        if claimed != 1:                                                  # someone else used it in the meantime
            s.rollback()
            return None
        user.password_hash, user.must_change_password, user.password_changed_at = hash_password(new_password), False, _iso(now)
        service._revoke_user(s, user.id)                                  # redeeming ends the person's other sessions
        service._audit(s, 'reset_link_used', user.id, user.email, user.id, user.email, None, client)
        s.commit()
        return user.email


# ---- HTTP ------------------------------------------------------------------------------------------------------------
class InviteBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str
    display_name: str = ''
    role: str


class UserPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    role: Optional[str] = None
    active: Optional[bool] = None
    display_name: Optional[str] = None


class RedeemBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: str
    new_password: str


class CodeBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str


def build_people_router(service):
    router = APIRouter(tags=['people'])
    m = service.m

    def me(request):
        return getattr(request.state, 'auth', None)

    def off():
        return JSONResponse({'detail': 'Login is off in this mode (AUTH_MODE=off).'}, status_code=409)

    def view(s, user):
        locked = account_lock_seconds(service, s, user.email)
        pending = s.scalars(select(m.PasswordReset).where(m.PasswordReset.user_id == user.id, m.PasswordReset.used_at.is_(None))).all()
        has_link = any(_parse(r.expires_at) > service.clock() for r in pending)
        status = 'Deactivated' if not user.active else 'Locked' if locked else 'Invited' if (user.last_login_at is None and has_link) else 'Active'
        two = None
        if service.two_step.required_for(user.role):
            two = 'Set up' if service.two_step.is_enrolled(s, user.id) else 'Not set up'
        return {'id': user.id, 'email': user.email, 'display_name': user.display_name, 'role': user.role, 'active': bool(user.active), 'status': status,
                'last_sign_in': user.last_login_at, 'locked_seconds': locked, 'two_step': two}

    @router.get('/api/users')
    def list_users(request: Request):
        if me(request) is None:
            return off()
        with Session(service.engine) as s:
            return [view(s, u) for u in s.scalars(select(m.User).order_by(func.lower(m.User.display_name), m.User.email))]

    @router.post('/api/users', status_code=201)
    def invite(body: InviteBody, request: Request):
        actor = me(request)
        if actor is None:
            return off()
        if body.role not in ROLES:
            return JSONResponse({'detail': 'Role must be viewer, analyst or owner.'}, status_code=400)
        try:
            email = normalize_email(body.email)
        except PolicyError as exc:
            return JSONResponse({'detail': str(exc)}, status_code=400)
        with Session(service.engine) as s:
            if s.scalars(select(m.User).where(m.User.email == email)).first() is not None:
                return JSONResponse({'detail': 'A person with this email already exists.'}, status_code=409)
            user = m.User(id=_new_id(), company_id=actor.company_id, email=email, display_name=(body.display_name or email).strip()[:120] or email, role=body.role,
                          password_hash=hash_password(secrets.token_urlsafe(32)), active=True, must_change_password=True,
                          created_at=_iso(service.clock()), password_changed_at=None)   # nobody knows this password: the person sets their own
            s.add(user)
            s.flush()
            token = issue_link(service, s, user, actor.user_id)
            service._audit(s, 'user_invited', actor.user_id, actor.email, user.id, user.email, f'role {body.role}')
            s.commit()
            return JSONResponse({'user': view(s, user), 'token': token, 'expires_hours': LINK_HOURS}, status_code=201)

    @router.patch('/api/users/{user_id}')
    def change(user_id: str, body: UserPatch, request: Request):
        actor = me(request)
        if actor is None:
            return off()
        with Session(service.engine) as s:
            user = s.get(m.User, user_id)
            if user is None:
                return JSONResponse({'detail': 'No such person.'}, status_code=404)
            if body.role is not None and body.role not in ROLES:
                return JSONResponse({'detail': 'Role must be viewer, analyst or owner.'}, status_code=400)
            owners = _owner_count(service, s)
            was_active_owner = user.role == 'owner' and bool(user.active)
            new_role = body.role if body.role is not None else user.role
            new_active = body.active if body.active is not None else bool(user.active)
            if body.active is False and user.id == actor.user_id:
                return JSONResponse({'detail': 'You cannot deactivate yourself.'}, status_code=409)
            if was_active_owner and owners <= 1 and (new_role != 'owner' or not new_active):
                return JSONResponse({'detail': 'The last active owner cannot be demoted or deactivated. Make someone else an owner first.'}, status_code=409)
            if body.display_name is not None:
                user.display_name = body.display_name.strip()[:120] or user.display_name
            if new_role != user.role:
                service._audit(s, 'role_changed', actor.user_id, actor.email, user.id, user.email, f'{user.role} to {new_role}')
                user.role = new_role
            if new_active != bool(user.active):
                user.active = new_active
                if not new_active:
                    service._revoke_user(s, user.id)                      # takes effect at once
                service._audit(s, 'user_deactivated' if not new_active else 'user_reactivated', actor.user_id, actor.email, user.id, user.email)
            s.commit()
            return view(s, user)

    @router.post('/api/users/{user_id}/unlock')
    def unlock(user_id: str, request: Request):
        actor = me(request)
        if actor is None:
            return off()
        with Session(service.engine) as s:
            user = s.get(m.User, user_id)
            if user is None:
                return JSONResponse({'detail': 'No such person.'}, status_code=404)
            unlock_account(service, s, user.email)
            service._audit(s, 'user_unlocked', actor.user_id, actor.email, user.id, user.email)
            s.commit()
            return view(s, user)

    @router.post('/api/users/{user_id}/reset-link')
    def reset_link(user_id: str, request: Request):
        actor = me(request)
        if actor is None:
            return off()
        with Session(service.engine) as s:
            user = s.get(m.User, user_id)
            if user is None or not user.active:
                return JSONResponse({'detail': 'No such active person.'}, status_code=404)
            token = issue_link(service, s, user, actor.user_id)
            service._audit(s, 'reset_link_created', actor.user_id, actor.email, user.id, user.email)
            s.commit()
            return {'user': view(s, user), 'token': token, 'expires_hours': LINK_HOURS}

    @router.get('/api/audit-events')
    def audit_events(request: Request, limit: int = 100, before: Optional[int] = None, failed_only: bool = False):
        if me(request) is None:
            return off()
        limit = max(1, min(limit, 200))
        with Session(service.engine) as s:
            query = select(m.AuditEvent).order_by(m.AuditEvent.id.desc())
            if before is not None:
                query = query.where(m.AuditEvent.id < before)
            if failed_only:
                query = query.where(m.AuditEvent.event.in_(['sign_in_failed', 'account_locked']))
            rows = s.scalars(query.limit(limit + 1)).all()
            more = len(rows) > limit
            rows = rows[:limit]
            return {'events': [{'id': r.id, 'at': r.at, 'event': r.event, 'actor': r.actor_label, 'target': r.target_label, 'detail': r.detail, 'client': r.client} for r in rows],
                    'next_before': rows[-1].id if more and rows else None}

    @router.post('/api/auth/redeem')
    def redeem(body: RedeemBody, request: Request):
        if not service.config.on:
            return off()
        client = client_address(request, service.config)
        try:
            email = redeem_link(service, body.token, body.new_password, client)
        except LockedOut as exc:
            response = JSONResponse({'detail': 'Too many attempts. Try again later.'}, status_code=429)
            response.headers['Retry-After'] = str(exc.retry_after)
            return response
        except PolicyError as exc:
            return JSONResponse({'detail': str(exc)}, status_code=400)
        if email is None:
            return JSONResponse({'detail': GENERIC_LINK_ERROR}, status_code=400)
        return {'ok': True}

    @router.post('/api/auth/two-step/start')
    def two_step_start(request: Request):
        info = me(request)
        if info is None:
            return off()
        if not service.two_step.required_for(info.role):
            return JSONResponse({'detail': 'Two-step sign-in is for owners.'}, status_code=403)
        if not service.two_step.available:
            return JSONResponse({'detail': "Two-step sign-in cannot be set up because the server's key is missing. Ask the person who runs this server."}, status_code=503)
        with Session(service.engine) as s:
            if service.two_step.is_enrolled(s, info.user_id):
                return JSONResponse({'detail': 'Two-step sign-in is already set up. Ask the operator to reset it if you lost your device.'}, status_code=409)
            user = s.get(m.User, info.user_id)
            secret, uri = service.two_step.start(s, user)
            s.commit()
        return {'secret': secret, 'uri': uri}

    @router.post('/api/auth/two-step/confirm')
    def two_step_confirm(body: CodeBody, request: Request):
        info = me(request)
        if info is None:
            return off()
        if not service.two_step.required_for(info.role):
            return JSONResponse({'detail': 'Two-step sign-in is for owners.'}, status_code=403)
        now = service.clock()
        key = _digest('t:' + info.user_id)
        with Session(service.engine) as s:
            wait = service._account_lock(s, key, now)
            if wait:
                response = JSONResponse({'detail': 'Too many wrong codes. Try again later.'}, status_code=429)
                response.headers['Retry-After'] = str(wait)
                return response
            user = s.get(m.User, info.user_id)
            codes = service.two_step.confirm(s, user, body.code, now)
            s.add(m.LoginAttempt(kind='account', key=key, at=_iso(now), ok=codes is not None))
            if codes is None:
                s.commit()
                return JSONResponse({'detail': 'That code is not right. Check the time on your device and try the next code.'}, status_code=400)
            service._audit(s, 'two_step_enrolled', info.user_id, info.email, info.user_id, info.email)
            s.commit()
        return {'recovery_codes': codes}
    return router


def _new_id():
    from uuid import uuid4
    return str(uuid4())
