"""Operator tool for a workspace's accounts (Accounts A1 and A4).

Commands: create-company (A1), unlock, reset-2fa, reset-link (A4). Terminal only; a password is never an argument.
Every A4 command writes an audit event ("operator") and needs --backup when the workspace already holds data.

  python3 scripts/accounts_cli.py unlock     --data-dir <folder> --email person@example.com [--backup <folder>]
  python3 scripts/accounts_cli.py reset-2fa  --data-dir <folder> --email owner@example.com  [--backup <folder>]   (they enrol again at next sign-in)
  python3 scripts/accounts_cli.py reset-link --data-dir <folder> --email person@example.com [--backup <folder>]   (prints a one-time link fragment, once)

First command, from A1:

    python3 scripts/accounts_cli.py create-company --data-dir <folder with catalog.sqlite> \
        --name "Acme Ltd" --owner-email owner@example.com [--owner-name "A. Owner"] [--backup <your backup folder>] [--dry-run]

Safety:
  * The owner's password is TYPED at a terminal prompt (twice). It is never accepted as an argument, an
    environment variable, a file or a pipe, so it cannot end up in shell history or on disk.
  * Refuses on a workspace that already holds datasets unless --backup points at your own backup folder
    (backend/scripts/backup_workspace.py) that contains a catalog backup (CLAUDE.md rule 1).
  * Adds the account tables (migrations v14 and v15, each after an automatic backup) and one company and one
    owner. It never rewrites an existing row; it verifies that afterwards.
  * One workspace belongs to one company: a second call is refused.
  * The owner must change this password at first sign-in.
This tool is for the operator. It is not run by the application and was NOT run on the real workspace.
"""
import argparse
import getpass
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, inspect, select  # noqa: E402
from sqlalchemy.orm import Session, declarative_base  # noqa: E402

from app import auth  # noqa: E402
from app.persistence import register_phase4  # noqa: E402

AUTH_TABLES = set(auth.V14_TABLES) | set(auth.V15_TABLES) | set(auth.V16_TABLES) | set(auth.V17_TABLES)


def other_rows(catalog, skip_tables, skip_versions):
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        return [line for line in db.iterdump()
                if not any(f'"{t}"' in line or f'TABLE {t}' in line or f'ix_{t}' in line for t in skip_tables)
                and not line.startswith(tuple(f'INSERT INTO "schema_migrations" VALUES({v},' for v in skip_versions))]


def operator_command(args):
    root = args.data_dir.resolve()
    catalog = root / 'catalog.sqlite'
    if not catalog.is_file():
        sys.exit(f'No catalog at {catalog}. Start the app once so it creates the workspace, then run this again.')
    engine = create_engine(f'sqlite:///{catalog}')
    inspector = inspect(engine)
    if not inspector.has_table('schema_migrations') or not inspector.has_table('users'):
        sys.exit('This workspace has no accounts yet. Run create-company first.')
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        datasets = db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0]
    if datasets and not (args.backup and args.backup.is_dir() and any(args.backup.rglob('catalog*.sqlite'))):
        sys.exit('This workspace already holds data. Make your own backup first and pass --backup <folder> (CLAUDE.md rule 1).')
    base = declarative_base()
    migration_model, _ = register_phase4(base)
    models = auth.register(base)
    auth.ensure_schema(engine, root, base, migration_model, models)           # adds the A4 tables (after a backup) if this workspace predates them
    service = auth.AuthService(engine, models, auth.AuthConfig())
    try:
        email = auth.normalize_email(args.email)
    except auth.PolicyError as exc:
        sys.exit(str(exc))
    from app import people
    with Session(engine) as s:
        user = s.scalars(select(models.User).where(models.User.email == email)).first()
        if user is None:
            sys.exit('No person with that email in this workspace.')
        print(f'Workspace: {root}\nPerson: {user.email} ({user.role})')
        if args.dry_run:
            print('Dry run: no changes written.')
            return 0
        if args.command == 'unlock':
            people.unlock_account(service, s, user.email)
            service._audit(s, 'user_unlocked', None, 'operator', user.id, user.email, 'by the operator')
            print('Done. The failed sign-ins of this account are cleared.')
        elif args.command == 'reset-2fa':
            if user.role != 'owner':
                sys.exit('Only owners use the second step.')
            service.two_step.reset(s, user.id)
            service._revoke_user(s, user.id)
            service._audit(s, 'two_step_reset', None, 'operator', user.id, user.email, 'by the operator')
            print('Done. Their second step and recovery codes are forgotten and their sessions ended; they set it up again at the next sign-in.')
        else:
            if not user.active:
                sys.exit('That person is deactivated. Reactivate them in the People page first.')
            token = people.issue_link(service, s, user, None)
            service._audit(s, 'reset_link_created', None, 'operator', user.id, user.email, 'by the operator')
            print('One-time link (shown once, valid for 24 hours). Add it after the address of the app, with a # in front:')
            print(f'    #accept={token}')
        s.commit()
    engine.dispose()
    return 0


def main(argv=None, prompt=getpass.getpass, require_tty=True):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('create-company', help='create the company and its first owner')
    create.add_argument('--data-dir', required=True, type=Path)
    create.add_argument('--name', required=True)
    create.add_argument('--owner-email', required=True)
    create.add_argument('--owner-name', default='')
    create.add_argument('--backup', type=Path, help='your own backup folder; required when the workspace already holds data')
    create.add_argument('--dry-run', action='store_true')
    for name, help_text in (('unlock', 'clear the failed sign-ins of one account'), ('reset-2fa', "forget an owner's second step so they set it up again"),
                            ('reset-link', 'create a one-time link for one person (shown once)')):
        op = sub.add_parser(name, help=help_text)
        op.add_argument('--data-dir', required=True, type=Path)
        op.add_argument('--email', required=True)
        op.add_argument('--backup', type=Path)
        op.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    if args.command != 'create-company':
        return operator_command(args)

    root = args.data_dir.resolve()
    catalog = root / 'catalog.sqlite'
    if not catalog.is_file():
        sys.exit(f'No catalog at {catalog}. Start the app once so it creates the workspace, then run this again.')
    engine = create_engine(f'sqlite:///{catalog}')
    inspector = inspect(engine)
    if not inspector.has_table('schema_migrations') or not inspector.has_table('datasets'):
        sys.exit('This folder is not an initialised workspace. Start the app once first.')
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        versions = sorted(r[0] for r in db.execute('SELECT version FROM schema_migrations'))
        datasets = db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0]
    if versions and max(versions) < 13:
        sys.exit('This workspace is older than version 13. Upgrade it with the earlier steps first (docs/OPERATIONS.md).')
    if datasets and not (args.backup and args.backup.is_dir() and any(args.backup.rglob('catalog*.sqlite'))):
        sys.exit('This workspace already holds data. Make your own backup first and pass --backup <folder> (CLAUDE.md rule 1).')
    try:
        email = auth.normalize_email(args.owner_email)
    except auth.PolicyError as exc:
        sys.exit(str(exc))
    existing = inspector.has_table('companies') and any(True for _ in sqlite3.connect(f'file:{catalog}?mode=ro', uri=True).execute('SELECT 1 FROM companies'))
    if existing:
        sys.exit('This workspace already has a company. One workspace belongs to one company.')
    print(f'Workspace: {root}\nApplied versions: {versions}\nDatasets already present: {datasets}\nWill create: company "{args.name.strip()}" and owner {email}')
    if args.dry_run:
        print('Dry run: no changes written.')
        return 0
    if require_tty and not sys.stdin.isatty():
        sys.exit('The password must be typed at a terminal; it is never read from a pipe or a file.')
    first = prompt('Owner password (typed, not shown): ')
    if prompt('Repeat the password: ') != first:
        sys.exit('The two passwords differ. Nothing was written.')
    try:
        auth.validate_password(first, email)
    except auth.PolicyError as exc:
        sys.exit(f'Password refused: {exc} Nothing was written.')

    base = declarative_base()
    migration_model, _ = register_phase4(base)
    models = auth.register(base)
    skip_tables = set(AUTH_TABLES)          # the only tables this tool writes to (empty or about to be added)
    skip_versions = [14, 15, 16, 17]
    before = other_rows(catalog, skip_tables, skip_versions)
    auth.ensure_schema(engine, root, base, migration_model, models)
    service = auth.AuthService(engine, models, auth.AuthConfig())
    with Session(engine) as s:
        company = service.create_company(s, args.name)
        first_owner = service.create_user(s, company.id, email, args.owner_name or email, 'owner', first, must_change=True)
        s.flush()
        service._audit(s, 'company_created', None, 'operator', first_owner.id, email, 'first owner')
        s.commit()
    engine.dispose()
    after = other_rows(catalog, skip_tables, skip_versions)
    if before != after:
        sys.exit('VERIFICATION FAILED: existing data differs. Restore from your backup and report this.')
    with sqlite3.connect(f'file:{catalog}?mode=ro', uri=True) as db:
        now = sorted(r[0] for r in db.execute('SELECT version FROM schema_migrations'))
    print(f'Done. Versions now {now}. Company and owner created; the owner must change the password at first sign-in.')
    print(f'Verified: {len(before)} existing catalog statements unchanged.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
