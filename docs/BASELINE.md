# Real workspace baseline

**2026-11-23 (upgrade to the P7 build, owner-approved):** backup `.backups/pre-upgrade-20261123` (verified identical, integrity ok) and `../InsightIQ_pre_upgrade.zip`; migrations 14-17 applied (additive: eight new empty account tables, schema registry 13 to 17); every pre-existing table row, dataset file, model and dashboard identical to the backup; record: [baseline/baseline-2026-11-23.json](baseline/baseline-2026-11-23.json), upgrade evidence in docs/p7/upgrade-before.json and upgrade-after.json.

**2026-11-23:** older backups and snapshots pruned 2026-11-23, kept newest two (`.backups/pre-upgrade-20261123`, `.backups/pre-p7-20261122`; zips `InsightIQ_pre_cleanup.zip`, `InsightIQ_pre_upgrade.zip`). Keep archives: `../InsightIQ_FINAL_keep_code.zip`, `../InsightIQ_FINAL_keep_data.zip` (checksums in `../InsightIQ_FINAL_keep.sha256`); restore steps in [RESTORE_FROM_ZIP.md](RESTORE_FROM_ZIP.md).

## Current baseline: 2026-11-20 (read-only)

**Why a new baseline.** The owner removed the old "never modify the original workspace" rule (2026-11-17) and replaced it on 2026-11-20 with: back up before any change to the real workspace; never run the owner upgrade script without that backup; Docker may be used for checks and upgrades only after the backup exists. Since the 2026-11-15 baseline the real workspace was **upgraded to the Stage 3 build** (2026-11-17, backup `.backups/pre-stage3-upgrade-20261117`), used through the new app (including a project "QA walkthrough - keep" that must be kept), cleaned of 20 unanswered questions and some wrong QA answers at the owner's request (backup `.backups/pre-cleanup-20261117`), and re-checked with the live QA walkthrough on 2026-11-20. Backup taken before today's work: `.backups/pre-reconcile-20261120`. So the 2026-11-15 numbers no longer describe the workspace; this section does.

**How it was read (no writes).** The app containers were stopped (`docker compose stop`) so the files were consistent, then a throwaway container from the `project-api` image ran [baseline/probe.py](baseline/probe.py) with the volume mounted **read-only** (`:ro`), a `--read-only` root filesystem, `--network none` and `--rm`. SQLite was opened with `mode=ro`; file hashes are SHA-256 of raw bytes; `backups/` and `catalog.sqlite*` are excluded from the storage list. The app was started again afterwards. Full record: [baseline/baseline-2026-11-20.json](baseline/baseline-2026-11-20.json) (157 storage-file hashes).

**Re-check at any time:** `sh docs/baseline/check.sh` compares the real workspace with this record (a full read-only comparison when Docker runs; stop the app first for a consistent read). A "CHANGED" result is expected after normal use of the app; record a new baseline when that is intended.

### Counts

| Item | 2026-11-15 | **2026-11-20** |
|---|---:|---:|
| Datasets | 13 | **15** |
| Analyst runs (questions) | 21 | **80** |
| Saved answers (new table) | — | **56** |
| Answer feedback | 0 | **0** |
| AutoML experiments | 6 | **16** |
| Trained models | 19 | **60** |
| Saved predictions | 14 | **14** |
| Evaluation jobs | 3 | **3** |
| Benchmark installs | 1 | **1** |
| Dashboards | 1 | **2** |
| Saved charts | 4 | **10** |
| Dashboard widget snapshots | 2 | **8** |
| Dataset audit entries | 3 | **6** |
| Dataset references | 0 | **1** |
| Dataset revisions | 0 | **2** |
| Knowledge state rows | 9 | **11** |
| Knowledge examples | 1 | **1** |
| Knowledge drafts | 0 | **105** |
| Knowledge review examples | 0 | **0** |
| Schema migrations applied | 9 | **11** |
| Confirmed column types (new table) | — | **2** |
| Project items (new table) | — | **3** |
| Projects (new table) | — | **1** |
| Storage files (excluding backups and catalog) | 102 | **157** |

### Checksums (2026-11-20)

| What | SHA-256 |
|---|---|
| Catalog, logical (`iterdump` of the read-only catalog) | `591463b390b4971a1cd909ac51c5c8857e1b60e0ecd41cfee9b4ce7750680b08` |
| Catalog file bytes (`catalog.sqlite`) | `9af900080a2f3ba315dde0446428200194c51d65f177f05427aa70880d6e5526` |
| Dashboard `QA dashboard` payload (id `1acdb9a5-8712-4c0a-808e-a560ec08d4b4`) | `8243c7bbc0cfa66cab82be50c92f1d893550e53ebf6e6de5dd156a81bbf99b4b` |
| Dashboard `Retail Sales Overview` payload (id `bae47ed5-b60a-4573-ac83-e77e1fdfd6d3`) | `90b205e383f1c182eb8a80b90f73b07f9f6fad932d574fcf9bcffc2930c6528b` |
| 157 storage files | listed individually in the JSON record |

### Notes

- **Rule 8 is retired** (CLAUDE.md). The "Retail Sales Overview" dashboard no longer has its duplicate chart: it was removed through normal use of the original app before the upgrade. The probe `docs/baseline/rule8_probe.py` is kept only for history.
- Schema versions recorded: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]. The saved-answers table `analyst_run_results` (added 2026-11-17) is additive; no historical row was rewritten or backfilled (Rule 6).
- Datasets in the Default project and in the QA project are both counted above (the probe reads the whole catalog).
- **Most of the growth since 2026-11-15 comes from the QA walkthrough** (project "QA walkthrough - keep"): each live run adds about 25 questions, one Predictions experiment with its trained models and a batch of AI drafts that are only proposed (nothing is applied until approved; the pending drafts are in the QA project's Business definitions, AI drafts tab). The rest is the owner's normal use. Pinned tiles and saved answers made while the name-based currency default existed (2026-11-17 to 2026-11-19) keep the figures they were saved with (Rule 6).

---

# Previous baseline: 2026-11-15 (superseded)

## Original workspace baseline (recorded 2026-11-15, read-only)

Recorded **2026-11-15**, read-only. From now on this file replaces the numbers previously quoted in CLAUDE.md Section 5 and in earlier phase reviews.

## What "original workspace" means

The Docker Compose volume **`project_insightiq-data`**, mounted at `/data` by the `project-api` container (served at http://localhost:8080). The repository folder `data/` is an older, separate local workspace and is not the Rule 1 reference.

## How it was read (no writes)

- I did not start the app containers myself, but starting Docker Desktop for this read started them automatically (07:26:58–08:21:29 UTC on 2026-11-15; 0 writes, only reads from a VS Code browser tab; see STAGE1_REVIEW.md (removed) §3). The baseline matched before and after they were stopped. Docker has since been quit and must not be started again (Rule 1).
- A throwaway container from the existing `project-api:latest` image ran [baseline/probe.py](baseline/probe.py) with the volume mounted **read-only** (`:ro`), `--read-only` root filesystem, `--network none` and `--rm`.
- SQLite was opened with `mode=ro`. File hashes are SHA-256 of raw bytes. `backups/` and `catalog.sqlite*` are excluded from the storage list, as in every earlier preservation check.
- Full record: [baseline/baseline-2026-11-15.json](baseline/baseline-2026-11-15.json), including all 102 storage-file hashes.
- Re-check at any time: `sh docs/baseline/check.sh`. It **never starts Docker or any container** (Rule 1). The volume lives inside Docker Desktop's VM disk image (`Docker.raw`, ext4), which macOS cannot read without Docker. So the check verifies that the VM disk image's mtime, size and inode are unchanged since Docker Desktop was quit on 2026-11-15 09:11:23Z ([docker-disk-2026-11-15.json](baseline/docker-disk-2026-11-15.json)). Any Docker activity changes those values. The last *full* read of the volume (probe.py, read-only) was ~08:48Z on 2026-11-15 and matched this baseline. Between 08:48Z and 09:11Z only `docker logs`/`inspect`/`ps` were run (no container started).
- `probe.py` (full read-only read of the volume) needs Docker and must not be run unless the owner explicitly allows starting Docker.

## Counts

| Item | Count |
|---|---:|
| Datasets | **13** |
| Analyst runs (questions) | **21** |
| AutoML experiments | **6** |
| Trained models | **19** |
| Saved predictions | **14** |
| Evaluation jobs | **3** |
| Benchmark installs | 1 |
| Dashboards | **1** ("Retail Sales Overview", 3 widgets, including the 2 duplicate "by category" widgets, Rule 8) |
| Saved charts | 4 |
| Dashboard widget snapshots | 2 |
| Dataset audit entries | 3 |
| Knowledge state rows / examples | 9 / 1 |
| Dataset revisions | 0 |
| Schema migrations applied | 9 (versions 1–9) |
| Storage files (excluding backups and catalog) | **102** |

## Checksums

| What | SHA-256 |
|---|---|
| Dashboard "Retail Sales Overview" payload (`dashboards.payload` text, id `bae47ed5-b60a-4573-ac83-e77e1fdfd6d3`) | `1d1bca193fb2a9bea7ff079e3eb48b38a6a05a80affbf6b796ff6be3e90843a8` |
| Catalog, logical (`iterdump` of the read-only catalog) | `03c20c11d668a6458b79def96cbdf3bfdbbd36db0039f94ef1347bdc6980e4b5` |
| Catalog file bytes (`catalog.sqlite`) | `c0aecf6902f4a5b56b9e6b4c8340cac3591d938ef150d29585cc3f64ba4241a8` |
| 102 storage files | listed individually in the JSON record |

## Why these differ from the old numbers (important)

Full timeline with Docker-log evidence: [stage1/evidence/DASHBOARD_HASH_CHANGE.md](stage1/evidence/DASHBOARD_HASH_CHANGE.md).

The old Rule 1 numbers (18 runs, 97 storage files, dashboard SHA `eb491ae3…`) are out of date for two separate reasons:

1. **Phase 9 → product Stage 1 (2026-11-11):** storage was already 102 files, with 6 experiments and 19 models, in every product-stage preservation record (`docs/product-stage*/preservation*.json`). The "97 files" figure is from Phase 9.
2. **After the Stage 12 final check (2026-11-14, 03:06–03:12 UTC):** the deployed app was used through the UI (audit actor `user_ui`). This happened before this redesign work began, while Docker was later stopped. Changes compared with the Stage 12 record:
   - analyst runs 18 → 21 (questions at 03:06, 03:10, 03:11 UTC);
   - saved charts 3 → 4 (new "Total recognized revenue", 03:11 UTC);
   - a dashboard refresh at 03:12 UTC (audit entry 3) wrote 2 widget snapshots and points widget 3 to the new chart. **This is why the dashboard payload SHA changed from `eb491ae3…` to `1d1bca19…`**;
   - one knowledge search index was rebuilt (2 index files replaced). No other storage file changed.

   The two duplicate "by category" widgets remain. Nothing was deleted.

Nothing in this audit or redesign session wrote to the volume: Docker was off during the Stage 0 audit, and this baseline was taken read-only.

## Test baseline (Rule 9)

Measured before any Stage 1 change, on this machine, with a cleared environment (no provider key) and controlled fixtures. Logs are in [stage1/verification/](stage1/verification/). See the Stage 1 review for the numbers.

- **2026-11-22:** the real-workspace baseline moved to `baseline/baseline-2026-11-22.json` after the owner's own use of the app (2 projects, 82 analyst runs; registry still 1 to 13; confirmed by the owner). `baseline/check.sh` now compares against it.

- **2026-11-23 (later):** the owner asked for the Online Retail demo in the real workspace. A verified backup was made first (`.backups/pre-retail-20261123`), then a project "Online Retail demo" with three datasets, one dashboard, saved answers, definitions and four prediction experiments was added through the app. `sh docs/baseline/check.sh` therefore reports CHANGED against `baseline-2026-11-23.json` by design; no existing row was edited. Walkthrough: [demo/ONLINE_RETAIL_DEMO_GUIDE.md](demo/ONLINE_RETAIL_DEMO_GUIDE.md). A new baseline file has not been written.

- **2026-11-23 (dashboard in dollars):** after a verified backup (`.backups/pre-dashboard-usd-20261123`), four GBP key metrics were added in Business definitions (Average order value, Sales revenue by month, Sales revenue by country, Best month by sales revenue), the four revenue tiles of "Online Retail overview" were replaced by money-aware ones, its note was rewritten, and two PDFs were saved in `docs/demo/`. No existing row was edited; no code changed in this step.

- **2026-11-24:** after verified backups (`.backups/pre-prompt-v5-20261124`, and a catalog snapshot `.backups/pre-run-delete-20261124`), the API was rebuilt with prompt `sql-grounding-v5`. At the owner's request, five test questions that had SQL pasted into them (made on 2026-11-23) were removed from the catalog (`analyst_runs` and their 4 `analyst_run_results` rows, in one transaction, with the API stopped) and six saved charts holding that text were deleted through the app. The dashboard "Online Retail overview" was rebuilt from plain-English questions. The app has no delete for saved questions, so this was done outside the app, against the intent of Rule 6; the owner asked for it explicitly.
