"""Test-only app for the A5 stack tests (never in an image; mounted read-only by deploy/tests/compose.test.yaml).
The REAL production settings come from the environment (key file, public address, trusted proxy, APP_ENV=production) and are
checked exactly as in a real stack; only the AI provider is the controlled fixture used by every browser test (no live AI)."""
import os

import httpx

from app import auth
from app.main import create_app
from app.provider import LLMProvider
from tests.e2e_server import controlled_fx, controlled_model
from tests.test_phase3 import ControlledEmbedding

app = create_app(os.environ.get('DATA_DIR', '/data'), provider=LLMProvider(httpx.MockTransport(controlled_model)), embedder=ControlledEmbedding(),
                 fx_fetch=controlled_fx, auth_config=auth.AuthConfig.from_env().check())
