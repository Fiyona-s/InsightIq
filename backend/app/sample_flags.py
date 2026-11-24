"""Owner-set "sample data" flag (Stage 6, item 2, approved 2026-11-21).

A dataset is a sample only when the owner marks it. Nothing is inferred from a file name, nothing is
backfilled (Rule 6) and existing tables and rows are never rewritten: one row per marked dataset in a
NEW additive table. The flag only changes what "Hide sample datasets" hides.
"""
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import Boolean, Column, String, inspect

from .persistence import utcnow

TABLE = 'dataset_sample_flags'


def register(base):
    class DatasetSampleFlag(base):
        __tablename__ = TABLE
        dataset_id = Column(String(36), primary_key=True)
        is_sample = Column(Boolean, nullable=False)
        set_at = Column(String(40), nullable=False)
    return DatasetSampleFlag


def migrate(engine, root, model):
    """Additive: create the table once, after a full storage + consistent SQLite backup."""
    if inspect(engine).has_table(TABLE):
        return
    if inspect(engine).has_table('datasets'):
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Sample-flag migration requires a verified SQLite backup before DDL.')
        folder = Path(root) / 'backups' / ('sample-flags-v13-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    model.__table__.create(engine, checkfirst=True)
