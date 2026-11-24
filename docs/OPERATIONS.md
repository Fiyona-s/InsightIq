# InsightIQ local operations

This procedure applies to the tested **single-user Docker/SQLite workspace** (`project-api-1`, `/data/catalog.sqlite`, the Compose data volume). Backups contain customer data, questions, definitions, indexes, models and predictions. Keep them private. `.backups/`, `.env` and live `data/` are excluded from source control.

## Full backup: the phase-baseline procedure

Stop new user work and wait for Analyst, Evaluation and AutoML jobs to finish. The script checks dependency admission, copies the entire data directory while the API is briefly paused, always unpauses it, and creates a consistent SQLite backup using SQLite's backup API. It never overwrites an existing backup directory.

From the repository root:

```sh
python3 backend/scripts/backup_workspace.py \
  --container project-api-1 \
  --api http://localhost:8000 \
  --destination ".backups/manual-$(date -u +%Y%m%dT%H%M%SZ)"
```

The same sequence was used for phase baselines: read-only dataset/dependency checks; `docker pause`; `docker cp CONTAINER:/data/. BACKUP/data`; `docker unpause` in `finally`; host SQLite `source.backup(target)` to `catalog-consistent.sqlite`; retain `datasets-before.json` and `preexisting-audit.json`. This assumes the default catalog path. A custom `DATABASE_URL` requires an explicitly adapted/verified database backup; do not assume this script covers a different server or path.

A backup contains:

- `data/`: full storage copy, including catalog side files and retained internal backups.
- `catalog-consistent.sqlite`: the recovery catalog created with SQLite's backup API.
- `datasets-before.json`: original dataset metadata/count baseline.
- `preexisting-audit.json`: existing local audit entries and identity/count checks.

Phase 9's pre-migration baseline is in the final review; the current real-workspace baseline is `docs/baseline/baseline-2026-11-20.json` (`sh docs/baseline/check.sh` reports UNCHANGED or lists differences). Keep a copy of your newest backup on a drive that is not this computer.

## Verify a backup

The script checks `PRAGMA integrity_check`. Additionally verify the expected catalog rows, schema version and SHA-256 hashes of all dataset/model/index/prediction/snapshot files against the baseline you are preserving. The phase evidence scripts compare original columns/row payloads and all original non-backup files, rather than trusting dataset counts alone.

```sh
python3 - /absolute/path/to/backup <<'PY'
import pathlib, sqlite3, sys
root = pathlib.Path(sys.argv[1])
with sqlite3.connect(root / 'catalog-consistent.sqlite') as db:
    print(db.execute('PRAGMA integrity_check').fetchone()[0])
    print(db.execute('SELECT version FROM schema_migrations ORDER BY version').fetchall())
    print('datasets:', db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0])
assert (root / 'data').is_dir()
PY
```

Counts alone do not establish a complete backup. Keep the catalog and storage from the **same capture**. A stored snapshot hash covers uncompressed bytes: decompress gzip snapshots before hashing; do not compare a gzip container's hash to the revision's `sha256`. `snapshot_format=NULL` means an existing raw snapshot; `gzip` identifies a new compressed one.

## Restore without destroying the original volume

1. Stop the application (`docker compose stop`, not `down -v`). Keep the original volume and backup intact.
2. Copy `BACKUP/data/` into a **new empty staging directory**, preserving all files. Replace the staging `catalog.sqlite` with `BACKUP/catalog-consistent.sqlite`. Remove `catalog.sqlite-wal` and `catalog.sqlite-shm` **from that new staging copy only**, so stale copied journal pages cannot override the consistent snapshot.
3. Verify integrity, catalog counts/payloads and storage hashes in staging. Do not mix files from another date.
4. Import staging into a **new named Docker volume**, retaining the original volume. Use the application's numeric owner/user permissions (`insight` in the current image). Point an explicit Compose override at the new volume mounted at `/data`, review the override, then start the application.
5. Perform GET-only checks first: dataset counts, historical run/dashboard/model records, snapshot availability and provider configuration. Compare the same manifest after startup before admitting user work.

For a volume override, the target path `/data` must resolve to the restored volume, not a second unrelated mount. Confirm the actual mount with `docker inspect` before starting work. Never copy a backup over a running SQLite database. Preserve the application image/version used with the backup if exact rollback is required.

A current application started on an older catalog applies its additive migrations to the restored copy. Exact **pre-migration schema rollback** requires the matching earlier application image and full earlier backup. An older application cannot restore new gzip snapshots correctly merely because it can ignore added columns. There is no destructive down-migration or in-place historical rewrite.

## Migrations and automatic backups

Migration versions live in `schema_migrations`. The current version is **13**. Version 12 (saved answers, table `analyst_run_results`) and 13 (owner-set sample flag, table `dataset_sample_flags`) are registered since Stage 6; before that the real workspace listed 1 to 11, because the saved-answers step had its own backup (`analyst-results-v12-…`) but no registry row. Each table and its row are created together, after an automatic backup; an existing table without its row only gets the row. The real workspace picked up rows 12 and 13 on 2026-11-21 (backup `.backups/pre-stage6-restart-20261121T112931Z`). Existing-catalog migrations that require structural changes fail closed if their required SQLite backup cannot be obtained. Storage copies exclude recursive `backups/` and catalog files; a separate consistent SQLite backup accompanies them.

Internal backup locations inside the data volume include:

| Migration | Directory prefix under `/data/backups/` |
|---|---|
| Dataset lifecycle | `lifecycle-…` |
| Dataset revisions | `revisions-v6-…` |
| Knowledge review | `knowledge-v7-…` |
| Dashboard snapshot history | `dashboards-v8-…` |
| Audit source / snapshot format | `polish-v9-…` |
| Remembered column types | `confirmed-types-v10-…` |
| Projects | `projects-v11-…` |
| Saved answers | `analyst-results-v12-…` |
| Sample flag | `sample-flags-v13-…` |
| Earlier analyst step | `analyst-v5-…` |

Version 9 adds nullable `dataset_audit.actor`, `dataset_revisions.snapshot_format` and `dataset_revisions.uncompressed_size_bytes`. It does not backfill historical entries or recompress snapshots. Its automatic backup is made **before ALTER TABLE**. The only added original-workspace row is the migration registry entry; original audit actors remain NULL.

## Disk usage and retention

- Dataset snapshots: at most **20 retained** snapshots per dataset, with the existing oldest-first pruning and restore protection. New snapshots use gzip. Hashes describe uncompressed data; `size_bytes` describes the actual stored snapshot size; the new nullable uncompressed-size field bounds decompression. Existing raw snapshots remain untouched.
- The synthetic 2,400-row, 12-column, 20-revision measurement used **59.984 MiB uncompressed versus 7.840 MiB gzip** in the same run. The earlier Phase 4 run measured 60.484 MiB. DuckDB physical allocation can differ between runs; this is not a claim that old snapshots were recompressed. [Measured evidence](phase9/compression-measurement.json).
- Dashboard history retains the current snapshot plus up to three previous snapshots per widget, with existing payload limits. Removing a widget and deleting a dashboard have different history lifetimes; see Phase 6.
- FAISS/index manifests are bounded, hashed local caches. Normal Analyst result rows have a bounded in-memory TTL; saved charts, selected thread summaries and model/prediction artifacts persist separately.
- Rejected drafts are removed only by explicit **Clear rejected drafts**, exact-count confirmation and the existing writable-dataset guard. Approved provenance is kept. There is no automatic 200-entry cap.
- SQLite pruning/deletion normally frees reusable pages; it does not promise a smaller database file. Audit records are not automatically pruned.

## Safe cleanup

Use the UI/API lifecycle and experiment/prediction deletion controls so dependency checks, confirmations and history rules apply. Prefer archive when source data is still needed. Existing models can require the original active source fingerprint for new predictions.

Do not manually delete DuckDB files, available snapshot files, catalog rows, model artifacts or prediction files. Do not edit serialized provenance. Do not remove the only verified backup. A dataset deletion does not grant permission to delete its retained historical models/results.

Temporary browser/test workspaces and build outputs can be removed when their processes are stopped and review evidence is retained. Review older **backup copies** for cleanup only after a separate complete backup has been verified. Never run a broad cleanup against the live `/data` directory. Snapshot pruning and explicit owner actions are separate from backup retention.

## Troubleshooting

- Missing provider/model/key: local data views, AutoML and offline replay remain separate; AI drafting/question generation need a valid compatible provider. No canned answer replaces a provider failure.
- Missing embedding assets: explicitly provision the pinned assets; retrieval reports degraded status, without fabricating vectors.
- Sandbox unavailable: queries fail closed. Use a supported macOS/Linux environment or the Compose deployment; do not disable the guard to obtain a result.
- FX unavailable: source-currency formatting remains; conversion reports unavailable rather than fabricating a quote.
- Restore hash/format error: nothing is published. Keep the damaged snapshot and a backup for inspection; do not change its stored hash to make it pass.

## Corrections made 2026-11-21 (Stage 5)

- Schema version: was "9"; the real workspace registry lists 1 to 11 (see above). Not 12: the 12th step has no registry row.
- Backup directory table was missing four prefixes (`analyst-v5`, `confirmed-types-v10`, `projects-v11`, `analyst-results-v12`); added.
- "pre-v9 catalog" wording replaced by "older catalog"; later migrations are additive too.
- Baseline reference was Phase 9 only; the current baseline file is now named.
- Missing advice: keep an external copy of the newest backup; added here and on the Backup info page.
- The same restore steps were rehearsed on a throwaway copy on 2026-11-21 and match the Backup info page.
