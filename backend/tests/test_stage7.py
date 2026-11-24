"""Stage 7: startup runs each migration step once (the duplicate lifecycle/UX calls were removed)."""
import sqlite3

from fastapi.testclient import TestClient

import app.main as main
from tests.test_phase4 import make_app


def test_startup_runs_lifecycle_and_ux_migrations_once_and_keeps_the_schema(tmp_path, monkeypatch):
    calls = {'lifecycle': 0, 'ux': 0}
    real_lifecycle, real_ux = main.migrate_lifecycle, main.migrate_ux

    def lifecycle(*a, **k):
        calls['lifecycle'] += 1
        return real_lifecycle(*a, **k)

    def ux(*a, **k):
        calls['ux'] += 1
        return real_ux(*a, **k)

    monkeypatch.setattr(main, 'migrate_lifecycle', lifecycle)
    monkeypatch.setattr(main, 'migrate_ux', ux)
    with TestClient(make_app(tmp_path)):
        pass
    # Fresh database: the lifecycle step is skipped when no catalog exists yet; the UX step runs exactly once.
    assert calls['ux'] == 1 and calls['lifecycle'] <= 1
    with sqlite3.connect(tmp_path / 'catalog.sqlite') as db:
        columns = {r[1] for r in db.execute('PRAGMA table_info(datasets)')}
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {'display_name', 'archived_at', 'archived_reason'} <= columns
    assert {'dataset_references', 'dataset_audit', 'analyst_feedback'} <= tables
    # A second start on the same catalog changes nothing and still runs each step once.
    calls.update(lifecycle=0, ux=0)
    with TestClient(make_app(tmp_path)):
        pass
    assert calls == {'lifecycle': 1, 'ux': 1}
