"""Phase 9 nullable audit/source and snapshot-format columns; no historical backfill."""
import shutil,sqlite3
from pathlib import Path
from sqlalchemy import inspect,text
from .persistence import utcnow

ADDITIONS={'dataset_audit':{'actor':'VARCHAR(20)'},'dataset_revisions':{'snapshot_format':'VARCHAR(20)','uncompressed_size_bytes':'INTEGER'}}
def migrate(engine,root):
    inspector=inspect(engine)
    missing={table:{name:typ for name,typ in columns.items() if name not in {c['name'] for c in inspector.get_columns(table)}} for table,columns in ADDITIONS.items() if inspector.has_table(table)}
    missing={t:cols for t,cols in missing.items() if cols}
    if not missing:return
    if engine.dialect.name!='sqlite' or not engine.url.database or not Path(engine.url.database).is_file():raise RuntimeError('Phase 9 migration requires a full storage and consistent SQLite backup before DDL.')
    folder=root/'backups'/('polish-v9-'+utcnow().replace(':','-'));folder.mkdir(parents=True)
    shutil.copytree(root,folder/'storage',ignore=shutil.ignore_patterns('backups','catalog.sqlite*'),dirs_exist_ok=True)
    with sqlite3.connect(engine.url.database) as source,sqlite3.connect(folder/'catalog.sqlite') as target:source.backup(target)
    with engine.begin() as connection:
        for table,columns in missing.items():
            for name,typ in columns.items():connection.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {typ} NULL'))
