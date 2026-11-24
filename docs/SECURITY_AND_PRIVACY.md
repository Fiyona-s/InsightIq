# Security and privacy — local single-user deployment

InsightIQ has **no authentication and no supported multi-user/public-hosting isolation**. Compose publishes the web/API on loopback. Workspace/dataset namespaces prevent accidental cross-dataset retrieval; they are not authenticated authorization. Do not expose this deployment publicly.

## Exactly what can leave the machine

| Operation | Outbound data / boundary |
|---|---|
| AI SQL generation | The question, authorized dataset/schema identifiers, row count, confirmed types/conversion statistics, selected dataset-scoped retrieved definitions/examples, clarification choice and bounded prior thread context. Repair can include the previous SQL and a bounded validation/execution error. |
| Narrative fact selection | The question and computed evidence facts derived from actual query output, including values/category labels. The displayed narrative is grounded to known fact IDs; this is not a privacy filter. |
| Knowledge AI draft | Explicitly confirmed sharing of dataset name, column names, inferred types, row counts, null counts and unique counts. No schema-tab sample values, quality examples or raw dataset rows are included in this draft payload. |
| Live Evaluation | Each selected authored question plus the allowed schema/type context. Gold answers/reference SQL and the benchmark collection are excluded from generation/retrieval context. Existing cost/token/question confirmations remain required. |
| Offline Evaluation | Replays saved predictions locally: **0 new LLM calls**. Missing predictions stay unscored. It never substitutes reference SQL for a missing prediction. |
| AutoML training/prediction | Local worker, local fitted artifacts and local saved predictions. Deterministic result templates make **0 LLM calls**. No model-generated explanations are added. |
| Currency conversion | Optional approved FX endpoint receives currency pair and requested effective date. No customer rows or model/API secrets are sent. Rates are daily reference quotes, with provenance and failure handling. |
| Embedding provisioning | Explicit download of pinned public model assets. Runtime embeddings are local, local-files-only; no automatic download or cloud embedding call. |

The application does not upload an entire CSV as its normal SQL-generation payload. **Sensitive values can still leave through questions, user definitions, metric/example SQL, error text, computed evidence and prior result summaries.** The last three completed same-dataset user turns can contribute bounded context. Stored summaries include a scalar row or up to five aggregate rows under existing length/byte bounds; raw table rows are excluded from that thread summary. Evaluation turns are not Analyst thread context.

There is **no data masking, PII detection or redaction feature**. A local sample preview does not imply that all derived values are private from the configured AI provider. Provider data handling depends on the selected service/account. No live provider was exercised in the final automated tests.

Credentials stay in the API environment. The browser and isolated SQL worker do not receive them. Compatible provider requests require HTTPS except allowed loopback HTTP, disable redirects and inherited proxies, and use the existing time/response limits. LangSmith tracing is disabled around graph invocation; no cloud execution tracing is enabled by this application.

## SQL safety layers

1. CSV parsing/import validates size/shape and gives each dataset a server-owned UUID path. Original filenames are metadata.
2. A confirmed type mapping constructs a temporary `data` view. Original stored cell strings are not destructively cast.
3. SQLGlot permits only the authorized read query shape, relation, types and allowed functions. External files/network readers, writes and unauthorized relations are rejected. Model instructions do not replace this guard.
4. A separate worker re-reads physical metadata and validates SQL again. DuckDB opens read-only with external access, automatic/unsigned extensions and spill-to-disk disabled, one thread and a 128 MiB memory limit.
5. OS restrictions deny new filesystem/network capabilities after trusted initialization. Linux uses seccomp; macOS uses the existing sandbox. Unsupported environments fail closed. The parent enforces the five-second execution deadline, cancellation and result/output bounds.
6. Execution success is not proof of semantic or business correctness. Evidence, independent references and benchmark scoring are separate controls.

These layers reduce risk; they are not an authentication system or a claim that arbitrary native dependencies are vulnerability-free. No SQL guard, scoring/comparator or model-fitting logic changed in Phase 9.

## Benchmark and knowledge isolation

Benchmark gold/reference material is excluded from RAG, Knowledge approval, suggestions and SQL-generation context. Evaluation turns cannot become normal Analyst thread context. The page-only benchmark dataset override does not silently change the global dataset.

Helpful feedback does not approve SQL. Candidate examples require an independent reference, the unchanged typed comparator and explicit approval. Dataset revisions can make an example Needs re-check. Rejected drafts are never used as approved knowledge and can be explicitly cleared; approved-item provenance is retained.

## Projects organise data; they do not protect it

Projects (Stage 2) keep one business's datasets, questions, dashboards and models together, so each page shows only the current project. **They are not access control.** There is no login, so anyone using this computer can switch to, or open, any project. The active project is a browser preference sent as a cookie, which any client can change. The separation tests prove that one project's items do not *appear* in another (lists, search, retrieval, dashboards), which prevents mix-ups. They do not prove protection against a deliberate local user. Per-user project access would need authentication and server-side authorization (see below).

## Local persistence and history

The catalog contains questions, SQL, timings, events, definitions, feedback, review provenance and saved records. DuckDB contains original data and editor state. Explicitly saved charts, trained models and predictions persist locally. Some returned data can be present in saved snapshots, selected thread summaries and model/prediction artifacts after the normal Analyst cache expires.

New revision snapshots are gzip-compressed, **not encrypted**. Hash verification checks integrity, not confidentiality. Restore verifies uncompressed/staging bytes before publishing N+1 and leaves older revisions and historical results intact. Backups contain the same private material and require private storage/access controls.

`dataset_audit.actor` values such as `user_ui` identify a **local action source, not authenticated identity**. NULL historical actors remain “Source not recorded.” Legacy JSON source notes are retained without promotion into a fabricated actor.

Browser localStorage holds bounded preferences such as the selected project and dataset, sidebar/onboarding choices, the Admin-tools switch, the Show-technical-details switch, and the display currency chosen per dashboard (read and written inside try/catch, so blocked storage only loses the preference). Those are not server-side approvals, financial-value edits or authenticated audit records. Values an older build saved for model display units are left in place and no longer read. Dataset row values are not added to these new display preferences.

CSV exports retain the existing escaping/formula-injection protections. Raw JSON exports preserve source amounts; selected display currency changes presentation, not stored financial values. No API secret is embedded in exports.

## The Admin switch, sample flags and change history (Stages 5 and 6)

- **The Admin-tools switch is a browser preference, not access control.** It hides the Admin pages from the owner navigation; it does not stop anyone using this computer (or any client of the API) from opening them. Every Admin page says so in a banner.
- **Sample data is a label you set** (table `dataset_sample_flags`, migration v13). It only controls what "Hide sample data" hides. It is not a classification of sensitive data.
- **Dataset change history is not an audit trail.** It lists what the app already recorded per dataset (renames, archives, saved versions) for the active project; it does not cover questions, dashboards, models or settings, cannot say who made a change (there is no login), and is not tamper-proof.
- **Backup info is a static page**: it cannot see your folders. A backup next to the data it protects is lost with it; keep a copy of your newest backup on another device. Backups hold the same business data and need the same care.

## Accounts: stages A1 to A3 (login is off by default)

The Accounts stages are planned in [ACCOUNTS_PLAN.md](ACCOUNTS_PLAN.md). **Only the first building block exists, and it is switched off by default.** Nothing in this document, the README or the screens claims that data is separate or protected, and nothing may until the claim ladder in the plan allows it.

- `AUTH_MODE=off` (the default) is today's local mode: **there is no login** and everything above in this document still applies unchanged.
- `AUTH_MODE=on` makes the API require a valid session for every route except health, the auth status and sign-in, and (from stage A2) refuses a route when the session's role is below the route's minimum role (`ROUTE_ACCESS`), with the benchmark and evaluation routes not served at all. From stage A3 the app shows a sign-in screen and sign-out when `AUTH_MODE=on`, asks a new account to choose its own password at first sign-in, and shows each role only the pages it may open; with `AUTH_MODE=off` the app is exactly as before and says it has no login. There is no second factor, no password-reset link flow, no per-company hosting package and no completed security review. It is a foundation to be tested, not a protection to be relied on. **A reverse proxy in front of the app must pass the original `Host` header** (or `AUTH_ALLOWED_ORIGINS` must list the public address), otherwise the cross-origin check refuses every state-changing request; the hosted package (A5) will set this.
- The app refuses to start with login off when `APP_ENV=production` or when it is told it is listening on a non-loopback address; see `.env.example`. This check depends on the launcher (`python -m app.serve`) or the environment declaring the address; starting a server by other means on an open address without declaring it is **not** detected.

## Before multi-user or public hosting

A separate design and test effort would need authentication, server-side authorization on every resource, tenant-isolated storage/workers/caches, secret management, HTTPS/deployment policy, concurrency and resource isolation, dependency maintenance, audit identity, backup/access controls and deletion/retention policies. A reverse proxy or a login-looking UI alone would not provide these guarantees. None is claimed as implemented here.

## Final dependency/tooling findings

The final `npm audit` report contains nine **moderate** findings in the development lint dependency chain rooted in minimatch, with no high/critical entries in that report. The suggested fixes require major tool changes; no forced downgrade/override was applied. These findings remain documented in the final review and [audit output](phase9/verification/npm-audit.json). Lint dependencies are build/development tooling, not files served by the final static web container. This does not establish that all runtime dependencies have no vulnerabilities.

## Saved answers, hidden technical details and confirmed units (updated 2026-11-20)

**Saved answers.** Every successful question keeps its result with its own question id in the local catalog (table `analyst_run_results`, registered as migration v12). Each answer keeps **up to 1,000 rows (and at most 1 MiB)**, and the **newest 500 answers** are kept; older ones are removed from the saved-answer store. Benchmark / Evaluation runs are **never** saved this way. Saved answers stay on this computer, are not sent anywhere, and are not backfilled for questions asked before the table existed. Re-opening an answer, or "Run again on current data", makes **0 AI calls** (re-run executes the stored, already-validated SQL through the same SQL guard and isolated executor).

**Technical details are hidden by default.** The SQL tab, a dashboard tile's "Evidence & provenance" tab and result digests appear only after Menu, Settings, **Show technical details** is switched on. This is a display preference in the browser, **not** access control: the same data is reachable through the API and the Admin area, and there is no login.

**Units are shown only after the owner confirms them.** Money (with a currency) and percentages are stored per dataset in the local knowledge settings (`monetary_columns`, `percent_columns`, `units_confirmed`). Column-name hints only pre-select a "suggested" value; they are never displayed or used in calculation. Unit choices are not sent to the AI provider as facts about the data; the SQL prompt tells the model never to infer units from names.

## Live AI calls: exactly what is sent to the provider

Only when a live provider is configured (never in tests or development fixtures). For each question:

- the question text (and, for a clarification, the column or metric the owner chose);
- the dataset's **column names, the confirmed analysis type of each column, row count and conversion statistics (valid / failed counts)**;
- dataset-scoped definitions the owner wrote (column descriptions, metric names/SQL) retrieved for this question;
- up to **three earlier turns of the same chat**: each earlier question, its executed SQL and a bounded computed summary (a single row, or up to five aggregate rows of the earlier answer, so values and category labels can be included);
- for a repair attempt: the previous SQL and a bounded error message.

**Not sent as part of the SQL request:** the CSV file, raw table rows, schema-tab sample values, data-quality examples, benchmark questions or gold answers, API credentials. After a query runs, a separate narrative-selection call can send **computed result facts (values and category labels from the actual answer)**. **Sensitive values can still leave through your questions, your own definitions, SQL text, error text and those computed facts.** There is no masking or redaction. What the provider does with the data depends on the provider and account you configured.

