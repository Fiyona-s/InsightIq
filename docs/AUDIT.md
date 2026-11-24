# InsightIQ: Stage 0 audit

Date: 2026-11-15. Scope: Stage 0 only. No application code was changed.

## How this audit was run

- **Isolated workspace.** API on 127.0.0.1:8001 (`backend/tests/e2e_server.py`, its own `mkdtemp` data folder, controlled provider via `httpx.MockTransport`, synthetic FX). Frontend on 127.0.0.1:5174 (Vite dev server proxying to 8001). Both started with a cleared environment (no `.env`, no provider key). **No live AI call was made.**
- **Original workspace not touched.** Docker was not running. `data/` is unchanged (timestamps 2026-11-06). The only file written inside the project during the walk was Vite's dependency cache in `frontend/node_modules/.vite`. This report and `docs/audit/*.png` are the only new project files.
- **Data.** A throwaway copy of the 2,400-row retail demo, renamed `my_shop_sales_2025.csv` with plain column names. The same file was also uploaded as `demo_store_sample.csv` to test sample detection.
- **Browser.** Real Chrome via Playwright, driven like a first-time owner. Each screen was captured at 1280 and 390 px (full page) with automated checks: axe (WCAG 2 A/AA), horizontal overflow, and any visible text under 14 px. 58 screens, 112 screenshots in [audit/](audit/).
- **Fixture limits (important).** The controlled provider only knows a few question patterns. "Which product category earns the most?" and "What were my sales last month?" were answered with *total revenue*. That is a fixture artefact, so this audit does **not** judge answer correctness. The fixture also rejects any request where `revenue` is not typed DOUBLE, and that is how bug L1 surfaced. I checked each such failure against the run record before calling it an app bug.

---

## a. What works today vs what is broken or half-built (verified by running it)

| Step | Result | Evidence |
|---|---|---|
| Open the app | Works, but lands on **My Data**, not Home | [01](audit/01-home-empty-1280.png) |
| Upload CSV (2,400 rows, 218 KB) | **Works**, 2.3 s, success message, dataset selected | [04](audit/04-datasets-after-upload-1280.png) |
| Profile: Columns / Data Quality / Version History | **Works**. Jargon heavy; Columns tab overflows on mobile | [05](audit/05-profile-columns-1280.png), [06](audit/06-data-quality-1280.png), [07](audit/07-version-history-1280.png) |
| Home with data | Works; setup checklist tracks progress | [08](audit/08-home-with-data-1280.png) |
| Ask, first question as a new owner | **Broken in practice**: types never confirmed, so the run went out with every column as text (fixture failed it) and the error doesn't say why | [10](audit/10-ask-q1-after-click-1280.png), L1/L2 |
| Ask after confirming types (same page visit) | **Works**: answer sentence, KPI/bar chart, SQL, steps | [13](audit/13-q1-total-revenue-1280.png), [15](audit/15-q3-revenue-by-region-1280.png) |
| Ask after leaving and coming back | **Broken**: confirmed types silently reset to text; 5 of 5 questions failed | L1 |
| Follow-up question | **Works** (same thread) | [18](audit/18-followup-by-region-1280.png) |
| Suggestion chips | Fill the box only (do not run) | [19](audit/19-suggestion-chip-clicked-1280.png) |
| Pin to dashboard (first time) | **Dead end**: no dashboard exists and none can be created from Ask | [20](audit/20-save-to-dashboard-dialog-1280.png), U1 |
| Create dashboard, then pin 3 answers | **Works** | [24](audit/24-dashboard-view-1280.png) |
| Dashboard PDF | **Works** (valid 4-page PDF, `%PDF-1.4`), but content is an engineering dump | [27](audit/27-pdf-page1.png) |
| Display currency | Selector shown; no effect (no confirmed currency); resets on reload | [26](audit/26-dashboard-usd-1280.png) |
| Knowledge: Draft with AI → Approve all | **Works**, with a clear data-sharing confirmation first | [30a](audit/30a-draft-confirm-1280.png), [30](audit/30-knowledge-draft-1280.png) |
| AutoML: classify `status` → train → review → predict | **Works** (2.7 s, local). Results page is a statistics report; leakage not detected | [37](audit/37-automl-review-1280.png), [38](audit/38-automl-predict-1280.png) |
| Evaluation: install → verify → offline replay | **Runs**, but scores **0 of 45** (offline replay can't use Ask answers) | [45](audit/45-evaluation-results-1280.png), L7 |
| Run Analytics / Execution Traces / Settings / Guide | Load; developer-oriented | [40](audit/40-run-analytics-1280.png)–[43](audit/43-workspace-guide-1280.png) |
| Delete dataset | **Works**: dependency preview, typed confirm, Archive recommended; dashboard keeps snapshots labelled "Deleted dataset" | [49](audit/49-delete-dependency-preview-1280.png), [51](audit/51-dashboard-after-source-deleted-1280.png) |

**Against the success goal (first trusted answer within 2 minutes, without help text):** not met today. A new owner's first question fails unless they find and complete the collapsed "Check column types" panel. If they move to another page and come back, it fails again. Pinning that answer also needs a detour to Dashboards first.

---

## b. UI problems, ranked

Severity: **blocker** stops the owner journey, **major** hurts trust or comprehension, **minor** is polish.

| # | Sev | Problem | Evidence | Cause | Proposed fix |
|---|---|---|---|---|---|
| U1 | **Blocker** | "Save to dashboard" on a first run can't save. The only destination is "Chart library only", Save stays disabled, and the panel has no "create dashboard" option. | [20](audit/20-save-to-dashboard-dialog-1280.png), [20b](audit/20b-pin-popover-new-dashboard-390.png) | `SaveChartDialog.tsx:131` disables Save when `pin && !dashboardId`; options list only existing dashboards | Pin creates "My dashboard" on first use, or offers an inline "New dashboard…" option. Remove the separate "chart library" idea from the owner flow |
| U2 | **Blocker** | First question fails with "Review it and your confirmed types", but the owner never saw a type step. "Check column types" is a small collapsed link. | [09](audit/09-ask-start-1280.png), [10](audit/10-ask-q1-after-click-1280.png) | Logic bugs L1 and L2 | See L1/L2; also say plainly which step is missing |
| U3 | Major | Raw floating-point numbers on owner surfaces: **"Your total revenue is 8,379,680.760000008."**, "West is highest at 2,224,787.6999999997", dashboard KPI, AutoML metrics like 0.7103658536585366 | [13](audit/13-q1-total-revenue-1280.png), [24](audit/24-dashboard-view-1280.png), [37](audit/37-automl-review-1280.png) | Logic bug L3 | Presentation rounding; exact value in table/export |
| U4 | Major | Jargon on owner pages: VARCHAR/BIGINT/DOUBLE, "Inferred type", "Missing / nullable 0 · Yes", "Revision", "snapshot", "persist these result rows and provenance locally", "Saved snapshot", "fingerprint", "registered rows", "0 LLM calls", "Macro F1", "DummyClassifier", "precision_macro", `categorical__channel_O` | [05](audit/05-profile-columns-1280.png), [11](audit/11-check-column-types-1280.png), [20](audit/20-save-to-dashboard-dialog-1280.png), [32](audit/32-automl-start-1280.png), [37](audit/37-automl-review-1280.png) | Copy written for analysts/engineers | Plain-language copy pass: Text / Whole number / Decimal / Date; "Save to dashboard" with no consent checkbox; technical terms move under "Details" or to Admin |
| U5 | Major | Mobile pages scroll sideways: Columns tab **+272 px**, AutoML Predict **+639 px** | [05-390](audit/05-profile-columns-390.png), [38-390](audit/38-automl-predict-390.png) | Wide tables not contained in a scroll region | Contain tables (DataTable with internal scroll); stack registry rows as cards at < 600 px |
| U6 | Major | Text under 14 px on **every** screen: nav section labels 11 px, "Local workspace" 10 px, row counts 11 px, quality chips 11 px, "Current" chip 9 px, editor footer 9 px, retrieval scores 9 px, dashboard SQL 8 px | automated scan, all screens | No type scale; ad-hoc sizes | Stage 1 type scale, 14 px minimum body and metadata |
| U7 | Major | PDF report reads as a debug log: ISO timestamps with microseconds, `Dashboard filters: []`, `Status: snapshot; error: None`, `Incompatible filters: []`, "[f1]…[f10]" facts with unrounded numbers | [27](audit/27-pdf-page1.png) | `reports.py` prints internal fields | Owner PDF: title, date, one line per widget, chart, rounded value, "data as of"; technical appendix optional |
| U8 | Major | With details open, the answer card on mobile is **7,427 px tall**, mostly raw JSON (`result_digest`, `formula`, `scope`) | [15b-390](audit/15b-region-details-expanded-390.png) | "Execution details" renders every evidence fact as JSON | Keep "How this was calculated" (3–5 plain lines + SQL); JSON goes to Admin → Traces |
| U9 | Major | No single primary action. Home has six competing actions; empty My Data has two upload buttons ("Import CSV" + "Choose file"); Knowledge has two primaries; the dashboard's primary is "Edit dashboard" rather than Export | [08](audit/08-home-with-data-1280.png), [01](audit/01-home-empty-1280.png), [29](audit/29-knowledge-1280.png), [24](audit/24-dashboard-view-1280.png) | No shared Button hierarchy rule | One primary per screen (Stage 1 rule) |
| U10 | Major | AutoML Review is a statistics report: four algorithm tables, five KPI cards with 16-digit numbers, class-imbalance warnings | [37](audit/37-automl-review-1280.png) | Built for analysts | Lead with one plain sentence ("Correct for about 96 of 100 orders in a held-out test") plus a baseline comparison; the rest under "Details" |
| U11 | Minor | App opens on My Data, not Home | [01](audit/01-home-empty-1280.png) | `lib/navigation.ts` fallback `"Data workspace"` | Default to Home |
| U12 | Minor | Dataset names truncated mid-name ("my_shop_sales… .csv", "CONTRO…etail-v1.csv"); filename repeated on every dashboard widget | [48](audit/48-datasets-three-items-1280.png), [24](audit/24-dashboard-view-1280.png) | Fixed widths; middle truncation | Use display name; show source once per dashboard |
| U13 | Minor | Catalog panel changes width and collapses between tabs (layout jumps) | [05](audit/05-profile-columns-1280.png) vs [06](audit/06-data-quality-1280.png) | Catalog open state tied to tab | Fixed layout; table-first Datasets page (Stage 3) |
| U14 | Minor | Pencil icons on every cell while "Edit mode Off" | [04-390](audit/04-datasets-after-upload-390.png) | Editor affordance always rendered | Show only in edit mode (presentation only; editor save mechanics untouched) |
| U15 | Minor | Question-box placeholder is dark enough to look like typed text | [09](audit/09-ask-start-1280.png) | Placeholder colour | Lighter placeholder token |
| U16 | Minor | AutoML charts appear empty for several seconds, with no loading state | [37](audit/37-automl-review-1280.png) vs [37b](audit/37b-automl-charts-after-wait-1280.png) | Lazy-loaded charts without a skeleton | Skeleton |
| U17 | Minor | Grammar: "Your orders is 2,400.", "1 attempts" | [14](audit/14-q2-orders-1280.png), [41](audit/41-execution-traces-1280.png) | Template strings | "Orders: 2,400"; pluralise |
| U18 | Minor | axe (serious): colour contrast in the Check column types panel and AutoML review; 10 unfocusable scroll regions in expanded mobile details | [11](audit/11-check-column-types-1280.png), [37](audit/37-automl-review-1280.png), [15b-390](audit/15b-region-details-expanded-390.png) | Muted tokens; `<pre>` blocks | Token contrast; tabindex on scroll regions or remove the JSON |
| U19 | Minor | Workspace guide tells an owner to upload "fixtures/retail-example.csv from the repository" | [43](audit/43-workspace-guide-1280.png) | Developer copy | Remove the Guide page; empty states carry the guidance |
| U20 | Minor | Knowledge "tabs" are jump links styled as buttons | [29](audit/29-knowledge-1280.png) | — | Real Tabs component or simple sections |
| U21 | Minor | Suggested questions show raw column names in quotes (`"discount_pct"`) | [09](audit/09-ask-start-1280.png) | Template | Use humanised labels |
| U22 | Minor | Resizing to mobile width while the delete dialog is open closes it (the dialog sits inside the collapsible catalog). Opening Delete on mobile works. | [49-390](audit/49-delete-dependency-preview-390.png) | Dialog rendered inside `<details>` | Render dialogs in a portal (shared Modal) |

What's already good: upload feedback; the honest data-sharing confirmation before AI drafts; the delete dependency preview with Archive recommended; dashboards that keep snapshots after source deletion; no currency guessed from column names.

---

## c. Logic bugs (separate from design opinions)

| # | Sev | Bug | How verified | Cause | Proposed fix | Protected area? |
|---|---|---|---|---|---|---|
| L1 | **Blocker** | **Confirmed column types are thrown away on every visit to Ask** (in-app navigation or reload). Later questions run with every column as text and no warning. | Confirmed types → Home → Ask: `revenue` back to VARCHAR. Run records: 5 questions after a revisit have `type_mapping: {}`, while the earlier same-visit run has the confirmed mapping. | Type mapping is component state (`Analyst.tsx:77`, reset at `:167`) | Remember confirmed types per dataset version (server-side), and warn when they're missing | **Yes**: type-confirmation rule. Needs approval |
| L2 | Major | The type check is only enforced when some column is set to a non-text type. The default (all text) passes silently, so a new owner skips confirmation without seeing it. | Analyze was enabled with no confirmation; after "Use suggested types" it shows "Confirm column types to continue" | `converting = Object.values(mapping).some(t => t !== "VARCHAR")` (`Analyst.tsx:93`) | Pre-fill suggested types and require one visible "These look right" confirmation before the first question | **Yes**: same rule |
| L3 | Major | Floating-point artefacts shown to owners: 8,379,680.760000008; 2,224,787.6999999997; AutoML 0.7103658536585366; Run Analytics cost **$0.0013200000000000002**. The evidence text for the same answer rounds to 8,379,680.76, so the screen is inconsistent. | Screens 13, 15, 24, 37, 40 | `formatNumber` with no `decimals` prints full precision (`lib/formatters.ts:28-36`); used by `displayMoney`'s non-money branch (`lib/currency.tsx:75-76`) | Presentation-only rounding policy (measures: up to 2 dp, or source precision; metrics: 3 significant figures). Tables/exports keep the exact value | Partly: `currency.tsx` holds the currency code. The change would only touch non-money formatting, not arithmetic. Needs approval |
| L4 | **Blocker** | Pin can't succeed when no dashboard exists (= U1) | Observed; code at `SaveChartDialog.tsx:131` | See U1 | See U1 | No |
| L5 | Major | **AutoML target leakage not detected.** Predicting `status`: `revenue` is 0 for all 308 Cancelled/Returned orders and non-zero for all 2,092 Completed. It was included by default although the page says "suspected leakage are excluded". The owner is asked to confirm "no target-derived values", which they can't judge. Reported accuracy: 95.8%. | Counted in the CSV; feature list on [34](audit/34-automl-configure-1280.png) | Leakage heuristic covers IDs/high cardinality only | Pre-training **warning** (not auto-exclusion) when a feature nearly perfectly separates a target class | **Yes**: AutoML. Warning-only check needs approval |
| L6 | Major | Model registry "Recorded metric" mixes splits: RandomForest shows its **test** F1 (0.7104), the others show **validation** F1, with no label. A DummyClassifier baseline is offered as a usable saved model for predictions. | [38](audit/38-automl-predict-1280.png) vs [37](audit/37-automl-review-1280.png) | Registry stores different metric scopes per model | Label the split; hide baselines from the prediction picker | **Yes**: registry. Presentation only |
| L7 | Major | **Offline evaluation can never score answers from Ask.** It only replays answers from earlier *live (paid)* evaluation jobs. With no live job (forbidden in dev by Rule 2) the result is always 0 of 45 scored. The UI says "Replays saved answers", which an owner reads as their Ask answers. I asked q05/q06 correctly on the benchmark dataset: still "no saved prediction". | [45](audit/45-evaluation-results-1280.png) | `evaluation.py:191-194` accepts only `mode == 'paid'` evaluation jobs as sources | Copy and empty state: "Needs a live accuracy run first". Move to Admin. *(Confirms the Stage 6 "Evaluation empty state" candidate.)* | Scoring untouched; copy only |
| L8 | Major | **Sample detection by filename hides real data.** `demo_store_sample.csv` (an owner file) was tagged "Sample" and hidden by "Hide sample data". Your own `InsightIQ_Retail_Demo_2400.csv` would be hidden too. | [47](audit/47-hide-sample-data-on-1280.png), [48](audit/48-datasets-three-items-1280.png) | `dataset_lifecycle.py:61` substring rule (demo, synthetic, e2e, verification…) | User-controlled flag; the benchmark is identified by its install record, not its name. *(Confirms the Stage 6 candidate.)* | No |
| L9 | Major | **Admin benchmark leaks into owner space.** Installing it adds `CONTROLLED-BENCHMARK-retail-v1.csv` to the owner's dataset list and selector; benchmark questions appear in Home "Recent answers". | [48](audit/48-datasets-three-items-1280.png), [52](audit/52-home-after-delete-1280.png) | No workspace separation | Projects (Stage 2): benchmark lives outside owner projects |
| L10 | Minor | First suggested question sums a percentage: "What is the total of discount_pct?" | [09](audit/09-ask-start-1280.png) | Suggestions take the first numeric column | Base suggestions on the owner's key metrics (Business definitions). No inference from column names (Rule 4) | No |
| L11 | Minor | "Your orders is 2,400." | [14](audit/14-q2-orders-1280.png) | `answerSentence` template (`lib/analystPresentation.ts:9`) | Label: value form | No |
| L12 | Minor | Dashboard display currency resets on reload | Selected USD → reload → "Original currencies" | Session-only state (documented in Phase 9) | Per-dashboard preference in localStorage. *(Confirms the Stage 6 candidate.)* | Currency display only. Confirm |
| L13 | Minor | Display-currency selector is offered when no chart has a confirmed currency, and does nothing | [26](audit/26-dashboard-usd-1280.png) | Always rendered | Hide until a confirmed currency exists | No |
| L14 | Minor | Default route is My Data, not Home | U11 | `navigation.ts` fallback | Home | No |
| L15 | To check | Delete preview says "28 definitions and verified examples" after approving 14 drafts | [49](audit/49-delete-dependency-preview-1280.png) | Not investigated | Check the count source in Stage 6 | — |

**Stage 6 candidates from CLAUDE.md:**

| Candidate | Status |
|---|---|
| Sample detection hides real demo data | **Confirmed** (L8) |
| Dataset clutter | Partly. "Select all visible" + bulk actions exist. The real clutter source is the benchmark and sample datasets mixing with owner data (L9); Projects fixes it more cleanly than a bulk helper |
| Evaluation empty-state clarity | **Confirmed and worse than stated** (L7): offline replay is structurally 0-scored without a live run |
| Display-currency persistence | **Confirmed** (L12) |
| Legacy unit confirmation is display-only | Not reproducible on fresh data (needs a legacy model). README and Phase 9 document it as browser-only by design |
| "Revision not recorded" wording | Not visible on fresh data (Stage 12 reports 3 such labels in the original workspace). Needs a legacy fixture |
| Heavy verified-example flow | Seen: entry is "More result actions → Propose as verified example" plus the Knowledge "Verified examples" panel. Not walked end to end; recommend moving it to Advanced (section d) |

---

## d. Scope check: keep the owner path to upload → ask → verify → pin → PDF

Prefer removing. Proposed:

| Item | Proposal |
|---|---|
| Evaluation Center, Run Analytics, Execution Traces | Move to **Admin** (Stage 5), hidden by default |
| Answer card "Execution details" (JSON evidence) | Remove from the owner card; link "Open trace" in Admin |
| "Helpful / Not helpful" | Keep (simple feedback) |
| "More result actions → Save to library / Propose as verified example" | Move to Advanced (analyst) |
| Saved chart library as a concept | Remove from the owner UI; Pin is the only save |
| Pin consent checkbox ("persist… provenance locally") | Remove (saving is the explicit action) |
| Dataset Version History tab | Move into the dataset menu as "Restore an earlier version" |
| Data Quality tab | Collapse to a one-line health summary on Datasets |
| Inline cell editing on Preview | Keep the capability; enter through an explicit "Edit data" action (editor mechanics unchanged) |
| Dashboard widget PNG/CSV/Refresh/"Evidence & provenance" on every tile | One tile menu; one "How calculated" |
| Dashboard filters / insight notes / Edit mode | Keep behind "Edit"; not the primary action |
| Display currency selector | Show only when a confirmed currency exists |
| Knowledge "Verified examples", retrieval search "Advanced" | Under Advanced |
| AutoML Clustering / Anomaly / Forecast | Keep for learners, under "More model types"; default to Predict a number / category |
| Workspace guide page | Remove (empty states replace it) |
| Settings "Hide sample data", "Compact navigation" | Remove (replaced by the sample flag / Projects; compact nav adds little) |
| Footer tagline "Intelligence starts with understanding / Local models · Measured intelligence", "YO" avatar | Remove (see e) |
| "Local training · 0 LLM calls" badges on AutoML | Remove from the owner view (true, but noise) |

---

## e. Fake-security and invented-fact risks (Rules 4 and 7)

| Risk | Where | Rule | Recommendation |
|---|---|---|---|
| **"YO" avatar circle** in the top bar implies a signed-in user; there are no accounts | Every page | 7 | Remove |
| **Footer "Local models"** suggests analysis runs locally; Ask uses the configured remote provider (only AutoML/embeddings are local) | Every page | 4/7 | Remove the footer claim |
| **"Read-only analysis" with a shield icon** next to Analyze: true (SQL guard), but the shield reads as privacy while question/schema/results go to the provider | Ask | 7 | Reword "Your file is never changed"; keep the Data sharing disclosure visible, not only collapsed |
| **"Calculated from your data."** under every answer, including answers that don't address the question (fixture Q4/Q5) | Ask | 4 | Show what was calculated in plain words ("Total revenue, all 2,400 rows") so the owner can verify |
| **"Read-only execution passed."** on an AI-drafted metric can read as a quality badge | Knowledge | 4 | "Runs safely. Not checked for correctness." |
| **"Approve all eligible (14)"** approves AI-written definitions *and* an AI-written SQL metric in one click; approved knowledge then enters prompts/RAG | Knowledge | 5 (spirit of explicit approval) | Decision needed (g). Option: bulk-approve column descriptions only; metrics individually |
| **AutoML "95.8% accuracy"** is measured but driven by a leaked feature (L5) | AutoML | 4 | Leakage warning before training; plain caveat in results |
| Registry metric mixes test/validation (L6) | AutoML | 4 | Label the split |
| Positives to keep | — | — | No currency inferred from column names (revenue shown without ₹). Evaluation says "Not measured" instead of 0%. Settings states local single-user honestly. AI draft shows exactly what is sent |

---

## f. Projects (Stage 2) restructuring plan

### Current data model (relevant parts)

- Relational: `datasets`, `analyst_runs`, `analyst_feedback`, `dataset_revisions`, `dataset_audit`, `dataset_references`, `dashboard_widget_snapshots`, `knowledge_state`, `knowledge_examples`, `schema_migrations`.
- JSON document tables (id, `dataset_id`, updated_at, payload): `dashboards`, `saved_charts`, `evaluation_jobs`, `benchmark_installs`, `ml_experiments`, `ml_models`, `ml_predictions`.
- Dashboards are deliberately **cross-dataset** ("available across datasets").
- `knowledge_state` carries a `workspace_id` (from `data/workspace.json`). This is unrelated to Projects and must not be reused for it.

### Proposed additive tables (migration v10)

```
projects(id TEXT PK, name TEXT, created_at, archived_at NULL, sort_order NULL)
project_items(item_type TEXT, item_id TEXT, project_id TEXT, added_at,
              PRIMARY KEY(item_type, item_id))   -- one project per item
```

`item_type` ∈ dataset, dashboard, saved_chart, analyst_run, ml_experiment, ml_model, ml_prediction, evaluation, benchmark_install.

**Mapping rule (recommended: "virtual Default").** Any item with **no** `project_items` row belongs to the Default project. Existing rows get no mapping rows, are never rewritten, and nothing is backfilled (Rules 1 and 6). The only change to the original workspace is two new empty tables, plus optionally one `projects` row naming Default. New items get a mapping row at creation. Knowledge, revisions, audit and feedback follow their dataset and need no mapping.

*Alternative:* write explicit mapping rows for every existing item into Default. Simpler queries, but it adds hundreds of rows to the original catalog. Not recommended.

### Endpoints to filter by active project

Active project sent as a header (`X-InsightIQ-Project`) set by the frontend project context.

- **Lists:** `GET /api/datasets`, `/api/datasets/references`, `/analyst/runs`, `/analytics/runs`, `/dashboards`, `/saved-charts`, `/experiments`, `/models`, `/predictions`, `/evaluations`, `/benchmarks`.
- **Dataset-scoped (check dataset ∈ project):** suggested-questions, profile, knowledge, `/review`, RAG retrieval, revisions, export.
- **Creates (stamp project):** POST datasets (upload), analyst runs, saved-charts, dashboards, automl experiments, predictions, evaluations, benchmark install.
- **Cross-reference guards:** add chart to dashboard (chart and dashboard in the same project); batch prediction dataset; evaluation dataset; model ↔ prediction source.
- **Aggregates:** Run Analytics totals and Home "Workspace totals" filter in SQL, not after pagination.
- **Direct-by-id GETs:** decide 404 vs allow across projects (single-user app, so allowing is acceptable, but lists must never leak).

### Isolation test list (A vs B)

1. Dataset uploaded in A is absent from B's dataset list, selector and selector search.
2. Runs in A are absent from B's Ask history, Home recent answers, Run Analytics totals/table, Traces list.
3. Dashboards and saved charts in A are absent from B's dashboard picker, pin destinations and chart library.
4. Adding A's chart to B's dashboard is rejected (409).
5. Suggested questions in B never reference A's columns.
6. RAG retrieval in B returns no documents from A's datasets or knowledge.
7. Knowledge drafts/approvals in A are not visible in B.
8. AutoML experiments/models/predictions in A are absent from B's library, prediction picker and batch-dataset picker.
9. Evaluation jobs and the benchmark dataset are absent from owner projects (Admin-only).
10. Audit view shows only the project's datasets.
11. Archiving A hides it from the switcher and blocks new work; restoring brings everything back unchanged.
12. Deleting a dataset in A keeps A's history labels and never surfaces in B.
13. Default project shows exactly the pre-migration items (count and hash comparison on a copy of the original catalog).
14. Migration on a copy of the original workspace: only the two new tables differ; all 97 (or 102, see g) storage hashes and the dashboard SHA-256 match.

### Risks

- **Cross-dataset dashboards.** "Retail Sales Overview" may reference charts from several datasets. Everything is in Default, so this is fine, but moving datasets between projects later would split dashboards. Recommend no "move item" in v1.
- **Two sources of truth** if both `dataset_id` derivation and mapping rows are used for runs/models. Recommend: explicit mapping for new rows; "unmapped = Default" only for legacy rows.
- **History of deleted datasets.** Runs whose dataset is deleted still need a project, which is why runs get their own mapping row at creation.
- **Filtering after pagination** gives wrong totals. Filter in queries.
- **Benchmark placement.** It needs a home outside owner projects; Admin reads it unfiltered.
- **Original workspace lives in the Docker volume.** The migration runs when the deployed image updates, so back up first (`backend/scripts/backup_workspace.py`) and rehearse on a copy.

---

## g. Proposed order of work, and decisions needed from you

### Order

1. **Stage 1 Foundation**: tokens, 14 px type scale (U6), shared Button/Modal (portal: U22)/DataTable (U5)/EmptyState/Skeleton (U16), new owner navigation with Admin items separated (cheap; removes most clutter early).
2. **Stage 2 Projects**: virtual-Default design above; isolation tests; fixes L9.
3. **Stage 3 Owner journey**: fold in the hero blockers here rather than waiting for Stage 6: L1/L2 (types), U1/L4 (pin), L3 (rounding), L11, L14, U7 (owner PDF), U8 (answer card).
4. **Stage 5 Admin area**: moving existing pages (L7 copy).
5. **Stage 4 Predictions / Business definitions**: U10, L5 warning, L6 labels, L10.
6. **Stage 6 remaining logic**: L8, L12, L13, L15.
7. **Stage 7 QA and release.**

### Decisions I need from you

1. **Git.** `Project/` is not a git repository, so there is no `product-redesign` branch, and CLAUDE.md is not saved in the project. May I run `git init` in `Project/` (adds `.git` only; `.gitignore` already excludes data), commit the current state as a baseline, create `product-redesign`, and save CLAUDE.md there? Or would you rather I work in a copy?
2. **Rule 1 baseline.** CLAUDE.md says 97 storage files / 18 runs. The Stage 12 review records 102 storage files, 6 experiments, 19 models. Which is authoritative? I recommend a fresh read-only hash baseline before Stage 2.
3. **Type confirmation (L1/L2, protected rule).** Approve remembering confirmed types per dataset version, and one up-front "These look right" step with suggestions pre-filled?
4. **Number rounding (L3).** Approve presentation-only rounding, including the non-money branch of `displayMoney` in `currency.tsx` (no arithmetic change)?
5. **AutoML (protected).** Approve a warning-only leakage check (L5) and split labels / hiding baselines in the registry view (L6)?
6. **AI drafts.** Keep "Approve all", limit it to column descriptions, or require per-item approval?
7. **Suggestion chips.** Today they fill only. Recommend run-on-click once types are confirmed; otherwise fill only. OK?
8. **Pin flow.** Auto-create "My dashboard" on first pin and drop the consent checkbox?
9. **Projects mapping.** Virtual Default (no rows for existing items) as recommended?
10. **Scope removals** in section d: approve as a list, or mark the ones to keep.

Stopped after Stage 0. Stage 1 has not been started.
