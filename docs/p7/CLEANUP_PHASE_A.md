# Cleanup Phase A: candidate list (2026-11-23). NOTHING WAS DELETED.

Snapshot first: `../InsightIQ_pre_cleanup.zip` (414 MB). Sizes are file sizes. Never listed as deletable (updated 2026-11-23: also `../InsightIQ_FINAL_keep_code.zip`, `../InsightIQ_FINAL_keep_data.zip`, `../InsightIQ_FINAL_keep.sha256`, `docs/RESTORE_FROM_ZIP.md`): Rule 3 files, `backend/app/automl/`, the real Docker volume, the two newest backups, `.env`, `.env.example`, `docs/baseline/`, `docs/demo/`, `docs/readme/`, `docs/p7/`, anything named in README, CHANGELOG or a review, `.venv` (776 MB) and `frontend/node_modules` (332 MB).

## Group 1: regenerable caches and build output (total 2.0 MB)

- `frontend/dist` 1.3 MB
- `frontend/test-results` 0.6 MB
- `backend/.pytest_cache` 0.1 MB
- `.pytest_cache` 0.0 MB
- `data/.DS_Store` 0.0 MB
- `__pycache__`: none outside `.venv`
- `*.log`: 468 files, all under `docs/` as test evidence (not caches): see group 6

## Group 2: temporary files and preview folders

Inside the project: none found (names containing "preview" are product screenshots, kept).
Outside the project (your temp folders, listed for information):
- `/var/folders/.../T/insightiq-big-*` : 14 folders, 840 MB (large-file test leftovers)
- `/var/folders/.../T/insightiq-demo.RUN7sN` : 0.4 MB (an old demo folder)
- `/var/folders/.../T/insightiq-demo.qUcJ0P` : 169 MB, **the running demo (port 5230): keep until you run `sh scripts/demo.sh stop`**
- `/private/tmp/claude-501/...` : 7.8 GB of session scratch (screenshots, logs, converted CSV); safe to delete when this session ends, not touched by cleanup

## Group 3: old evidence screenshots not named by README, CHANGELOG or any review (total 43.7 MB, 298 files)

A file is listed only if neither its file name nor its folder name appears in any .md, script or code file.

- `docs/stage3/lighthouse/` 9.8 MB, 24 files
- `docs/stage3/after/` 7.0 MB, 83 files
- `docs/stage4/lighthouse/` 6.4 MB, 12 files
- `docs/stage1/after/` 4.1 MB, 27 files
- `docs/stage2/after/` 4.1 MB, 30 files
- `docs/stage4/after/` 3.5 MB, 20 files
- `docs/ui-clean/p1/` 2.9 MB, 32 files
- `docs/ui-clean/p2/` 1.8 MB, 18 files
- `docs/stage7/card/` 1.5 MB, 24 files
- `docs/stage7/after/` 1.4 MB, 7 files
- `docs/ui-clean/p3/` 0.4 MB, 5 files
- `docs/stage3/pdf/` 0.4 MB, 5 files
- `docs/ui-clean/step1/` 0.3 MB, 4 files
- `docs/stage3/live/` 0.2 MB, 2 files
- `docs/stage3/current/` 0.0 MB, 5 files

## Group 4: duplicate or superseded docs

None is safe to list: every plan or review document is named by another document. Superseded planning files, all small and all still referenced (so group 6): `IMPLEMENTATION_PLAN.md`, `MILESTONES.md`, `PHASE3_IMPLEMENTATION_PLAN.md`, `PHASE4_IMPLEMENTATION_PLAN.md`, `PHASE5_IMPLEMENTATION_PLAN.md`, `TEST_RESULTS.md`, `docs/STAGE3_PLAN.md`, `docs/STAGE5_PLAN.md`, `docs/STAGE6_PLAN.md` (about 120 KB in total).

## Group 5: old backups and snapshot zips

Keep: `.backups/pre-upgrade-20261123`, `.backups/pre-p7-20261122` (newest two), plus the 14 tiny backups under 50 MB (45.2 MB together, mostly catalog files named in reviews, including `phase3-readonly-baseline`).

**`.backups` candidates: 38 folders, 35555.2 MB** (each is a full copy of the workspace; most are named in reviews as "the backup taken before X", so deleting them leaves those sentences pointing at nothing):

- `.backups/phase1b-20261109T142413Z` 115.1 MB
- `.backups/phase1b-pre-migration-20261110T044551Z` 115.1 MB
- `.backups/phase2-pre-migration-20261110T050001Z` 229.4 MB
- `.backups/phase2-pre-migration-20261110T053537Z` 229.4 MB
- `.backups/phase4-pre-migration-20261110T112804Z` 343.6 MB
- `.backups/phase4-pre-migration-20261110T123843Z` 343.6 MB
- `.backups/phase5-pre-migration-20261110T161430Z` 457.9 MB
- `.backups/phase5-pre-migration-20261110T163018Z` 457.9 MB
- `.backups/phase6-pre-migration-20261110T164440Z` 572.2 MB
- `.backups/phase6-pre-migration-20261111T015616Z` 572.2 MB
- `.backups/phase7-pre-migration-20261111T040644Z` 686.6 MB
- `.backups/phase8-pre-migration-20261111T052521Z` 686.6 MB
- `.backups/phase9-pre-deployment-20261111` 686.6 MB
- `.backups/phase9-pre-migration-20261111T065209Z` 686.6 MB
- `.backups/pre-a2-20261122` 1279.2 MB
- `.backups/pre-a3-20261122` 1279.2 MB
- `.backups/pre-a4-20261122` 1279.2 MB
- `.backups/pre-a5-20261122` 1279.2 MB
- `.backups/pre-accounts-20261122` 1279.2 MB
- `.backups/pre-accounts-build-20261122` 1279.2 MB
- `.backups/pre-cleanup-20261117` 1157.2 MB
- `.backups/pre-final-deploy-20261117` 1153.9 MB
- `.backups/pre-hold-20261122` 1279.2 MB
- `.backups/pre-p1-20261122` 1279.3 MB
- `.backups/pre-p2-20261122` 1279.3 MB
- `.backups/pre-p3-20261122` 1279.3 MB
- `.backups/pre-p4-20261122` 1279.3 MB
- `.backups/pre-p5-20261122` 1279.3 MB
- `.backups/pre-p6-20261122` 1279.3 MB
- `.backups/pre-reconcile-20261120` 1155.2 MB
- `.backups/pre-stage3-upgrade-20261117` 803.6 MB
- `.backups/pre-stage4-20261120` 1158.8 MB
- `.backups/pre-stage5-20261121` 1158.8 MB
- `.backups/pre-stage6-20261121` 1158.8 MB
- `.backups/pre-stage6-restart-20261121T112931Z` 1158.8 MB
- `.backups/pre-stage7-20261121` 1279.2 MB
- `.backups/pre-stage7-restart-20261121T155543Z` 1279.2 MB
- `.backups/pre-uiclean-20261122` 1279.2 MB

**`../InsightIQ_pre_*.zip` candidates: 25 of 27, 10102.1 MB.** Keep the 2 newest: `InsightIQ_pre_cleanup.zip`, `InsightIQ_pre_upgrade.zip`.

- `../InsightIQ_pre_stage1.zip` 354.3 MB
- `../InsightIQ_pre_fixes_3a3b.zip` 406.2 MB
- `../InsightIQ_pre_stage2.zip` 406.9 MB
- `../InsightIQ_pre_stage3.zip` 456.6 MB
- `../InsightIQ_pre_stage4.zip` 351.1 MB
- `../InsightIQ_pre_stage5.zip` 361.1 MB
- `../InsightIQ_pre_stage6.zip` 376.9 MB
- `../InsightIQ_pre_stage7.zip` 379.9 MB
- `../InsightIQ_pre_stage7b.zip` 390.1 MB
- `../InsightIQ_pre_accounts.zip` 391.2 MB
- `../InsightIQ_pre_accounts_build.zip` 391.2 MB
- `../InsightIQ_pre_a2.zip` 391.3 MB
- `../InsightIQ_pre_a3.zip` 391.3 MB
- `../InsightIQ_pre_a4.zip` 393.1 MB
- `../InsightIQ_pre_a5.zip` 413.5 MB
- `../InsightIQ_pre_hold.zip` 419.9 MB
- `../InsightIQ_pre_uiclean.zip` 423.4 MB
- `../InsightIQ_pre_p1.zip` 423.2 MB
- `../InsightIQ_pre_p2.zip` 425.3 MB
- `../InsightIQ_pre_p3.zip` 426.6 MB
- `../InsightIQ_pre_p4.zip` 427.2 MB
- `../InsightIQ_pre_p5b.zip` 428.3 MB
- `../InsightIQ_pre_p6.zip` 428.6 MB
- `../InsightIQ_pre_terno.zip` 411.9 MB
- `../InsightIQ_pre_p7.zip` 433.2 MB

## Group 6: unsure (nothing here is deleted unless you say so)

- `data/` 115.5 MB: the local-mode data folder (its `catalog.sqlite`, `automl/`, `models/`, `workspace.json`) and your `Online Retail 2.xlsx` (23 MB). Never a candidate.
- `docs/` files whose own name is not mentioned but whose folder is (stage screenshots and logs behind the reviews): 409 files, 94.3 MB.
- `docs/accounts/a5/` 7.4 MB (A5 is built but not reviewed by you) and `docs/accounts/a5-verification/`.
- `docs/stage3/qa/test-results/` 16.8 MB: output of the live-AI QA walkthrough (named like a cache, but it is evidence for the Stage 3 review).
- `*/verification/` log folders under `docs/` (468 logs, about 6 MB): the evidence behind the test counts in reviews and CLAUDE.md.
- The superseded planning docs of group 4.

## Totals

| Group | Size |
|---|---:|
| 1 caches and build output | 2.0 MB |
| 2 temp (outside the project) | 0.8 GB (not counting the running demo or scratch) |
| 3 unreferenced old screenshots | 43.7 MB |
| 4 superseded docs | none listed |
| 5 old backups | 35555.2 MB |
| 5 old zips | 10102.1 MB |
| 6 unsure | about 118 MB inside the project, plus `data/` |
