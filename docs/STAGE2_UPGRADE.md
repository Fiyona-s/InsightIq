# Upgrading your existing workspace to Projects (owner-run)

This adds the new tables for remembered column types (fix 3a) and Projects (Stage 2) to your existing workspace. **Nothing in this redesign has been applied to your original workspace.** You run these steps yourself, when you choose.

What it changes:

| Version | New table(s) | Existing rows |
|---|---|---|
| 10 | `confirmed_column_types` | untouched |
| 11 | `projects`, `project_items` | untouched; **no mapping rows are written**, so every existing dataset, dashboard, question, model and saved chart is in the **Default project** |

## Steps

1. **Make your own backup while the app is running.** The existing script queries the running app, refuses if work is in progress, pauses the API container only for the copy, and writes a full copy plus a consistent SQLite snapshot to a folder on your Mac:
   ```sh
   python3 backend/scripts/backup_workspace.py --destination ~/InsightIQ-backups/pre-projects
   ```
2. **Build the new image** (building does not start anything) and **stop the app:**
   ```sh
   docker compose build api
   docker compose stop
   ```
3. **Dry run** in a one-off container, with your backup folder mounted read-only (writes nothing; shows the tables it would add):
   ```sh
   docker compose run --rm -v ~/InsightIQ-backups/pre-projects:/owner-backup:ro api \
     python scripts/upgrade_projects.py --data-dir /data --backup /owner-backup --dry-run
   ```
4. **Upgrade:**
   ```sh
   docker compose run --rm -v ~/InsightIQ-backups/pre-projects:/owner-backup:ro api \
     python scripts/upgrade_projects.py --data-dir /data --backup /owner-backup
   ```
   Each migration also writes an automatic backup first (`/data/backups/confirmed-types-v10-…`, `/data/backups/projects-v11-…`). The script then verifies that every pre-existing catalog row and storage file is byte-identical, and exits with `VERIFICATION FAILED` if not.
5. **Start the app** with the new code: `docker compose build web && docker compose up -d`. If you skip step 4, the new app creates these tables on startup instead, with the same automatic backups. Running the script first lets you check the result while the app is stopped.

The script is safe to run twice: the second run reports "Nothing to do."

## Undo

Restore your own backup from step 1, or the earliest automatic one: with the app stopped, copy `backups/confirmed-types-v10-…/catalog.sqlite` back to `catalog.sqlite` (it predates both new versions; `projects-v11-…` undoes only Projects). No existing row was changed, so removing the three new tables also returns the catalog to its previous content.

## What Default means

Projects use a "virtual Default": anything not explicitly assigned to a project belongs to the Default project. Your existing workspace therefore opens with all of its data in Default, exactly as before. New projects start empty. You can rename Default but not archive or delete it.
