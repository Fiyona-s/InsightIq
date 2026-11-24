"""Accounts A4: owner two-step sign-in (TOTP) and recovery codes.

* The TOTP secret is encrypted at rest with Fernet using a per-company key from the environment (AUTH_TOTP_KEY).
  If the key is missing an enrolled owner cannot sign in (the answer says why); nothing is ever decrypted without it.
* Each 30-second step is accepted once (a replayed code is refused); wrong codes count toward the same lockout as wrong passwords.
* Eight single-use recovery codes are stored only as SHA-256 hashes and shown once.
* Losing the key means the owner must be enrolled again with the operator tool (`scripts/accounts_cli.py reset-2fa`).
"""
import hashlib
import hmac
import secrets
from datetime import datetime

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from .persistence import utcnow

STEP_SECONDS = 30
RECOVERY_CODES = 8
ISSUER = 'InsightIQ'


def valid_key(key):
    try:
        Fernet(key.encode())
        return True
    except (ValueError, TypeError):
        return False


def _hash_recovery(code):
    return hashlib.sha256(code.lower().replace('-', '').replace(' ', '').encode()).hexdigest()


class TwoStep:
    def __init__(self, service):
        self.service = service
        key = service.config.totp_key
        self.cipher = Fernet(key.encode()) if key and valid_key(key) else None

    @property
    def available(self):
        return self.cipher is not None

    def required_for(self, role):
        return bool(self.service.config.owner_totp) and role == 'owner'

    def row(self, s, user_id):
        return s.get(self.service.m.UserTotp, user_id)

    def is_enrolled(self, s, user_id):
        row = self.row(s, user_id)
        return row is not None and row.enrolled_at is not None

    def _secret(self, row):
        try:
            return self.cipher.decrypt(row.secret_enc.encode()).decode()
        except (InvalidToken, AttributeError):
            return None

    def start(self, s, user):
        """Begin enrolment: a new secret (replacing an unfinished one). Returns the secret and the otpauth URI."""
        if not self.available:
            raise RuntimeError('key missing')
        secret = pyotp.random_base32()
        row = self.row(s, user.id)
        if row is None:
            row = self.service.m.UserTotp(user_id=user.id, created_at=utcnow(), last_step=0)
            s.add(row)
        row.secret_enc, row.enrolled_at, row.last_step = self.cipher.encrypt(secret.encode()).decode(), None, 0
        return secret, pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)

    def _check_totp(self, row, code, now):
        """The accepted step (an int) when `code` is valid for a step not used before, else None."""
        secret = self._secret(row)
        if secret is None or not code.isdigit() or len(code) != 6:
            return None
        totp = pyotp.TOTP(secret, interval=STEP_SECONDS)
        current = int(now.timestamp()) // STEP_SECONDS
        for step in (current - 1, current, current + 1):
            if step > (row.last_step or 0) and hmac.compare_digest(totp.at(step * STEP_SECONDS), code):
                return step
        return None

    def confirm(self, s, user, code, now):
        """Finish enrolment with a first valid code. Returns the recovery codes (shown once) or None."""
        row = self.row(s, user.id)
        if row is None or row.enrolled_at is not None or not self.available:
            return None
        step = self._check_totp(row, (code or '').strip().replace(' ', ''), now)
        if step is None:
            return None
        row.enrolled_at, row.last_step = utcnow(), step
        for old in s.scalars(select(self.service.m.RecoveryCode).where(self.service.m.RecoveryCode.user_id == user.id)).all():
            s.delete(old)
        codes = []
        for _ in range(RECOVERY_CODES):
            raw = secrets.token_hex(5)                        # 40 bits, shown as xxxxx-xxxxx
            codes.append(f'{raw[:5]}-{raw[5:]}')
            s.add(self.service.m.RecoveryCode(user_id=user.id, code_hash=_hash_recovery(raw), used_at=None))
        return codes

    def verify(self, s, user, code, now: datetime):
        """'totp', 'recovery' or None. A used time step or recovery code never works twice."""
        row = self.row(s, user.id)
        if row is None or row.enrolled_at is None:
            return None
        text = (code or '').strip().replace(' ', '')
        step = self._check_totp(row, text, now)
        if step is not None:
            row.last_step = step
            return 'totp'
        if text and not text.isdigit():
            digest = _hash_recovery(text)
            for rc in s.scalars(select(self.service.m.RecoveryCode).where(self.service.m.RecoveryCode.user_id == user.id, self.service.m.RecoveryCode.used_at.is_(None))).all():
                if hmac.compare_digest(rc.code_hash, digest):
                    rc.used_at = utcnow()
                    return 'recovery'
        return None

    def remaining_recovery_codes(self, s, user_id):
        return len(s.scalars(select(self.service.m.RecoveryCode).where(self.service.m.RecoveryCode.user_id == user_id, self.service.m.RecoveryCode.used_at.is_(None))).all())

    def reset(self, s, user_id):
        """Operator only: forget this person's enrolment so they enrol again."""
        row = self.row(s, user_id)
        if row is not None:
            s.delete(row)
        for rc in s.scalars(select(self.service.m.RecoveryCode).where(self.service.m.RecoveryCode.user_id == user_id)).all():
            s.delete(rc)
