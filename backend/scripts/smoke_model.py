"""Opt-in real-model smoke test. Running this script can make up to four billable API requests (3 SQL attempts + narrative selection).
Export LLM_API_KEY and LLM_MODEL first. Never run it automatically in CI.
"""
import os
import sys
import tempfile
import time
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app.main import create_app


def main():
    if not os.getenv('LLM_API_KEY') or not os.getenv('LLM_MODEL'):
        raise SystemExit('Not run: export LLM_API_KEY and LLM_MODEL before this opt-in paid smoke test.')
    with tempfile.TemporaryDirectory(prefix='insightiq-live-smoke-') as directory:
        with TestClient(create_app(directory)) as client:
            dataset = client.post('/api/datasets', files={'file': ('explicit-smoke-fixture.csv', b'id,revenue\n001,10.5\n002,20\n')}).json()
            response = client.post('/api/analyst/runs', json={'dataset_id': dataset['id'], 'question': 'What is the sum of revenue across all records? Return a single numeric total.', 'type_mapping': {'revenue': 'DOUBLE'}})
            response.raise_for_status()
            identifier = response.json()['id']
            deadline = time.monotonic() + 140
            while time.monotonic() < deadline:
                run = client.get('/api/analyst/runs/' + identifier).json()
                if run['status'] in {'failed', 'succeeded', 'clarification', 'cancelled'}:
                    break
                time.sleep(.2)
            assert run['status'] == 'succeeded', {k: run.get(k) for k in ('status', 'error_code', 'error', 'clarification')}
            result = client.get('/api/analyst/runs/' + identifier + '/results').json()
            assert result['row_count'] == 1 and len(result['columns']) == 1
            assert Decimal(str(result['rows'][0][0])) == Decimal('30.5'), result
            analysis = client.get('/api/analyst/runs/' + identifier + '/analysis').json()
            assert analysis['charts']['recommended']['spec']['kind'] == 'kpi'
            assert any(f['method'] == 'total' and Decimal(f['value']) == Decimal('30.5') for f in analysis['evidence']['facts'])
            assert run['attempts'] <= 3 and any(e['step'] == 'explain' for e in run['events'])
            print('REAL MODEL SMOKE PASSED; RAG:', run['retrieval']['status'])
            print('Executed SQL:', run['executed_sql'])
            print('Measured metrics:', run['metrics'])


if __name__ == '__main__':
    main()
