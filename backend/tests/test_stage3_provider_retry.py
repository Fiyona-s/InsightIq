"""A rate-limit answer (429) is retried after the wait the provider asks for; real failures are not."""
import json
import httpx
import pytest
from app import provider as provider_module
from app.provider import LLMProvider, ModelError

OK = {'model': 'm', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'sql': 'SELECT 1', 'clarification': None, 'explanation': 'x'})}}],
      'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}


@pytest.fixture
def waits(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'test-only-never-real')
    monkeypatch.setenv('LLM_MODEL', 'controlled-model')
    recorded = []
    async def fake_sleep(seconds):
        recorded.append(seconds)
    monkeypatch.setattr(provider_module.asyncio, 'sleep', fake_sleep)
    return recorded


def provider_with(responses):
    calls = {'n': 0}
    def handle(_):
        item = responses[min(calls['n'], len(responses) - 1)]
        calls['n'] += 1
        return item
    p = LLMProvider(httpx.MockTransport(handle))
    p.calls = calls
    return p


def test_a_rate_limit_is_retried_after_the_wait_the_provider_asks_for(waits):
    p = provider_with([httpx.Response(429, headers={'retry-after': '3'}), httpx.Response(200, json=OK)])
    plan, _ = p.generate('q', {'table': 'data', 'columns': []})
    assert plan.sql == 'SELECT 1' and p.calls['n'] == 2 and waits == [3.0]


def test_the_wait_is_capped_and_retries_are_limited(waits):
    p = provider_with([httpx.Response(429, headers={'retry-after': '600'})])
    with pytest.raises(ModelError) as error:
        p.generate('q', {})
    assert error.value.code == 'provider_rate_limit'
    assert p.calls['n'] == provider_module.RATE_LIMIT_RETRIES + 1
    assert waits == [provider_module.RATE_LIMIT_MAX_WAIT_SECONDS] * provider_module.RATE_LIMIT_RETRIES


def test_other_failures_are_never_retried(waits):
    for status, code in [(401, 'provider_auth'), (500, 'provider_error')]:
        p = provider_with([httpx.Response(status, text='x')])
        with pytest.raises(ModelError) as error:
            p.generate('q', {})
        assert error.value.code == code and p.calls['n'] == 1
    assert waits == []
