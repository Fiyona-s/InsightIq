"""Owner-run upgrade: add the additive Stage 1/2 tables to an EXISTING workspace.

Adds, without rewriting any existing row:
  v10  confirmed_column_types   (remembered column-type confirmations, fix 3a)
  v11  projects, project_items  (Projects, "virtual Default": no mapping rows are written)
  v12  analyst_run_results      (saved answers; the table and its row are always created together)
  v13  dataset_sample_flags     (owner-set sample flag; no row is written for any existing dataset)
  v14  companies, users         (accounts core; empty; no company or user is created here)
  v15  sessions, login_attempts, password_resets (accounts core; empty)
  v16  audit_events             (accounts A4; empty, append-only)
  v17  user_totp, recovery_codes (accounts A4; empty)

Safety:
  * Refuses to run unless --backup points at your own backup folder (backend/scripts/backup_workspace.py).
  * Each migration also writes its own automatic backup under <data-dir>/backups/ before any DDL.
  * Verifies afterwards that every pre-existing table/row and every storage file is byte-identical.
  * --dry-run reports what would change and writes nothing.

Run it with the app STOPPED. See docs/STAGE2_UPGRADE.md. The redesign work never runs this itself.
"""
import argparse
import hashlib
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, inspect  # noqa: E402
from sqlalchemy.orm import declarative_base  # noqa: E402

from app import analyst_results, auth, confirmed_types, projects, sample_flags  # noqa: E402
from app.persistence import migrate as record_versions, register_phase4  # noqa: E402

NEW_TABLES = {'confirmed_column_types', 'projects', 'project_items', analyst_results.TABLE, sample_flags.TABLE, *auth.V14_TABLES, *auth.V15_TABLES, *auth.V16_TABLES, *auth.V17_TABLES}
NEW_VERSIONS = (10, 11, 12, 13, 14, 15, 16, 17)


def existing_dump(catalog, skip_tables, skip_versions):
    """Every catalog statement EXCEPT those of tables/registry rows this run is about to add.

    Tables or versions that already exist are part of the comparison, so they must be unchanged too."""
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        return [line for line in db.iterdump()
                if not any(f'"{t}"' in line or f'TABLE {t}' in line for t in skip_tables)
                and not any(f'ix_{t}' in line for t in skip_tables)
                and not line.startswith(tuple(f'INSERT INTO "schema_migrations" VALUES({v},' for v in skip_versions))]


def storage_hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*'))
            if p.is_file() and 'backups' not in p.relative_to(root).parts and not p.name.startswith('catalog.sqlite')}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data-dir', required=True, type=Path, help='workspace folder containing catalog.sqlite (Compose: /data)')
    parser.add_argument('--backup', required=True, type=Path, help='your own backup folder made before this upgrade')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    root = args.data_dir.resolve()
    catalog = root / 'catalog.sqlite'
    if not catalog.is_file():
        sys.exit(f'No catalog at {catalog}.')
    if not args.backup.is_dir() or not any(args.backup.rglob('catalog*.sqlite')):
        sys.exit(f'Backup folder {args.backup} not found or contains no catalog backup. Make one first.')
    engine = create_engine(f'sqlite:///{catalog}')
    tables = set(inspect(engine).get_table_names())
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        versions = sorted(r[0] for r in db.execute('SELECT version FROM schema_migrations'))
    missing = sorted(NEW_TABLES - tables)
    print(f'Catalog: {catalog}\nApplied versions: {versions}\nTables to add: {missing or "none"}')
    if not missing and set(NEW_VERSIONS) <= set(versions):
        print('Nothing to do.'); return 0
    if versions and max(versions) < 9:
        sys.exit('This workspace is older than version 9. Upgrade it with the earlier release first.')
    if args.dry_run:
        print('Dry run: no changes written.'); return 0
    skip_versions = [v for v in NEW_VERSIONS if v not in versions]
    before_rows, before_files = existing_dump(catalog, missing, skip_versions), storage_hashes(root)
    base = declarative_base()
    migration_model, _ = register_phase4(base)
    confirmed = confirmed_types.register(base)
    project, item = projects.register(base)
    confirmed_types.migrate(engine, root, confirmed)
    projects.migrate(engine, root, [project, item])
    results = analyst_results.register(base)
    flags = sample_flags.register(base)
    analyst_results.migrate(engine, root, results)
    sample_flags.migrate(engine, root, flags)
    account_models = auth.register(base)
    auth.migrate(engine, root, account_models)
    record_versions(engine, base, migration_model)
    engine.dispose()
    after_rows, after_files = existing_dump(catalog, missing, skip_versions), storage_hashes(root)
    if before_rows != after_rows or before_files != after_files:
        sys.exit('VERIFICATION FAILED: existing data differs. Restore from your backup and report this.')
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        versions = sorted(r[0] for r in db.execute('SELECT version FROM schema_migrations'))
        mapped = db.execute('SELECT COUNT(*) FROM project_items').fetchone()[0]
    print(f'Done. Versions now {versions}. project_items rows: {mapped} (all existing items are in the Default project).')
    print(f'Verified: {len(before_rows)} existing catalog statements and {len(before_files)} storage files unchanged.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
