"""Saved answers (Stage 3 final round, approved 2026-11-17).

Every successful question keeps its result with the question's own id, so reopening a chat shows the
answer again instead of "result rows are no longer cached". One row per run in a NEW additive table;
existing tables and rows are never rewritten and old runs are not backfilled (Rule 6): a question
asked before this change keeps the old behaviour. Bounded: at most MAX_ROWS rows and MAX_BYTES per
answer, and only the newest KEEP answers are retained. Benchmark/evaluation runs are never stored.
"""
import json
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import Column, Integer, String, Text, delete, inspect, select
from sqlalchemy.orm import Session

from .persistence import utcnow

TABLE = 'analyst_run_results'
MAX_ROWS = 1000
MAX_BYTES = 1024 * 1024
KEEP = 500


def register(base):
    class AnalystRunResult(base):
        __tablename__ = TABLE
        run_id = Column(String(36), primary_key=True)
        payload = Column(Text, nullable=False)
        row_count = Column(Integer, nullable=False)
        saved_at = Column(String(40), nullable=False)
    return AnalystRunResult


def migrate(engine, root, model):
    """Additive: create the table once, after a full storage + consistent SQLite backup."""
    if inspect(engine).has_table(TABLE):
        return
    if inspect(engine).has_table('datasets'):
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Saved-answers migration requires a verified SQLite backup before DDL.')
        folder = Path(root) / 'backups' / ('analyst-results-v12-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    model.__table__.create(engine, checkfirst=True)


class ResultStore:
    def __init__(self, engine, model):
        self.engine, self.model = engine, model

    def save(self, run_id, result):
        """Best effort: a failure here must never fail the question itself."""
        try:
            if len(result.get('rows', [])) > MAX_ROWS:
                return False
            raw = json.dumps(result)
            if len(raw.encode()) > MAX_BYTES:
                return False
            with Session(self.engine) as session:
                session.merge(self.model(run_id=str(run_id), payload=raw, row_count=int(result.get('row_count', 0)), saved_at=utcnow()))
                session.commit()
                extra = session.scalars(select(self.model.run_id).order_by(self.model.saved_at.desc()).offset(KEEP)).all()
                if extra:
                    session.execute(delete(self.model).where(self.model.run_id.in_(extra)))
                    session.commit()
            return True
        except Exception:
            return False

    def has(self, run_id):
        with Session(self.engine) as session:
            return session.get(self.model, str(run_id)) is not None

    def get(self, run_id):
        with Session(self.engine) as session:
            row = session.get(self.model, str(run_id))
            return json.loads(row.payload) if row else None
