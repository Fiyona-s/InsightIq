"""Prepares the hosted-mode browser-test workspace: a company, users for every flow, a dataset, one answered question and a
dashboard with two pinned tiles. Run once before the server starts:  python tests/hosted_e2e_prepare.py"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pyotp  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from tests import hosted_e2e_server as server  # noqa: E402

PASSWORD = 'correct horse battery'
ORIGIN = {'origin': os.environ.get('HOSTED_E2E_ORIGIN') or 'https://testserver'}     # A5: the stack's public address when run inside a stack
PEOPLE = [
    ('owner@example.com', 'owner'), ('analyst@example.com', 'analyst'), ('viewer@example.com', 'viewer'),
    ('viewer2@example.com', 'viewer'), ('analyst2@example.com', 'analyst'), ('owner2@example.com', 'owner'),
    ('expiry@example.com', 'analyst'), ('signout@example.com', 'analyst'), ('wrongpw@example.com', 'analyst'), ('shapes@example.com', 'owner'),
    ('people@example.com', 'owner'), ('enrol@example.com', 'owner'), ('pwchange@example.com', 'analyst'),
]
ENROLLED = ['owner@example.com', 'owner2@example.com', 'shapes@example.com', 'people@example.com']
MUST_CHANGE = [('first@example.com', 'analyst'), ('first2@example.com', 'analyst')]
CSV = 'order_id,region,quantity,revenue\n1,North,3,1250.0\n2,South,1,320.0\n3,East,2,900.0\n4,West,5,2100.0\n5,North,4,700.0\n'


def main():
    if not os.environ.get('HOSTED_E2E_KEEP_DIR'):        # inside a stack the folder is a mounted volume: keep it
        shutil.rmtree(server.FOLDER, ignore_errors=True)
    application = server.build(server.FOLDER)
    service = application.state.auth
    with TestClient(application, base_url='https://testserver') as c:
        with Session(service.engine) as s:
            company = service.create_company(s, 'Acme Shop')
            for email, role in PEOPLE:
                service.create_user(s, company.id, email, email.split('@')[0].title(), role, PASSWORD, must_change=False)
            for email, role in MUST_CHANGE:
                service.create_user(s, company.id, email, email.split('@')[0].title(), role, PASSWORD, must_change=True)
            s.commit()
        # Owners are set up for two-step sign-in beforehand, except enrol@example.com, who does it in the browser test.
        # The secrets and recovery codes go to a throwaway file the browser tests read; they belong to no real account.
        secrets_out = {}
        with Session(service.engine) as s:
            for email in ENROLLED:
                user = s.scalars(select(service.m.User).where(service.m.User.email == email)).first()
                secret, _ = service.two_step.start(s, user)
                codes = service.two_step.confirm(s, user, pyotp.TOTP(secret).now(), service.clock())
                assert codes, email
                service.two_step.row(s, user.id).last_step = 0
                secrets_out[email] = {'secret': secret, 'recovery_codes': codes}
            s.commit()
        Path(os.environ.get('HOSTED_E2E_OWNERS_FILE') or Path(server.FOLDER, 'e2e_owners.json')).write_text(json.dumps(secrets_out))
        login = c.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD, 'code': pyotp.TOTP(secrets_out['owner@example.com']['secret']).now()}, headers=ORIGIN)
        assert login.status_code == 200, login.text
        dataset = c.post('/api/datasets', files={'file': ('shop-orders.csv', CSV, 'text/csv')}, headers=ORIGIN).json()
        mapping = {'quantity': 'BIGINT', 'revenue': 'DOUBLE'}
        board = c.post('/api/dashboards', json={'title': 'Weekly numbers'}, headers=ORIGIN).json()
        widgets = []
        for question, title in (('What is the total revenue?', 'Total revenue'), ('Total revenue by region', 'Revenue by region')):
            run = c.post('/api/analyst/runs', json={'dataset_id': dataset['id'], 'question': question, 'type_mapping': mapping}, headers=ORIGIN).json()
            for _ in range(80):
                if c.get('/api/analyst/runs/' + run['id']).json()['status'] == 'succeeded':
                    break
                time.sleep(.25)
            chart = c.post('/api/saved-charts', json={'run_id': run['id'], 'title': title, 'persist_snapshot_confirmed': True}, headers=ORIGIN)
            assert chart.status_code == 201, chart.text
            widgets.append({'chart_id': chart.json()['id'], 'kind': 'chart', 'title': title, 'width': 6, 'height': 4})
        put = c.put('/api/dashboards/' + board['id'], json={'title': 'Weekly numbers', 'description': '', 'revision': board['revision'], 'filters': [], 'widgets': widgets}, headers=ORIGIN)
        assert put.status_code == 200, put.text
    with Session(service.engine) as s:
        for email in ENROLLED:
            s.get(service.m.UserTotp, s.scalars(select(service.m.User).where(service.m.User.email == email)).first().id).last_step = 0     # every time step is free again for the browser tests
        s.commit()
    print('hosted e2e workspace ready in', server.FOLDER)


if __name__ == '__main__':
    main()
