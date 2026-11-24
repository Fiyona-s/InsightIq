# Accounts plan: a login and one data folder per company

## Status: on hold (2026-11-22)

- Login, roles, people, one-time links, owner two-step sign-in and the security log are built and tested (stages A1 to A4). Login is **off by default** (`AUTH_MODE=off`): the app starts with no login screen, as before.
- What may be said after A4: **requires a login; users have roles; owners use two-step sign-in** (when login is on).
- It has **not been independently reviewed** and is **not ready to host any customer's data**.
- **A5 (hosted package, `deploy/`, `docs/OPERATIONS_HOSTED.md`) is built but NOT reviewed by the owner.** It was run on one computer only: real certificates and a real server were not exercised. **A6 to A8 are not started.** The product is **not ready to host any customer's data**.
- Before any hosting: A5 reviewed, A6 AI settings, A7 isolation suite, A8 independent review, and terms reviewed by a lawyer. No stage starts until the owner says so.


> **Approved 2026-11-22 with amendments (see "Approved decisions and amendments" below).** Status: stages A0 to A4 are done. A5 to A8 are on hold: A5 is built but not reviewed by the owner (real certificates and a real server not exercised); A6 to A8 are not started.

Date: 2026-11-22. **Planning only. No code was changed. I have stopped for your approval.**

Safety steps done first (Rule 1): real-workspace backup `.backups/pre-accounts-20261122` (integrity ok, registry 1 to 13), code snapshot `../InsightIQ_pre_accounts.zip` (no node_modules, .venv, caches, `.backups`, build output). `sh docs/baseline/check.sh` reports UNCHANGED. Read for this plan: `CLAUDE.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/RELEASE_CHECKLIST.md`, `docs/STAGE2_REVIEW.md` (removed), the `ROUTE_SCOPES` list in `backend/app/projects.py`, and the code that decides where data, workers and caches live.

## 0. Summary

**Recommendation for the first paying customer: option C, one hosted instance per company** (one container and one data volume per customer, behind HTTPS, with a real login inside the app). It reuses the app as it is (one company, one data folder, one catalog), so company separation is physical, not a filter that every one of 120 routes must remember. The code work is a login, roles, and a hosting package. I would defer multi-company-in-one-process (option B) until there are enough customers to justify it.

**No Rule 3 file needs to change** for this recommendation (section 8). Two places where a change *could* creep in are named there so you can veto them.

**Nothing may be claimed** ("your data is separate and protected") until the tests in section 9 pass and an independent review has been done. Until then the app stays honest: it says it has no login (local mode) or it requires a login (hosted mode), and says nothing more.

**CLAUDE.md must be amended before any build** (section 10, stage A0): Section 3 lists logins as out of scope and "Future version (document only)", and Rule 7 forbids a login that does not truly protect data. This stage is exactly that future version, so those lines need your explicit change.

## 1. What the code looks like today (facts that drive the design)

| Fact (checked in the code) | Why it matters |
|---|---|
| The whole app is built around **one `root` data folder and one SQLite catalog** (`create_app(data_dir)`, `main.py:144`). Every module takes that `root` and opens `root/<dataset id>.duckdb`, `root/revisions/`, `root/knowledge/` (FAISS), the model registry, `root/backups/`. | One app instance = one company's data, by construction. Two companies in one folder would need every module changed. |
| **There is no authentication, no CORS handling, no users.** The active project comes from a header or the `insightiq_project` cookie, which any client can set (`projects.py:319`). | Today's separation cannot be trusted against a deliberate user (as the docs already say). |
| **120 routes** (116 at Stage 2; **134 after A4**, 4 of them public): 79 path-scoped, 23 global, 9 filtered lists, 7 body-checked, 2 creates. One middleware enforces project scope; `ROUTE_SCOPES` plus `test_stage2_route_scopes.py` fail if a route is unclassified. | The same pattern can carry an access level for each route. |
| Workers get a **scrubbed environment** (`PATH` and thread counts only, `cwd=/tmp`): the SQL worker (`execution.py`) and the ML worker (`automl/process.py`). | API keys and app secrets are not visible to the sandboxed code. Good. |
| The AI provider reads **`LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` from the environment at call time** (`provider.py`). | One key for the whole server today. Per-company keys need a small change in `provider.py` (not a Rule 3 file). |
| The embedding model is loaded **lazily, read-only** from a shared folder; indexes are per dataset under the company's own root, namespaced by a per-root `workspace.json` id. | Sharing the public embedding weights is safe; indexes are already per root. |
| Exports and PDFs are **built in memory and streamed** (no files kept for downloads). | No download folder to leak; path-based leaks are limited to snapshot paths stored in the catalog. |
| Thread pools, slot semaphores and the saved-answer store are **instance attributes** (`analyst.py`, `automl/service.py`), not module globals. The only global state found is public (FX rates). | Separate instances do not share jobs or caches. Several companies in one instance would. |
| The frontend's Rule 3 files (`datasetEditorApi.ts`, `lib/currency.tsx`) call the API through the shared `request()` in `api.ts` (not a Rule 3 file). | A session cookie and a 401 handler can be added in `api.ts` without touching them. |

## 2. Deployment options

What a login protects, in one sentence each: **it protects the application from people who can reach it over a network and have no account.** It does **not** protect against someone with access to the server or computer's files, an operating-system administrator, a stolen unlocked laptop, a stolen backup, or a bug in the app. Data at rest is **not encrypted** by the app (DuckDB and SQLite files are plain files); disk encryption is a separate measure.

| | **A. Local on each customer's computer** | **B. One hosted server for all companies** | **C. One hosted instance per company** |
|---|---|---|---|
| What it is | Today's app, installed per customer (Docker Desktop or Python), with a login added. | One deployment, one process, many companies. | One container and one volume per customer on a server you run, each with its own address (`acme.yourdomain`). |
| **What the login protects** | Other people on the network (the API is on loopback). It does **not** stop other users of that computer, anyone with the disk, or a stolen laptop: the data files are plain files. Weakest protection of the three. | Companies from each other, **only if** isolation is correct everywhere (files, indexes, caches, jobs, 120 routes). Highest damage if one bug exists: one flaw can expose every company. | Outsiders from the instance. Companies are separated by a **container and volume boundary**, not by code that must remember to filter, so a bug in one instance cannot read another's files. |
| **Where data lives** | The customer's disk. You never hold it. | Your server, in per-company folders (or a shared catalog). You hold everyone's data. | Your server, one volume per company. You hold it. |
| **HTTPS** | Not needed on loopback. | Required: Caddy with a free Let's Encrypt certificate (needs a domain name, about 10 EUR a year; free subdomain services exist but are fragile). | Same as B: Caddy or Traefik, one certificate per address (or a wildcard). |
| **Backups** | Customer's job. You can only advise (Backup info page). High risk of "no backup". | Yours: per-company backups from one box (restic to off-site storage, encrypted). | Yours: one volume per company, same tool, easy to restore one company without touching others. |
| **Cost** | No hosting cost. High support cost (installs, upgrades, "it will not start"). | One small server (about 2 to 4 vCPU, 4 to 8 GB RAM) for many companies. Lowest cost per company, but the app is memory hungry (see below). | About 1 to 2 GB RAM per company at the app's current limits (`mem_limit: 2g` in `compose.yaml`; measure before promising), so roughly one small server per 2 to 4 companies. Cost grows linearly. |
| **Effort (relative)** | Small engineering (login and roles in one company), large ongoing support. | **Large**: multi-company code in a process built for one, per-company executors and quotas, and the largest test surface. | **Medium**: login and roles, hosting package, provisioning script, backup script. Most of the code is shared with A. |
| **Main risk** | Customer data loss; unsupported installs; a login that looks protective but is not. | Cross-company leak; one company's AutoML job starving the others; one upgrade affects everyone. | Operations load grows with every customer; many certificates and backups to watch. |

**Free-tier reality check (verify on the day; these change often, and I cannot browse prices from here).** The *software* in this plan is all free and open source. A **host** that is safe for paying customers' data is not free in practice:
- The app needs about 2 GB of RAM, a persistent disk, long-running processes and the ability to run containers (the query sandbox uses Linux seccomp). That rules out static/serverless free tiers and the 1 GB "always free" micro VMs.
- Free web-service tiers that sleep when idle or have no persistent disk (some PaaS free plans) cannot hold a database or datasets.
- Oracle Cloud's "Always Free" Arm instances (large RAM allowance) are the one free option that could fit, but they have had capacity shortages, can be reclaimed when idle, and are not something I would put a paying customer's data on without a tested restore.
- Realistic floor: a **small paid VPS, a few euros a month**, plus a domain. For a pilot, a customer's own server or an always-on machine at their site (option A or C with a tunnel such as Cloudflare Tunnel or Tailscale) is possible; note that Cloudflare Tunnel terminates TLS at Cloudflare, which is a trust decision you must disclose.

### Recommendation: C for the first paying customer

1. **It matches what the code is.** The app is a one-company application. Option C adds a login to it and puts it on a server; option B first has to turn it into a multi-company application.
2. **Separation by construction.** The catalog, datasets, indexes, models, saved answers and backups are all under one volume that only that company's container mounts. There is no company filter to forget on any of the 120 routes. The things most likely to leak in B (caches, thread pools, FAISS folders, job queues) are separate processes in C.
3. **Honest claims are easy to make and test.** "Your data lives in its own container and volume" is true and checkable.
4. **Backups and deletion are per customer.** Restore one company; delete one company at contract end.
5. **It does not close the door on B.** Section 3 keeps a `company` row and a company id in the session so a later gateway can mount several instances (still one data folder each).
6. **Why not A:** a login on a laptop gives little protection, you cannot guarantee backups or updates, and support cost is high. A stays supported as "local mode" (login optional) for demos, tests and your own workspace.

Cost of the recommendation, honestly: about one server (a few euros a month) per 2 to 4 customers, an operations routine (updates, certificate, backup checks), and your role as the party who holds their data (get a lawyer-reviewed data-processing agreement and terms; this plan is not legal advice).

## 3. User model (for option C, written so B can follow)

**Company.** One row per instance (`companies`: id, name, created_at, AI settings). In option C there is always exactly one. Your existing workspace becomes the **Default company** (section 6).

**Users.** `users`: id, company id, email (unique, lower-cased), display name, role, password hash, active flag, created/last login, failed-login counters. No company-less users except the platform **operator** (below).

**Roles** (checked per route, section 4):

| Role | Can | Cannot |
|---|---|---|
| **viewer** | Open dashboards and the saved answers pinned to them, download PDF/CSV of dashboards they can see. | See raw dataset rows, ask questions (this spends AI credit and sends data to the provider), upload, edit, see Business definitions or Predictions, see Admin pages. |
| **analyst** | Everything a viewer can, plus upload and edit datasets, ask questions, pin, write definitions and approve drafts one by one, train and use predictions, create and change dashboards and projects. | Delete datasets and projects, manage users, change company settings (AI key, spend limit, disclosure), see Admin pages. |
| **owner** | Everything an analyst can, plus delete datasets, projects and dashboards, manage users and roles, company and AI settings, accept the AI disclosure, and the **Admin pages that concern the company** (Dataset change history, Backup info, Performance and errors, Execution traces). | Platform operations (below). |
| **operator** (not a company role) | Server-level: create a company, create the first owner, reset an owner's password, view the accuracy check/benchmark. Done by a **command-line tool on the server**, not through the customer's UI. | Reading customer data through the app. |

**Admin tools become role-protected.** The browser switch (`insightiq-admin-tools-v1`) is removed in hosted mode. The Admin pages are shown and served only to the owner; the accuracy check and benchmark endpoints are operator-only (hidden, not merely disabled, for customers). Local mode keeps the switch and its honest banner.

**Passwords.** Hash with **Argon2id** using the free `argon2-cffi` library (MIT licence), OWASP-recommended parameters (about 19 MiB memory, 2 passes, 1 lane), per-user salt, re-hash on login if parameters change. Why: it is the current default recommendation, widely used, has Python 3.9 to 3.12 wheels. The standard library's `hashlib.scrypt` is an acceptable zero-dependency fallback. Rules: at least 12 characters, no composition rules, reject the most common passwords (a small bundled list), no maximum below 128.

**Sessions.** Server-side sessions in the company's own catalog (`sessions` table): a random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie, only its SHA-256 stored, idle timeout (proposal: 12 hours), absolute lifetime (7 days), rotated at login, revoked on logout, password change and deactivation, and listed to the user ("sign out everywhere"). Why not signed-cookie sessions or JWTs: they cannot be revoked, which matters for deactivating a user. I would **not** adopt a full framework: FastAPI Users or an identity server (Keycloak, Authentik) bring much more surface than a one-company app needs. About 300 lines in a new `auth.py`, with the free libraries above, keeps it reviewable.

**CSRF.** `SameSite=Lax` cookie plus a server-side **Origin/Host check on every state-changing request** (POST, PUT, PATCH, DELETE), which needs no client change. The shared `request()` in `api.ts` can add a double-submit token later without touching any Rule 3 file.

**Reset flow.** No email server is assumed (a free SMTP account is optional later). Phase 1: the owner generates a **one-time reset link** (256-bit token, stored hashed, 24 hours, single use, revokes all sessions) and hands it over out-of-band; the operator CLI resets an owner. Same message and timing whether or not an email exists. Password change requires the current password.

**Brute-force protection.** Per account and per client address counters in the catalog (`login_attempts`): after 5 failures, a growing delay up to a 15-minute lock; a uniform "email or password incorrect" answer; Argon2 cost makes guessing slow. Optional, later: TOTP two-factor for owners with `pyotp` (MIT). Caddy can add a coarse rate limit per address in front.

**Security audit log.** A new `audit_events` table (login, failed login, logout, role change, password reset, user create/deactivate, AI key change, disclosure accepted, data deletion). Separate from the existing dataset change history; it records the real user id, and says so. It still would not be tamper-proof against someone with server access.

## 4. Projects become company-owned; every route gets an access level

**Option C (recommended): company ownership is the instance.** The Stage 2 design stays: projects, `project_items`, the virtual Default project, the one middleware that resolves the active project. They all live in the company's catalog, so they are company-owned by construction. What changes:

1. **One access middleware** runs first and decides in this order: security headers; **authenticate** (session cookie to user and company, else 401, with an explicit short list of public routes: four after A4, which are health, auth status, login and redeeming a one-time link); **Origin check** for unsafe methods; **role check** from a table; then the existing **project resolver**. The `insightiq_project` cookie and `X-InsightIQ-Project` header remain a *selection inside the company*, never an authorisation.
2. **Default-deny.** A route that is not in the access table is refused (403) and fails the test below.
3. **`ROUTE_ACCESS`**, next to `ROUTE_SCOPES`: `{route: minimum role}`, with values `public | viewer | analyst | owner | operator`.

| Route group (today's count) | Proposed minimum role | Notes |
|---|---|---|
| `/api/health` (1) | public | Returns status only, no data. |
| `/api/auth/*`, `/api/users/*`, `/api/company` (new) | login public; the rest by session; users and company: owner | Rate limited. |
| `/api/currency/*` (2) | viewer | Public rate data; needs a session. |
| `/api/projects` (7) | list: viewer; create, rename, archive, restore: analyst; delete: owner | Project is a view inside the company. |
| `/api/datasets` (46): reads of rows, profile, quality, revisions, knowledge, suggestions, **dataset export** | analyst | Raw data: a viewer gets 403 on every route that returns raw dataset rows or a dataset export. The only viewer-readable dataset route is `GET /api/datasets/references` (dataset names, ids and archived flags, no rows), needed so dashboards can show their source names. |
| `/api/datasets`: upload, edits, rename, types, sample flag, knowledge writes, drafts, examples, restore revision, archive/restore | analyst | Rule 5 approvals stay explicit and per item. |
| `/api/datasets`: delete, bulk delete | owner | |
| `/api/analyst` (12): create run, feedback, results | analyst | Sends data to the AI provider; also requires "AI enabled" (section 7). |
| `/api/analytics/runs` (1) | owner | Admin: Performance and errors. **Consequence for A3:** Home's "Recent questions" and the Setup guide read this route today, so Home must read the analyst's own run list instead for analysts. |
| `/api/dashboards` (15): list, view, PDF, JSON, CSV, history | viewer | **Dashboard exports (PDF, CSV, JSON) stay viewer-allowed because they contain only the rows pinned to tiles** (up to 1,000 per tile), never a dataset's rows. |
| `/api/dashboards`: create, edit, refresh, duplicate | analyst | |
| `/api/dashboards`: delete | owner | |
| `/api/saved-charts` (7): list, view, history | analyst | **Changed in A4 (your decision):** these reads are analyst level. A viewer reaches only what is pinned to a dashboard, through the dashboard routes. |
| `/api/saved-charts`: create, delete | analyst | |
| `/api/automl` (16) | analyst | CPU heavy; one job at a time per company (existing limit). |
| `/api/benchmarks` (3), `/api/evaluations` (10) | operator | **A2 decision:** with `AUTH_MODE=on` these return 404 for everyone (there is no operator web login); with `AUTH_MODE=off` they behave exactly as today. |

Company scope for the 120 routes (the scope classification you asked for) is **inherited**: with one data folder per instance, a handler can only see its own company's catalog and files. The *test* still proves it (below). If you later choose option B, the same table gains one rule: the middleware picks the company's own app instance from the session, and **no handler is ever given a shared engine or folder**.

**Variant if a shared catalog were ever used** (not recommended): add a nullable `projects.company_id` where NULL means the Default company (the same "virtual default" trick as Stage 2, so no row is rewritten, Rule 6), with every item reaching its company through its project. I reject this for now because it does not isolate files, indexes, caches or jobs, which is where the leaks would be.

**Extending the route test (`test_stage2_route_scopes.py` becomes the access test).** For all 120 routes plus the new ones:
- every route has a scope **and** an access level, or the test fails (as today);
- **unauthenticated** request: 401, except the public list;
- **wrong role**: a viewer calling an analyst route, an analyst calling an owner route, a customer calling an operator route: 403, and nothing changes in the data (verified by a before and after catalog hash);
- **cross-company** (two throwaway instances A and B, each with its own login): A's session sent to B's address is rejected (different secret and cookie name per instance); A's ids sent with B's session return 404 on every path-scoped route, as the Stage 2 test does today for projects;
- a new route added without an access level fails the suite.

## 5. Storage isolation (the main risk)

Option C isolates by separate containers and volumes. Everything below must still be **tested**; for option B each line would also need code.

| Store | Where it is today | In option C | How it is tested |
|---|---|---|---|
| Datasets and files | `root/<uuid>.duckdb`, `root/revisions/<uuid>/` | Inside the company's volume only | Two instances; A's dataset ids return 404 on B; B's volume contains no A file (file listing comparison). |
| Catalog (questions, saved answers, dashboards, charts, definitions, change history, users) | one `catalog.sqlite` | One per company | Row counts per instance; no shared database URL. |
| Knowledge and FAISS indexes | `root/knowledge/<digest(workspace id, dataset id)>` | Per company; `workspace.json` id differs per instance | Retrieval in A never returns B's text (extends Stage 2 `test_06`). |
| Models and predictions | AutoML registry under the company root | Per company | A cannot load B's model id; model files not readable across volumes. |
| Saved answers | `analyst_run_results` in the catalog | Per company | As above. |
| PDFs and downloads | Built in memory | No files kept; `Cache-Control: no-store` and `Content-Disposition` set; every download route requires a session | Unauthenticated and cross-company requests to every export route fail. |
| Snapshot paths | Relative `snapshot_path` stored in the catalog | Resolve each stored path and require it to stay inside the company root | Test with a crafted path (`../`, absolute, symlink) in a restore. |
| Background jobs and workers | Per-instance thread pools and slots; SQL and ML workers are separate processes with scrubbed environments | Separate containers, each with CPU and memory limits (`compose.yaml` already sets 2 GB, 1 CPU) | A long job in A does not delay B (measured). |
| Caches | Per-instance result store; public FX rates; shared read-only embedding weights | Nothing shared except public data and model weights | Review list plus a test that no module-level mutable state holds company data. |
| Automatic and manual backups | `root/backups/` (inside the volume) and `.backups/` on the host | Per company; **encrypted off-site copy** with `restic` (BSD licence) per company | Restore drill into a throwaway volume, as the Backup info page already documents. |
| Logs | Application and Docker logs | Log no questions, SQL or values; per-company log streams | Log review test: run a request with a secret marker and grep the logs. |
| Temporary files | The SQL worker uses `cwd=/tmp` with DuckDB temp spill disabled; ML work files live under the company's folder with mode 0700 | A private tmpfs per container | Marker test across containers. |

At rest: **not encrypted by the app.** To claim "encrypted at rest" you would need full-disk or volume encryption on the host (LUKS or the provider's), which is a host decision, plus encrypted backups.

## 6. Additive migration for your existing data

Principles (CLAUDE.md rules 1 and 6): back up first; only add; never rewrite or backfill; owner-run script.

- **Migrations** (each preceded by an automatic backup, each registry row created together with its table, as in Stage 6): **v14** `companies`, `users`; **v15** `sessions`, `login_attempts`, `password_resets`; **v16** `audit_events`; **v17** `user_totp`, `recovery_codes` (the two-step tables, added in A4). Nothing existing is altered.
- **Default company.** A single `companies` row, "Default company", owns everything that exists, by being the only company. No row is written for existing datasets, questions, dashboards, models, definitions or backups.
- **Owner-run script** `backend/scripts/enable_accounts.py` (same shape as `upgrade_projects.py`): refuses without your backup folder; supports a dry run; stops with the app stopped; adds the tables; creates the first owner from a password you type (never from a command-line argument or a file); verifies every pre-existing catalog row and storage file is byte-identical, as the existing script does; idempotent.
- **Your real workspace (migrations 1 to 13).** Nothing changes until you run the script. When you do: your 15 datasets, 56 saved answers, dashboards, models, definitions, the Default project and the "QA walkthrough - keep" project all stay where they are and belong to the Default company. Existing change-history rows keep their `actor` values (`user_ui` or empty, shown as "Source not recorded"); they are **not** attributed to the new owner. Real-workspace baseline: record a new `baseline-<date>.json` after the upgrade and point `check.sh` at it, as in Stage 6.
- **Two modes in one code base.** `AUTH_MODE=off` is today's local mode (the UI keeps saying there is no login and the Admin switch stays). `AUTH_MODE=on` requires a login. **Fail closed:** the app refuses to start with login off when it is asked to listen on anything but loopback, or when `APP_ENV=production`. Mode can never switch silently.
- **Your real workspace stays local** by default. Hosting it is a separate decision: copying it to a server means that server holds your data; use the restore procedure on a new volume, not the live volume.

## 7. The AI provider

**What reaches the provider, per company** (from `SECURITY_AND_PRIVACY.md`, unchanged by accounts): the question; the dataset's column names, confirmed types, row count and conversion statistics; that company's own definitions retrieved for the question; up to three earlier turns of the same chat (the earlier question, its SQL and a bounded computed summary, so values and category labels can appear); for a repair attempt, the previous SQL and a bounded error. A separate call can send computed result facts (values and labels). **Not sent:** the CSV file, raw rows, sample values, quality examples, benchmark answers, keys. **No masking exists.** Embeddings are computed locally.

**Key and cost model: options.**

| | Shared key (you pay) | **Per-company key (company brings its own)** (recommended) |
|---|---|---|
| Who has the provider relationship | You: you send all customers' data under your account | The company: its data goes under its own account and terms |
| Spend control | You must meter and cap each company, and you carry the cost | The company's own provider limits, plus an in-app cap |
| Setup | None for the customer | Customer needs an account; owner pastes the key once |
| Risk | One key leak affects everyone; you become the processor for all AI traffic | One key per company; a leak is contained |

**Recommendation:** per-company keys, stored **encrypted** in the company's catalog (Fernet from the free `cryptography` library, with an application secret in the environment, never in the catalog, never returned to the browser, never logged). In-app controls per company: an **AI on/off switch that starts OFF**, a monthly spend limit using the existing token-cost estimate, and a base-URL check that allows only HTTPS provider hosts and blocks private and loopback addresses (otherwise an owner could point the server at internal services: SSRF). `provider.py` changes to read these settings instead of the environment; it is not a Rule 3 file. `evaluation.py` (Rule 3) reads the environment for the accuracy check; that stays operator-only and unchanged.

**Disclosure the owner must accept before AI is switched on** (versioned; acceptance stored in `audit_events` with user, time and disclosure version; re-asked when the text changes). Draft:

> When AI is on, InsightIQ sends the following to the AI provider you configured: your questions; your column names, column types, row counts and conversion counts; the business definitions you wrote; earlier questions in the same conversation with their SQL; and, after a question runs, computed result facts such as values and category labels. It does **not** send your CSV file or raw rows. **Nothing is masked or redacted**: if a question or definition contains personal or confidential information, that is sent too. What the provider does with it (storage, retention, training, location) is set by your agreement with that provider. You can switch AI off at any time; the rest of InsightIQ keeps working. Answers can be wrong and must be checked.

## 8. Rule 3 files: what would need changing (listing only; I will stop and ask)

| Rule 3 file | Needed for option C? | Evidence and what to watch |
|---|---|---|
| `sql_guard.py` | **No** | Pure function; no paths, users or environment. |
| `query_worker.py` | **No** | Receives a database path and SQL on stdin; already runs with a scrubbed environment and no keys. |
| `execution.py` | **No** | Spawns the worker with a scrubbed environment and `cwd=/tmp`. Watch item: if a later stage wants a per-company temp folder, that is a change here (not planned; a private tmpfs per container achieves it). |
| `currency.py`, `lib/currency.tsx` | **No** | Reads the public rate provider; the only shared state is public rates. Uses the shared `request()`, so a 401 handler in `api.ts` covers it. |
| `evaluation.py`, `evaluation_presentation.py`, `evaluation_reporting.py` | **No** | Benchmark and accuracy check become operator-only by access level. `evaluation.py` reads `LLM_*` from the environment for paid evaluation and stays platform-level. Watch item: per-company evaluation keys would need a change; not planned. |
| `dataset_editor.py`, `dataset_revisions.py` | **No** | Take the instance's `root`. Only the shared-process option B with one shared root would need changes (rejected). |
| `DatasetEditor.tsx`, `datasetEditorApi.ts` | **No** | Use the shared `request()`. CSRF is handled by the Origin check, so no token plumbing is needed in these files. Watch item: if a later review insists on a CSRF token header, add it in `api.ts` (not Rule 3). |
| `backend/app/automl/*` (training, registry) | **No** | Instance-level state; workers have scrubbed environments; one job at a time per instance. Watch item: option B would need per-company quotas here. |

**Expected result: zero Rule 3 changes.** If during build a stage finds one is needed, that stage stops and asks you first.

## 9. Threats, and the tests that would prove each control

| Threat | Control | Test (all with controlled fixtures, no live AI) |
|---|---|---|
| **Cross-company access on every endpoint** | Separate instances; session bound to its instance; route access table | Two-instance harness: every one of the 120+ routes called with A's session against B and with B's ids against A: 401/403/404 as required; nothing changed (catalog hash before and after). |
| Missing login or role check on a new route | Default-deny; test fails on an unclassified route | Route-classification test (section 4). |
| **File paths and downloads** (traversal, symlinks, guessing) | UUID ids validated; every stored path resolved and required to stay inside the company root; exports need a session | Crafted ids and `snapshot_path` values; download routes unauthenticated and cross-company. |
| **PDF and export links** | No public or signed links in the first version; PDF requires a session | Unauthenticated and cross-company `report.pdf`, `results.csv`, JSON exports. |
| **RAG retrieval** | Per-company index folder and `workspace.json` id | A's knowledge text never retrieved from B (extends Stage 2 `test_06`); index files absent from B's volume. |
| **Backups** | Per-company, mode 0700, encrypted off-site (`restic`); restore drill | Restore into a throwaway volume; backup folder permissions; wrong-company restore refused by the script (workspace id check). |
| **Sessions** | Random 256-bit token, hashed at rest; `HttpOnly; Secure; SameSite`; idle and absolute expiry; rotation; revoke on logout, password change, deactivation | Fixation, expiry, revocation after password change, deactivated user's session rejected, cookie flag checks. |
| **CSRF** | SameSite Lax plus Origin/Host check on unsafe methods | Cross-origin POST/PUT/DELETE with a valid cookie is rejected. |
| **Brute force and enumeration** | Counters per account and address, lockout with growing delay, uniform errors, Argon2 cost | 6th failure locked; wrong-user and wrong-password responses identical in body and similar in time; reset request identical for known and unknown emails. |
| Password storage | Argon2id, per-user salt | Stored value is not the password or a fast hash; re-hash on parameter change. |
| Secrets exposure | API key encrypted at rest; never returned, never logged; workers get no environment | Marker test: grep responses, logs, exports and the worker environment for the key. |
| SSRF through the provider URL | HTTPS only, allowlist or block private ranges | Base URLs pointing at `127.0.0.1`, `169.254.169.254`, private ranges are refused. |
| Injection and XSS | Existing SQL guard and sandbox (unchanged); React escaping; `Content-Security-Policy` | CSP header test; stored-XSS fixtures in dataset names, titles and notes render inert. |
| Noisy neighbour and resource exhaustion | Per-instance CPU and memory limits, upload limits, per-company job limits | Long job in A while B stays responsive (measured). |
| Transport and headers | HTTPS only, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control: no-store` on data | `testssl.sh` and header tests in CI. |
| Dependencies and containers | Pinned versions, non-root user, read-only root filesystem where possible, no Docker socket | `pip-audit`, `npm audit`, Trivy image scan, docker-bench. |
| Deletion | Contract end: stop container, delete volume, delete backups by policy | Deletion script test on a throwaway company; documented retention. |
| Personal-data duties (GDPR and similar) | Data-processing agreement, retention and deletion policy, breach procedure | Document review with a lawyer. **Not** something code can prove. |

## 10. What must be true before saying "your data is separate and protected"

All of the following, evidenced and recorded in a review document:

1. Hosted mode requires a login on every route except the public list, with the role table enforced (the extended route test is green).
2. The two-instance isolation suite is green: no cross-company read, write, download, retrieval or restore on any route.
3. Sessions, CSRF, brute-force and reset tests are green; cookie flags verified in a browser.
4. HTTPS only with HSTS; `testssl.sh` clean; security headers verified.
5. Backups: encrypted, off-site, per company, restore drill done and written down; the customer knows who holds the key.
6. The AI disclosure is accepted by the owner before AI is on; per-company key encryption verified.
7. Dependency, container and secret scans are clean or each finding has a written decision.
8. An **independent** review has been done (below), its findings fixed or accepted in writing, and the review kept with the release.
9. Operations are written down: updates, certificate renewal, backup monitoring, incident procedure, how a customer is deleted.

**Claim ladder: what may be said after each stage, and not before**

| After | May say | Must **not** say |
|---|---|---|
| Local mode (today) | "Local, single-user, no login." | Anything about protection or separation. |
| Login and roles tested (A2 to A3) | "Requires a login; users have roles." | "Secure", "separate", "protected". |
| Hosted package and backups tested (A5) | "Served over HTTPS; each company runs in its own container with its own data volume; encrypted off-site backups." | "Your data is protected", "cannot be accessed", "compliant". |
| Isolation suite and independent review done (A7 and A8) | "Each company's data is stored separately and access requires that company's login; we tested this with the following methods (list)." | "Unhackable", "guaranteed", "compliant with X" (unless an auditor said so), "encrypted at rest" (unless disk encryption is enabled and verified). |

Permanent **must not claim**, whatever the stage: that the AI provider cannot see their data; that answers are correct; that nothing can go wrong with a backup; that the Admin pages are safe because they are hidden.

**Independent security review, with free tools.** A person who did not write the code runs: **OWASP ASVS** (Level 1 fully, selected Level 2 items) as the checklist and **OWASP WSTG** for the test methods; **OWASP ZAP** baseline and authenticated scans (Apache 2.0); **Nuclei** templates (MIT); **testssl.sh** (GPL) and Mozilla Observatory for TLS and headers; **Trivy** (Apache 2.0) for images; **pip-audit** (Apache 2.0) and `npm audit` for dependencies; **Bandit** and **Semgrep OSS** for code; **gitleaks** (MIT) for secrets; **Lynis** and **docker-bench-security** for the host and containers; manual tests for IDOR and path traversal with a second company's account. Ideally a paid penetration tester repeats this once before a second customer.

## 11. Staged build order (each stage reviewable; I stop after each)

| Stage | Content | Done when |
|---|---|---|
| **A0 Decisions** | You approve this plan; amend CLAUDE.md (Section 3 scope, Rule 7 wording, new baseline counts: unit 303, backend 438, e2e 74, smoke 1); choose the deployment and the open questions below. Backup and snapshot again. | CLAUDE.md amended in writing. |
| **A1 Auth core (no UI)** (done) | Migrations v14 and v15 with backups; `auth.py` (Argon2id, sessions, lockout); `AUTH_MODE` and fail-closed startup; operator CLI to create a company owner; access middleware with the public-route list only. | Unit and backend tests for hashing, sessions, lockout, fail-closed, migrations on a fresh, an existing and an already-migrated database. |
| **A2 Roles on every route** (done) | `ROUTE_ACCESS` for all 120 routes; default-deny; extended route test (401, 403, 404, no data change); Admin endpoints role-protected; operator-only benchmark. | Route test green; all existing tests pass in `AUTH_MODE=off` unchanged. |
| **A3 Login UI** (done) | Login, logout, session expiry and 401 handling in `api.ts`; role-aware navigation; Admin switch replaced by the owner role in hosted mode; honest copy (no "secure" or "private"); first-login password change. | Browser tests for each role; axe, overflow, 14 px at 390, 768, 1280. |
| **A4 People, audit and owner TOTP** (done) | Owner screens: users, roles, deactivate, reset link; `audit_events` (v16; the two-step tables are v17) and a security-log page; password-change flow; **TOTP two-factor, required for owners in hosted mode**. | Tests for every role change and reset path. |
| **A5 Hosted package (option C)** | Compose and Caddy (HTTPS), one volume and one secret per company, provisioning and deletion scripts, restic encrypted backups with restore drill, resource limits, fail-closed in production. | Provisioning two companies on a staging host; restore drill written up; `testssl.sh` clean. |
| **A6 AI settings** | Per-company encrypted key, AI off by default, spend limit, SSRF guard, disclosure acceptance. | Secret-exposure and SSRF tests; disclosure text reviewed by you. |
| **A7 Isolation and hardening suite** | The two-instance harness (cross-company, files, downloads, RAG, backups, jobs, caches); CSRF, brute force, headers, CSP; free scanners in a script. | Everything in section 9 green. |
| **A8 Independent review and release** | Independent review with the checklist above; fixes; the claim ladder applied to README, the app and the release checklist; pilot with one customer. | Written review accepted by you. |
| *Later* | Option B gateway (several company instances in one process), optional SMTP reset email, per-project access inside a company. | Only on your request. |

Each stage ends with: tests against the baseline, screenshots where the UI changed, Rule 3 byte check, real-workspace read-only check, a short review document, and a **stop**.

## 12. Decisions I need from you

1. **Deployment:** approve option C for the first customer (or choose A or B). If C, where will it run (your own server, a small VPS, the customer's machine)? Cost and who holds the data differ.
2. **Roles:** is the viewer limited to dashboards and saved answers (my proposal), or may viewers also ask questions? Who gets the Admin pages: owner only (proposal)?
3. **Reset flow:** is "owner generates a one-time link, handed over out-of-band" acceptable for the pilot, or do you want email reset now (needs an SMTP account)?
4. **AI keys:** per-company keys, AI off until the owner accepts the disclosure (proposal)?
5. **CLAUDE.md:** approve amending Section 3 and Rule 7 as described in stage A0.
6. **Local mode:** keep `AUTH_MODE=off` for your own workspace and tests (proposal), with the fail-closed rule?
7. **Legal:** you will arrange lawyer-reviewed terms and a data-processing agreement before a paying customer's data is hosted (I cannot do that).

## 13. Approved decisions and amendments (2026-11-22)

**Decisions.** 1: option C is the design target; no hosting yet. 2: **viewer** sees dashboards and saved answers only. A viewer **does see the rows pinned to the dashboard tiles** (each tile keeps up to 1,000 result rows, and the PDF, CSV and JSON exports of a dashboard contain them), so "viewer" does not mean "sees no data"; it means no access to the full datasets, questions, definitions, predictions or Admin pages. Admin pages are owner-only; the accuracy check and benchmark are operator-only. 3: the one-time reset link is accepted for the pilot. 4: per-company AI keys; AI stays off until the owner accepts the versioned disclosure. 5: CLAUDE.md Section 3 amended (login in scope for the Accounts stages); Rule 7 kept and reworded (a login or protection claim is allowed only when enforced and tested; the claim ladder in section 10 governs all wording). 6: `AUTH_MODE=off` stays for local mode, with the fail-closed rule. 7: legal terms are the owner's job before any customer data is hosted.

**Amendments to the plan**
- **(a) TOTP two-factor moves into stage A4** (`pyotp`, MIT) and is **required for owners in hosted mode** (removed from "Later").
- **(b) Encryption secret for stored AI keys.** The application secret that encrypts the per-company AI keys (A6) has **its own documented backup, separate from the data backups** (data backups must not contain it, and it must not be stored next to them). **If the secret is lost, the stored AI keys cannot be decrypted**: no data is lost, but every company's AI key must be pasted in again by its owner and AI stays off until they do; the app must say so plainly instead of failing silently. **If the secret is leaked, rotate it:** generate a new one, re-encrypt or re-enter every key, and treat the old provider keys as exposed (revoke them at the provider). The same separation applies to the session and any other secret introduced later. A6 documents the backup, rotation and loss procedures and tests the lost-secret behaviour.
- **(c) Secure cookie on localhost.** The session cookie is `Secure`. Browsers differ on accepting `Secure` cookies over `http://localhost`; the behaviour is **tested in Chrome, Firefox and Safari and the result is documented** (A1 review) before any login UI relies on it. Where a browser rejects it, local `AUTH_MODE=on` use is documented accordingly; hosted mode always uses HTTPS.
- **(d) The full existing suite stays green in `AUTH_MODE=off` at every stage** (unit, backend, all browser tests, smoke), and each stage review shows it.

**Stage order after the amendments.** A0 decisions; A1 auth core (no UI); A2 roles on every route; A3 login UI; **A4 people, audit log and owner TOTP**; A5 hosted package (option C); A6 AI settings (with the secret backup procedure); A7 isolation and hardening suite; A8 independent review and release.

**A3 notes (2026-11-22).** `/api/datasets/references` stays viewer-readable; `/api/analytics/runs` stays owner-only, so in hosted mode Home's "Recent questions" and the Setup guide read `GET /api/analyst/runs` for analysts and owners, and a viewer's Home shows dashboards only and makes no analyst-route call. The first-login password change needed one new route, `POST /api/auth/change-password` (ROUTE_ACCESS `viewer`, i.e. any signed-in role), so the route count is 125. In hosted mode a viewer-readable saved chart holds exactly what a pinned tile holds (checked and pinned by a test); which saved charts a viewer can reach is described in `ACCOUNTS_A3_REVIEW.md` (removed).

**A4 notes (2026-11-22).** Built: People page (owner only), one-time links for invites and resets (24 hours, single use, stored only as a hash, token in the URL fragment), voluntary password change for every role, owner two-step sign-in (TOTP, eight single-use recovery codes, secret encrypted with a per-company key from `AUTH_TOTP_KEY`), `audit_events` (migration v16; the two-step tables are v17) with an owner-only Security log, and operator commands (`unlock`, `reset-2fa`, `reset-link`) in `accounts_cli.py`. One public route was added knowingly (`POST /api/auth/redeem`), and nine routes in all (134 routes). Saved-chart reads became analyst-level, so a viewer reaches only what is pinned to a dashboard. **Losing `AUTH_TOTP_KEY` means enrolled owners cannot sign in until the operator runs `accounts_cli.py reset-2fa` for each of them and they enrol again; production refuses to start without the key.** The log is a list of records the app wrote; this document and the app do not call it tamper-proof. Details and test counts: `ACCOUNTS_A4_REVIEW.md` (removed).
