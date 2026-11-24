# InsightIQ changelog

Phase reviews are historical implementation evidence. README, OPERATIONS and SECURITY_AND_PRIVACY describe the current application.

## Ask: a question that names a saved metric reuses that metric's query (2026-11-24)

Prompt text only. No SQL guard, sandbox, currency arithmetic, rate provenance, stored value or migration was changed (Rule 3 areas untouched).

- The SQL planner prompt is now `sql-grounding-v5`. When a question names one of your saved metrics (for example "What is Sales revenue by month?"), the planner must return that metric's SQL exactly as written. The currency code only labels a result when the executed query is identical to a confirmed metric, so plain-English questions that name a metric now come back with its confirmed currency and the Convert button. Before, the AI rewrote the query slightly and the currency was lost.
- Tests: 3 new backend tests (`test_prompt_metric_rule.py`); nothing weakened. Backend total 620.

## Predictions: plain-language meaning of each result number (2026-11-23)

User interface only. No training, metric, model registry, stored value, API route or migration was changed (Rule 3 areas untouched).

- Under a model's results there is a new section **What each number means**. For each number shown (average error, squared error, typical large error, R², accuracy, precision, recall, balanced score, ranking quality, WAPE, silhouette, group sizes, flagged count and share) it gives a fixed plain definition filled with the recorded value and your target name. It makes no "good" or "poor" judgement, because no documented thresholds exist (Rule 4). The "more than twice the average miss" remark appears only when RMSE is above twice MAE and shows both numbers.
- The **Model schema, metrics & provenance** block (raw JSON of features, metrics, file path and checksums) is no longer shown on the Predictions page. The model's saved data is not changed.
- After you press **Predict with saved model**, a new **What this prediction means** block explains the result for each task: a number is an estimate for the values you entered, not a value looked up in your file, with the model's recorded average miss on unseen rows; a class comes with the model's own estimated chance; a group is a set of similar records; an unusual flag is not an error or fraud; a forecast is a single best estimate with no range. Nothing is invented: the miss figure appears only when it was recorded.
- The **Technical details: split, seed and data check** block (seed, file check code, raw split and configuration JSON) is no longer shown under the results.
- A **Why this model was chosen** section lists the models that were compared, best first, with the measure used (lowest typical large error for numbers, highest balanced score for categories, earlier time windows for forecasts), says the winner was then tested once on rows that took no part in choosing it, names the simple-guess baseline, and states that every model that trained is saved. For groups and unusual records it says no models were compared.
- Every chart has a **How to read this** line (fixed definition, no quality judgement, nothing about a line the chart does not draw) and an **In this result:** line written from that result's own plotted data: counts, typical (median) miss, the largest misses, average over- or underestimate, class and group sizes, share of variation kept by the picture, flagged share and score range, history and forecast dates and values, final-window totals, top columns by importance. Any threshold used (for example "more than 5 times the typical miss") is stated in the sentence. The wrong-class table and the group table get one generated sentence per class or group. Forecast models also get the "What do these options mean?" help.
- The prediction form has a **What do these options mean?** link explaining Saved model, Single record and Existing registered dataset, and that the result is an estimate, not a value copied from your file.
- Tests: 28 new unit tests (`automlMeaning.test.ts`); nothing weakened. Unit total 394.

## P7: question history and file list in a side panel (2026-11-23)

User interface only. No stored data, API route, access level, colour or migration was changed.

- **Ask** has a side panel: one **New question** button, then your saved questions grouped Today / Yesterday / Earlier. The same question asked twice shows once as "asked 2x". Clicking a row opens that saved answer; the open one is highlighted. This replaces the "Recent questions" drop-down and the old inline New question button.
- **Datasets** has a **Files** panel: Import CSV, New project and Refresh icons, the project switcher, the project's datasets (name, rows x columns, Sample / Archived chip, row menu, Show archived) and the detail view beside it. The top-bar project switcher moves into this panel on wide screens.
- **Narrow screens (under 960 px):** the same panel slides in from a "Questions" / "Files" button. Resizing or rotating no longer rebuilds it, so an open dialog is not lost.
- **Hosted viewers** still see neither page (Home and Dashboards only). Login-off behaviour is unchanged.
- **Menus inside slide-in panels** now open on top of them (shared Menu component).
- **Tests changed (none weakened):** specs that opened the old "Recent questions" or "Your datasets" drop-downs no longer click them (00-phase3, analyst, analyst-phase2); showDatasetList now presses "Files" on narrow screens; 01-phase4 and 27-stage7 check the closed Files panel and open it at 390 px; 27-stage7 now uploads into its own project (the old upload went to another project, so its table check passed without a file). New unit tests: history grouping (3) and the Ask panel (3).

## P6: tidy-up from the feature audit (2026-11-22)

User interface only. No stored data, API route, access level or migration was removed or changed.

- **Merged:** "Save to library" into **Pin to dashboard** (the saved-chart routes and data are unchanged); **Hide sample datasets** into Datasets (the switch there remains; it is gone from Settings); the Columns-tab **descriptions** into Business definitions (descriptions show read-only in Columns with an "Edit descriptions in Business definitions" button; they are stored and approved exactly as before).
- **Removed from the interface:** the Setup guide once you have a first answer; **Compact navigation** in Settings (the sidebar still collapses with its own button); **Export JSON** in the dashboard menu (the `report.json` API route and its access level are unchanged).
- **Kept as decided:** Execution traces and Dataset change history, under Menu, owners only.
- **Tests:** only assertions about the removed elements were deleted or replaced (listed in the P6 review); nothing else was weakened.

## Product redesign: stages 1 to 7 (2026-11)

What an owner or analyst will notice, stage by stage. Each stage has its own review with evidence.

| Stage | What changed for users | Review |
|---|---|---|
| 0 Audit | No code changes. Ranked UI problems and logic bugs, with screenshots. | [AUDIT](AUDIT.md) |
| 1 Foundation | One design system (colour, type, spacing, shared Button, Card, Modal, Drawer, Tabs, Toast, tables, empty and error states); owner navigation: Home, Ask, Datasets, Dashboards, Predictions, Business definitions; developer items moved under a hidden Admin switch. Plain wording replaces "revision hash", "fingerprint", "scope". | STAGE1_REVIEW |
| 2 Projects | A project switcher in the top bar; every list, search, dashboard, suggestion and retrieval is filtered to the active project; archive (reversible) and guarded delete with a dependency preview. Existing data appears in the **Default project** with no rows rewritten. Projects organise work; they are not access control. | STAGE2_REVIEW |
| 3 Owner journey | Home is "What do you want to know?"; Ask is answer-first (one sentence, one chart, collapsed details, Pin to dashboard, follow-ups); Datasets is table-first with import in a modal; Dashboards has a tidy grid and an "Updated" date. Column types are remembered per dataset. Money and percentage units appear only after you confirm them. Numbers are rounded for reading and exact in "How this was calculated". | STAGE3_REVIEW |
| 4 Predictions and Business definitions | Predictions is three plain steps with measured results beside a "simple guess"; a warning appears when a column **may give away the answer** (warning only; training is unchanged). Business definitions is two tabs ("What your columns mean", "Your key metrics"); the verified-example machinery moved under Advanced. | STAGE4_REVIEW |
| 5 Admin area | Accuracy check (its empty state explains why "0 of 45" means nothing was measured), Performance and errors, Execution traces ("Started"/"Finished"), Dataset change history, Backup info (restore steps rehearsed on a throwaway copy). Every page carries the "not protected by a login" banner. | STAGE5_REVIEW |
| 6 Logic fixes | Sample data is now **whatever you mark** (not guessed from file names) with Select all samples; Approve all covers descriptions only, each metric calculation is approved on its own; dashboard display currency is remembered per dashboard; the model unit is shown as "a label you typed"; charts saved before change tracking say so plainly; the verified-example check is three numbered steps. | STAGE6_REVIEW |
| 7 QA and release | Shared Card on the Home, Ask and Dashboards panels (visual only); duplicate startup migration calls removed; honesty review of docs and screens; `.gitignore` and `scripts/release_check.sh` for pushing to GitHub; new README, demo script, release checklist. A follow-up made Home and Datasets load faster and steadier on a phone (non-essential start-up requests wait until the first screen is done; Datasets no longer flashes its import panel while loading). | STAGE7_REVIEW |

### Database migrations added (all additive, each preceded by an automatic backup)

| Version | Table | Purpose |
|---|---|---|
| 10 | `confirmed_column_types` | Remembers the column types you confirmed, per dataset. |
| 11 | `projects`, `project_items` | Projects. The Default project is virtual: no mapping rows are written for existing items. |
| 12 | `analyst_run_results` | Saved answers (up to 1,000 rows each, newest 500 kept). The table existed since 2026-11-17; its registry row was added in Stage 6. |
| 13 | `dataset_sample_flags` | The sample-data label you set. Empty after the migration. |

### What changed for existing data

- **Nothing was rewritten or backfilled** (CLAUDE.md rule 6). Datasets, questions, dashboards, models and definitions keep their rows and files; new tables are added next to them.
- Existing items belong to the **Default project**.
- Datasets that earlier builds labelled "Sample" because of their file name are **no longer labelled**. Mark them yourself (Datasets, row menu or bulk bar), then use "Hide sample data" or "Select all samples".
- Dashboard tiles saved before change tracking show **Saved before change tracking**; the stored status value is unchanged.
- Model unit labels you typed earlier are shown as typed. Browser-only "confirmations" saved by older builds are left in place and no longer used.
- The real workspace's registry now lists versions 1 to 13. `docs/OPERATIONS.md` explains the upgrade and restore procedures.

## Earlier phases

| Phase | Delivered | Review |
|---|---|---|
| 1A | Shared numeric/currency/axis formatting, typography, focus and visual cleanup. | Review |
| 1B | Display names, sample filtering, archive/restore, dependency previews and guarded deletion with retained history. | Review |
| 2 | Ask your data result/composer workflow, bounded user threads and separate Helpful feedback. | Review |
| 3 | Global active dataset, switch guards, page-only Evaluation context and consistent navigation/onboarding. | Review |
| 4 | Preview/schema/quality workspace and immutable forward-only dataset revisions. | Review |
| 5 | Explicit AI draft sharing/review and independently verified examples, distinct from user feedback. | Review |
| 6 | Dashboard titles/duplicates, widget-specific safe refresh/history, freshness and presentation exports. | Review |
| 7 | AutoML wizard, measured summaries/baselines, safer prediction forms and model library. | Review |
| 8 | Results-first Evaluation, stored-output diagnostics, separate unscored questions and comparable-run controls. | Review |
| 9 | Nullable local audit source, mixed-format gzip snapshots, scalar references, explicit rejected-draft cleanup, browser unit confirmation, shared presentation/accessibility hardening, smoke test and current documentation. | Final review |

No authentication, multi-user/public hosting, masking feature, fabricated accuracy/quality badges or automatic historical provenance backfill is claimed. The original dashboard's duplicate widgets remain the owner's decision.
