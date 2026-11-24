"""Remembered column-type confirmations (approved fix 3a, 2026-11-15).

One row per dataset in a NEW additive table. Existing tables and rows are never rewritten.
The SQL guard, sandbox worker and comparator are untouched: a remembered mapping is only
returned to the browser as a pre-filled, already-confirmed choice. Every question still
sends its own explicit type_mapping, validated exactly as before.
"""
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import Column, String, Text, inspect

from .persistence import utcnow

ANALYSIS_TYPES = {'VARCHAR', 'BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP', 'BOOLEAN'}
TABLE = 'confirmed_column_types'


def register(base):
    class ConfirmedColumnTypes(base):
        __tablename__ = TABLE
        dataset_id = Column(String(36), primary_key=True)
        type_mapping = Column(Text, nullable=False)
        # Column names + storage types at confirmation time; a different schema invalidates it.
        schema_signature = Column(String(64), nullable=False)
        confirmed_at = Column(String(40), nullable=False)
        actor = Column(String(20), nullable=False)  # local source label, not an authenticated identity
    return ConfirmedColumnTypes


def migrate(engine, root, model):
    """Additive: create the table once, after a full storage + consistent SQLite backup."""
    if inspect(engine).has_table(TABLE):
        return
    if inspect(engine).has_table('datasets'):
        if engine.dialect.name != 'sqlite' or not engine.url.database or not Path(engine.url.database).is_file():
            raise RuntimeError('Confirmed-types migration requires a verified SQLite backup before DDL.')
        folder = Path(root) / 'backups' / ('confirmed-types-v10-' + utcnow().replace(':', '-'))
        folder.mkdir(parents=True)
        shutil.copytree(root, folder / 'storage', ignore=shutil.ignore_patterns('backups', 'catalog.sqlite*'))
        with sqlite3.connect(engine.url.database) as source, sqlite3.connect(folder / 'catalog.sqlite') as target:
            source.backup(target)
    model.__table__.create(engine, checkfirst=True)


def schema_signature(columns):
    """columns: [{'name':..., 'type':...}] as stored for the dataset."""
    canonical = json.dumps([[c['name'], c.get('type')] for c in columns], separators=(',', ':'))
    return hashlib.sha256(canonical.encode()).hexdigest()


def validate(type_mapping, columns):
    names = [c['name'] for c in columns]
    if set(type_mapping) != set(names):
        raise ValueError('Confirm a type for every column of this dataset, and only those columns.')
    bad = sorted(k for k, v in type_mapping.items() if v not in ANALYSIS_TYPES)
    if bad:
        raise ValueError('Unsupported analysis type for: ' + ', '.join(bad))
    return {name: type_mapping[name] for name in names}
