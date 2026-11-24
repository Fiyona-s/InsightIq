# CLAUDE.md: InsightIQ product brief

## 1. Problem statement
Small and mid-size business owners keep their key numbers (sales, orders, customers, costs) in CSV or Excel exports. They cannot query them, so they wait days for an analyst, or guess. Existing tools either need SQL/Python skills (BI tools) or give answers they cannot verify (generic chatbots).

**InsightIQ lets a non-technical business owner upload their data, ask questions in plain English, and get answers they can verify, in a clean interface that shows only their own business.**

Success looks like: a first-time owner uploads a file and gets a trusted answer within 2 minutes, without reading any help text.

## 2. Users (priority order)
1. **Business owner / manager (primary):** retail, shop, small company. Non-technical. Wants answers, dashboards, a PDF for their partner or bank. Never wants to see "revision hash", "fingerprint", "scope".
2. **Analyst (secondary):** wants SQL visible, dashboards, exports, knowledge definitions.
3. **Student / learner (tertiary):** wants AutoML with plain explanations.
4. **Operator / developer (hidden by default):** wants accuracy benchmark, traces, performance. Lives in a separate Admin area.

## 3. Scope

### In scope (this build)
- **Projects:** a project is a business workspace. Owner picks a project; every page then shows only that project's datasets, questions, dashboards, knowledge, models. Create, rename, archive project. Existing data goes into a "Default project" through a mapping table, with NO rewrite of existing rows.
- Redesigned owner experience: Home, Ask your data, Datasets, Dashboards, Predictions (AutoML), Business definitions (Knowledge base).
- Separate **Admin / Developer area** (accuracy checks, performance, traces, audit log, backups info), hidden from the owner navigation by default. Toggle in a menu. No login behind it, and the UI must say so honestly.
- Design system and plain-language copy.
- Logic fixes approved from the audit.

### Out of scope (do not build, do not fake)
- Public hosting and any multi-company-in-one-process design (option B in docs/ACCOUNTS_PLAN.md) until the owner asks. **Amended 2026-11-22 (owner decision):** logins, passwords, roles and per-company data are **in scope for the Accounts stages A0 to A8 only** (docs/ACCOUNTS_PLAN.md, approved with its amendments), one stage at a time with a stop after each. Outside those stages the app stays local and single-user. Never add a login screen or a protection claim that is not truly enforced and tested (Rule 7).
- Masking data from the AI provider.
- Real-time data connectors (databases, APIs). CSV only.
- Claims of general accuracy.

### Future version (document only)
Per-user project access, option B (several companies in one process), SMTP password reset, hosted deployment beyond the per-company package (A5), database connectors. Authentication, roles and the option C hosting package are the Accounts stages in docs/ACCOUNTS_PLAN.md (see also docs/SECURITY_AND_PRIVACY.md).

## 4. Product stages (each is a reviewable milestone)

**Stage 0: Audit (no code changes)**
Walk the full owner journey on throwaway data with desktop 1280 and mobile 390 screenshots. Write `docs/AUDIT.md`: ranked UI problems and logic bugs, each with screenshot, severity (blocker/major/minor), cause, proposed fix. Separate bugs from design opinions.
Done when: owner approves the list.

**Stage 1: Foundation: design system + information architecture**
- Tokens (one brand color, neutrals, semantic colors), type scale (min 14px body), 8px spacing, radius, shadows.
- Shared components: Button (one primary per screen), Card, PageHeader, EmptyState, ErrorState, Skeleton, StatusChip, DataTable, Modal, Drawer, Tabs, Toast. A `/design` dev page showing all.
- New navigation for owners: Home, Ask, Datasets, Dashboards, Predictions, Business definitions. Admin/Developer items move under a separate "Admin" entry.
Done when: every page uses shared components; no ad-hoc styles; axe and responsive checks pass.

**Stage 2: Projects**
- Additive migration: `projects` table, `project_items` mapping (dataset, dashboard, saved chart, run, model, experiment, knowledge) so existing rows are NOT modified; the Default project owns all existing items.
- Project switcher in the top bar (replaces the confusing dataset-first context); active dataset is chosen within the project.
- Every list endpoint filters by project; new items are created inside the active project.
- Archive project (reversible); delete project only with typed confirmation and dependency preview.
- Tests prove isolation: items from project A never appear in project B (lists, selectors, search, dashboards, suggestions, RAG retrieval, knowledge, audit view).
Done when: isolation tests pass and the original workspace is unchanged except the additive tables.

**Stage 3: Owner journey redesign (hero first)**
1. **Home:** "What do you want to know?" box, 3 to 5 suggested questions, recent dashboards, setup checklist for new projects. Answer-first, no jargon.
2. **Ask your data:** large question box; suggestions; one answer sentence; one chart; collapsed "Show SQL / data / how this was calculated"; Pin to dashboard; follow-ups. Decide whether suggestion chips can run on click (must respect the existing type-confirmation rule; otherwise keep fill-only and explain).
3. **Datasets:** table-first, import in a modal, health summary, actions in a menu.
4. **Dashboards:** tidy grid, "Updated <date>" chip, calm toolbar, export in a menu.
Done when: a new owner completes upload, first answer, pin, PDF in under 5 minutes in a recorded browser run, with no help text.
Also done when (carried from Stage 1): no raw floating-point numbers on owner surfaces; Ask suggestions never sum percentage-like columns such as `discount_pct` and never show raw quoted column names; the question placeholder cannot be mistaken for typed text; these pages use the shared Card and Modal (dashboard confirm, revision restore, dataset delete dialogs); dataset names are not truncated mid-name; no edit icons when edit mode is off; Design page swatch labels are readable. The "How this was calculated" section shows unrounded (exact) values; display rounding (fix 3b) applies only to headline answers, KPIs and summaries.

**Stage 4: Predictions and Business definitions**
- Predictions (AutoML): guided steps with plain language, honest measured results, no invented claims.
- Business definitions (Knowledge): simple "What do your columns mean?" and "Your key metrics", with draft-with-AI; verified-example machinery moves under "Advanced".
Done when: each is usable without reading docs; all safety rules still hold.
Also done when (carried from Stage 1): Business definitions has exactly one primary button; its section links are real Tabs or plain sections; knowledge/review dialogs use the shared Modal; the Predictions step bar fits on one row (or a compact stepper) at 390px; no jargon ("fingerprint", "registered rows", "Macro F1") without a plain-language explanation; both pages use the shared Card; AutoML leakage warning (approved fix 3c) is shown before and after training.

**Stage 5: Admin / Developer area**
Accuracy check (Evaluation), Performance & errors, Execution traces, Audit log, Backup info. Clearly labeled "Admin tools: not protected by a login", shown only when toggled on.
Done when: owner navigation contains none of it.
Also done when (carried from Stage 1): Admin pages use the shared Card; the evaluation drawer uses the shared Drawer.

**Stage 6: Logic fixes (approved from audit)**
Likely candidates (verify first): sample-data detection hides real demo data (use a user-controlled flag instead of filename guessing), dataset clutter (bulk archive helper), Evaluation empty-state clarity (most questions unscored), dashboard display-currency persistence (localStorage), legacy unit confirmation is display-only, confusing "Revision not recorded" wording, heavy verified-example flow.
Anything that touches the protected areas in Section 5 needs approval first.

**Stage 7: QA and release**
Typecheck, build, lint, unit, backend, e2e, smoke, axe; update README screenshots, CHANGELOG, DEMO script; confirm the original workspace is unchanged.

**Accounts stages (approved plan: docs/ACCOUNTS_PLAN.md; build one stage at a time, stop after each).** A0 decisions and CLAUDE.md; A1 auth core (no UI); A2 roles on every route; A3 login UI; A4 people, audit, owner TOTP; A5 per-company hosted package (option C); A6 per-company AI settings; A7 isolation and hardening suite; A8 independent review and release. Decisions of 2026-11-22: option C is the design target (no hosting yet); viewer sees dashboards and saved answers only (including the rows pinned to tiles); Admin pages owner-only; accuracy check and benchmark operator-only; one-time reset link for the pilot; per-company AI keys with AI off until the owner accepts the versioned disclosure; `AUTH_MODE=off` kept for local mode with a fail-closed rule; legal terms and a data-processing agreement are the owner's job before any customer data is hosted.

## 5. NON-NEGOTIABLE RULES
1. **Back up before any change to the real workspace.** Never run the owner upgrade script without that backup. Docker may be used for checks and upgrades only after the backup exists. (Reference for the recorded state of the real workspace: [docs/BASELINE.md](docs/BASELINE.md).)
2. No live AI calls in dev/tests; use the controlled provider fixtures.
3. Do not change: SQL guard and sandbox worker, Evaluation scoring and comparator, currency arithmetic and rate provenance, AutoML training and registry, editor save mechanics. If needed, STOP and ask.
   Approved exceptions (2026-11-15), each limited as stated: (a) remember confirmed column types per dataset in a new additive table, no change to the SQL guard/worker/comparator, with tests that types survive leaving/returning to Ask and the confirmation rule still holds; (b) display-only number rounding for non-currency formatting, no change to currency arithmetic, rate provenance or stored values; (c) AutoML leakage warning only (before and after training), no change to training, registry or reported metrics. Anything else in these areas: ask first.
4. Never invent facts: no currency/units from column names, no model-written findings in result cards, no quality badges without documented thresholds, no improvement claims without a stored baseline, no general-accuracy claims. **Amended 2026-11-20 (owner decision):** units (money, currency, percentage) are shown only after the owner confirms them; name hints are suggestions only (they may pre-select a value labelled "suggested" in the first-visit confirmation card and in Business definitions, and are never shown as a result).
5. Helpful feedback never enters prompts, RAG or knowledge. Verified examples need explicit approval plus an independent reference check. Benchmark Q&A never enters RAG.
6. Never backfill or rewrite historical records.
7. No fake security. **Reworded 2026-11-22 (owner decision):** a login, a "private", "secure", "separate" or "protected" label, a role restriction or a "mask from AI" toggle may appear in the product or in any document **only when it is enforced and tested**, and the **claim ladder in docs/ACCOUNTS_PLAN.md (section 10) governs all wording**: nothing is said that the ladder does not yet allow. While login is off (`AUTH_MODE=off`, local mode) the app says plainly that it has no login. No UI text or document claims security before the stage that proves it.
8. **RETIRED.** (Was: do not delete the duplicate chart on the original dashboard.) The duplicate chart was removed through normal use of the original app before the upgrade, so this rule no longer applies.
9. Test baseline must not regress. Current baseline (measured 2026-11-22 after the Stage 7 follow-up, controlled fixtures): **303 frontend unit, 438 backend, 74 browser, 1 clean smoke** (logs `docs/stage7/followup-verification/`). The whole suite must stay green with `AUTH_MODE=off` at every Accounts stage. (Earlier baselines: 197/361/49/1 on 2026-11-15; 300/437/71/1 after Stage 6.)

## 6. Working agreement
- Small commits, one concern each, on branch `product-redesign`. **Paused until git exists** (owner decision 2026-11-15: no `git init`, branches or commits; before code changes make a zip snapshot outside the project instead, e.g. `../InsightIQ_pre_stage1.zip`).
- After each stage: summary, files changed, tests vs baseline, before/after screenshots (390, 768, 1280), what you chose not to do and why.
- Ambiguity or rule conflict: ask one concise question.
- Prefer removing complexity over adding it. Every screen must be understood in 5 seconds.
- Never mark done without running it in a browser.

## 7. Token economy
- Stage reports: max 40 lines. One results table vs baseline, then "changed assertions", "not done", "needs my decision". No re-listing of what tests already show; link evidence files instead.
- Run targeted tests while working; run the full suite ONCE at stage end.
- Do not re-read or re-print large files; grep or read only the needed range.
- Do not re-explain rules or restate the plan in replies.
- One screenshot pass per stage, at the end, only for screens that changed.
- Quality gates are unchanged: Rule 3 byte check, real-workspace read-only check, baseline table, backup first.
