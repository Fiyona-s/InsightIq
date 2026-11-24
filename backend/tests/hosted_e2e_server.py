"""Browser tests for hosted mode (AUTH_MODE=on) only; excluded from production images.

Same controlled provider boundary as e2e_server.py (no live AI). The data folder is prepared first by
hosted_e2e_prepare.py (users and a small pinned dashboard); this module then serves that folder with login required.
"""
import os
import tempfile

import httpx

from app import auth
from app.main import create_app
from app.provider import LLMProvider
from tests.test_phase3 import ControlledEmbedding

FOLDER = os.environ.get('HOSTED_E2E_DIR') or os.path.join(tempfile.gettempdir(), 'insightiq-hosted-e2e')
ORIGINS = tuple(o for o in (os.environ.get('HOSTED_E2E_ORIGINS') or 'http://127.0.0.1:5176,http://localhost:5176').split(',') if o)


# A fixed throwaway Fernet key for the test server only (never a real company's key).
TOTP_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='


def config():
    if os.environ.get('STACK_TEST'):            # A5: the real production settings from the environment (key file, public address, trusted proxy)
        return auth.AuthConfig.from_env().check()
    return auth.AuthConfig(mode='on', cookie_secure=True, bind_host='127.0.0.1', allowed_origins=ORIGINS, owner_totp=True, totp_key=TOTP_KEY)


def build(folder=FOLDER):
    from tests.e2e_server import controlled_fx, controlled_model
    return create_app(folder, provider=LLMProvider(httpx.MockTransport(controlled_model)), embedder=ControlledEmbedding(), fx_fetch=controlled_fx,
                      auth_config=config())


app = build()
