# Module coverage matrix (read-only review, 2026-11-23)

Read from the test files by name and by searching their text. No test was written or changed for this. "Gap" means: I found no test that checks it. Counts today: 363 unit, 617 backend, 74 local browser specs, 13 hosted, 1 smoke.

Legend: **U** = frontend unit (`src/**/*.test.ts(x)`), **B** = backend (`backend/tests/test_*.py`), **E** = local browser spec (`frontend/e2e/*.spec.ts`), **H** = hosted browser spec (`e2e/hosted-*.spec.ts`), **S** = smoke.

## Rule 2 and human judgment, stated once
- **Live AI:** every automated test uses the controlled provider (no real AI). Real AI was exercised only in the owner-run live QA walkthrough (`qa-live-walkthrough.spec.ts`, 2026-11-20, 30 of 30 steps, on the older build) and by hand in the demo. **Nothing after P1 to P7 has been re-run with a live AI.** That includes the new Ask panel, the Files panel, and the Online Retail file.
- **Only a human can judge:** whether the wording is plain to a non-technical owner, whether charts and PDFs look right, the 5-minute first-run feel, colour and spacing taste, whether an AI answer is *correct for the business* (tests compare to independent calculations on fixtures only), and whether the Online Retail answers match the pandas answers in `docs/demo/verify_questions.online_retail.json`.

## Owner pages

| Area | What it does | Covered by | Gaps |
|---|---|---|---|
| **Home** | Question box, 3 suggestions, recent dashboards and questions, setup guide for new projects | U `HomePage.test` (10), `App.test`; E `08-product-stage2-home`, `uiclean-step1`, `uiclean-firstrun`, `19-stage3-journey` | Suggestions failing to load mid-session; very long dataset names in the box |
| **Ask** | Question, typed-column confirmation, answer sentence, chart, details, pin, follow-ups, feedback | U `Analyst.test` (28), `AnalystFeedback`, `analystPresentation`, `answerGoldens` (14), `ResultTopN`; B `test_analyst`, `test_analyst_ux`, `test_stage3_provider_retry`, `test_stage3_saved_answers`; E `analyst`, `analyst-phase2`, `10-product-stage4-ask`, `17-fix3a-confirmed-types`, `21-stage3-final-features` | Live AI after P7 (Rule 2); several question types at once |
| **Ask panel (P7)** | New question button, history grouped Today / Yesterday / Earlier, "asked 2x", current one highlighted | U `AskPanel.test` (3), `historyGroups.test` (3); E `uiclean-step1`, `analyst`, `analyst-phase2` (open a saved question) | Collapse button and its saved state (localStorage `insightiq-panel-collapsed`) untested; slide-in at narrow width (Escape, focus trap, focus return) untested; "Load earlier runs" button in the new panel has no test of its own (one older unit test in `Analyst.test`); day boundaries around midnight and daylight-saving |
| **Datasets** | Table of the project's datasets, health, currency row, Preview / Columns, editor, history, download | U `DatasetWorkspace.test` (13), `DatasetLifecycle` (10), `DatasetEditor` (8), `DatasetCurrency`, `DatasetTabs`; B `test_dataset_editor`, `test_dataset_lifecycle`, `test_dataset_quality`, `test_dataset_revisions`, `test_large_upload`; E `01-phase4-datasets`, `09-product-stage3-data`, `dataset-editor`, `dataset-lifecycle`, `25-stage6-fixes`, `27-stage7-followup` | Editing in the Files-panel layout at 768 px; very wide tables in the detail view |
| **Files panel (P7)** | Import CSV, New project, Refresh, project switcher, list, Show archived, select all | E `01-phase4` (narrow Files), `20-stage3-after-captures`, `27-stage7-followup`, `dataset-lifecycle` (select all, bulk delete) | **Refresh files** icon untested; **New project from the panel** untested (only from Menu); collapse state untested; row menu inside the slide-in only checked by hand and in spec 20 at 390 |
| **Upload / first run** | Drop or choose a CSV, progress, limits, first answer within minutes | U `P4Reliability`, `uploadErrors`; B `test_large_upload` (6), `test_reliability`; E `uiclean-firstrun` (3), `26-stage7-demo-script`, `01-phase4`, `phase9-smoke` | Cancelling an upload; a file at exactly 60 MB or 1,000,000 rows in the browser (only measured by hand, doc `docs/P4_LARGE_FILES.md`); the 541,909-row Online Retail file in the browser (done by hand only) |
| **Dashboards** | Tiles, edit mode, filters, currency per dashboard, PDF export | U `DashboardWorkspaceControls`, `SaveChartDialog`, `tileTitle`; B `test_dashboard_workspace`, `test_stage3_report_pdf` (10); E `03-phase6-dashboards`, `11-product-stage5-dashboards`, `25-stage6-fixes` | The look of the PDF (human only); dashboards with 20+ tiles |
| **Predictions (AutoML)** | Three guided steps, leakage warning, training, results, predict | U `AutoMLStudio.test` (13), `AutoMLSummary`, `automlPlain`; B `test_automl` (15), `test_automl_presentation`, `test_stage4_leakage_check`; E `automl` (4), `12-product-stage6-models`, `21` and `22` (leakage) | Real-size training time on a large file; whether model explanations are understood (human) |
| **Business definitions** | Column descriptions, key metrics, AI drafts, advanced verified examples, archived read-only | U `KnowledgeEditor` (7, incl. archived read-only), `KnowledgeReview` (12); B `test_knowledge_review`, `test_phase3`; E `02-phase5-knowledge`, `13-product-stage7-knowledge`, `21` | Draft quality with live AI (Rule 2, human) |

## Menu, admin, projects, accounts

| Area | What it does | Covered by | Gaps |
|---|---|---|---|
| **Projects** | Create, rename, archive, delete with preview; isolation | U `ProjectsPage.test` (5); B `test_stage2_projects` (19), `test_stage2_route_scopes`; E `18-stage2-projects`, `27-stage7-followup` | Isolation of every new P7 panel list is covered only through the same API, not separately |
| **Settings** | Default currency, display options | U `WorkspaceSettings.test` (2), `defaultCurrency`; E `21-stage3-final-features`, `currency` | Compact navigation was removed; nothing else is missing |
| **Menu pages** | Settings, Projects, Design, Change password, Sign out | U `Phase3Navigation`, `Routes`; E `hosted-roles` (viewers cannot open Design), `hosted-people` (Change password) | **Design page** (developer style guide): no test opens it except that hosted viewers are refused (H `hosted-roles`) |
| **Evaluation (Accuracy check)** | Operator-only accuracy check and benchmark | U `EvaluationWorkspace` (8), `EvaluationDiagnostics`, `OfflineAndTraces`; B `test_offline_evaluation`, `test_evaluation_presentation`, `test_final_hardening`; E `04`, `14`, `00-stage5-accuracy-empty` | Scoring of real-AI answers (Rule 2) |
| **Run analytics, Execution traces** | Operator pages: performance, errors, traces | U `OfflineAndTraces`, `RunTraceDetails`, `AdminExtras`; E `15-product-stage9-monitoring`, `23`, `24`; the page is also walked in `00`, `05`, `07`, `16` | None found beyond the live-AI limit |
| **Change history, Backup info** | Dataset audit log, backup information | U `AdminExtras`, `Phase4`; B `test_dataset_lifecycle`, `test_dataset_revisions`, `test_stage6`; E `24-stage5-admin`, `01` (history) | Backup info is text only; no test that its numbers match a real restore |
| **Accounts / login** (hosted only) | Sign-in, roles, people, security log, two-step sign-in, password change | U `Accounts.test` (15), `AccountsA4` (8); B `test_accounts_a1` (31), `a2_access` (13), `a3`, `a4` (30), `test_hosted_a5`, `test_hosted_static`; H `hosted-roles` (7), `hosted-people` (5); stack E `hosted-stack-csp` | **A5 not reviewed by owner**; real certificates and a real server never exercised; a real authenticator app and real email reset never tested; A6 to A8 not built; viewer sees only Home and Dashboards (H) but nothing tests a viewer on every future page |
| **Login off (default)** | App runs with no login and says so | all local E specs run with login off; B `test_workspace`, `test_stage7` | None known |
| **Safety rules** | Type confirmation, units only after owner confirms, no invented facts, feedback never in prompts | U `percentUnit`, `answerGoldens`; B `test_fix3a_confirmed_types`, `test_stage3_confirmed_units`, `test_currency`, `test_analyst` | Rule 3 areas are byte-checked, not behaviour-tested again; Rule 4 wording on every new string is a human review |

## Biggest gaps, in order
1. Nothing re-run with a live AI since the P-stages (Rule 2 by design; your call when to do a live pass).
2. P7 panels: collapse state, slide-in keyboard behaviour, Refresh and New project icons.
3. A5 hosted package: real certificates and server.
4. Large real files in the browser (60 MB, 1,000,000 rows) and the 541,909-row Online Retail file are manual-only.
5. Anything in the human-only list above.
