# Feature audit

> **Status after P6 (2026-11-22):** applied as approved: Save to library merged into Pin; Hide sample datasets merged into Datasets; Columns-tab descriptions merged into Business definitions (read-only there, with a link; stored data, routes and per-item approvals unchanged); Setup guide gone after the first answer; Compact navigation removed; JSON export removed from the dashboard menu (API route and access level kept). Execution traces and Dataset change history stay under Menu, owners only, as decided. Everything else stays. The table below is the original proposal.

Originally a proposal for approval; nothing had been deleted, merged or removed when it was written.

Written 2026-11-22 from the current build. **Who uses it** uses the four groups in the product brief: **Owner** (non-technical business owner, primary), **Analyst**, **Learner** (predictions), **Operator** (admin and testing). **Decision** is my recommendation only: **keep**, **merge** (fold into another place, keep the capability), or **remove** (delete the feature). Every "remove" says what would be lost. Routes in brackets are the API areas involved (counts from the route table: datasets 46, dashboards 15, automl 16, analyst 12, evaluations 10, auth 8, saved-charts 7, projects 7, users 5, benchmarks 3, currency 2, analytics 1, audit 1).

## Pages

| Page | What it does | Who | Decision | Why |
|---|---|---|---|---|
| Home | One question box, suggested questions, dashboards, recent questions | Owner | keep | The first thing an owner sees; already minimal. |
| Ask | Plain-English question, one answer, chart, pin, follow-ups | Owner, Analyst | keep | The core of the product. |
| Datasets | Table of files, import, preview and edit, columns, health, currency note, version history | Owner, Analyst | keep | Needed to add and check data. |
| Dashboards | Pinned answers in a grid, refresh, PDF/CSV/JSON export, history | Owner | keep | Output the owner shares with a partner or bank. |
| Predictions | Guided model training with measured results | Learner, Analyst | keep, simplify | Honest and local, but a second product; keep the three common tasks first (see features). |
| Business definitions | Column meanings, key metrics, units, AI drafts, advanced examples | Analyst, Owner | keep | Makes later answers consistent; units live here (Rule 4). |
| Projects (Menu) | Create, rename, archive, delete with dependency preview | Owner | keep | Separates businesses; already tucked in the Menu. |
| Settings (Menu) | Hide sample datasets, compact navigation, currency offered, technical details | Owner, Analyst | keep, trim | Four switches; two duplicate other places (see features). |
| Change password (Menu, login on) | Voluntary password change | Everyone, only when login is on | keep | Required once login exists; hidden when login is off. |
| Accuracy check (Admin) | 45-question fictional benchmark: offline replay or live run | Operator | keep (hidden) | The only place accuracy is measured, with its limits stated; not owner-facing. |
| Performance and errors (Admin) | Question counts, latency, failures | Operator | keep (hidden) | Useful for support; not owner-facing. |
| Execution traces (Admin) | Step-by-step trace of a question | Operator | merge | Could live as a tab of Performance and errors: one Admin page instead of two. |
| Dataset change history (Admin) | What the app recorded about dataset changes | Operator, Analyst | merge | Duplicates Datasets "Version history"; one place is enough. |
| Backup info (Admin) | Where data lives, how to back up and restore | Operator, Owner | keep (hidden) | Honest backup guidance; the app cannot see the owner's folders. |
| People (Admin, login on) | Invite, roles, deactivate, one-time links | Owner of a hosted company | keep (on hold) | Part of the accounts work, off by default. |
| Security log (Admin, login on) | Sign-ins and people changes the app recorded | Owner of a hosted company | keep (on hold) | Same. |
| Design system (development only) | Shows shared components | Developer | keep | Not in production builds. |

## Features by page

| Where | Feature | What it does | Who | Decision | Why |
|---|---|---|---|---|---|
| Home | Suggested questions (max 3) | Built from confirmed columns | Owner | keep | Removes the blank-page problem; nothing invented. |
| Home | Dashboards and Recent questions cards | Open a dashboard or a saved question in one click; repeated questions grouped | Owner | keep | Small and clear. |
| Home | Setup guide (4-step checklist, shown when a dataset exists) | Counts progress to a first dashboard | Owner (new) | remove (or merge into the empty-state) | First-run now has its own single path; a checklist after that nags. You would lose a progress hint. |
| Home | Sample data button | Adds a labelled fictional file only when pressed | Owner (new) | keep | Lets someone try it without their own data. |
| Ask | Dataset picker in the question box | Choose which file to ask about | Owner | keep | Needed. |
| Ask | Column-type check | You confirm what each column holds | Owner, Analyst | keep | Rule 4; it is the trust step. |
| Ask | "What are these numbers?" units | Money or percent only when you confirm | Owner | keep | Rule 4. |
| Ask | "What is sent to the AI?" | Opens the exact data-sharing text | Owner | keep | Honest disclosure; must stay reachable. |
| Ask | Answer sentence, chart, Visualization switch | One sentence and an auto-chosen chart; owner can switch | Owner | keep | Core. |
| Ask | Pin to dashboard | Saves the chart and puts it on a dashboard | Owner | keep | Core. |
| Ask | Copy answer | Copies the sentence | Owner | keep | One click, no cost. |
| Ask | Menu: Download CSV | Result rows as CSV | Owner, Analyst | keep | Common need. |
| Ask | Menu: Run again on current data | Re-runs a saved question without the AI | Owner | keep | A real advantage; cheap to keep. |
| Ask | Menu: Save to library | Saves a chart without a dashboard | Owner | merge | "Pin to dashboard" already saves; two ways confuse. |
| Ask | Menu: Propose as verified example | Sends an answer to review in Business definitions | Analyst | merge | Belongs inside Business definitions, Advanced; it is jargon on the owner's page. |
| Ask | Helpful / Not helpful | Stored for you; never sent to the AI | Owner | keep | Rule 5 compliant; tiny. |
| Ask | Show details (Data, SQL, How this was calculated) | Result rows, the query (with technical details on), a plain explanation | Owner, Analyst | keep | Core trust feature. |
| Ask | Currency display controls on a result | Convert displayed money to another currency with a stated rate | Owner | merge | Rarely needed; move into Show details so the answer card stays calm. |
| Ask | Follow-ups and earlier turns | A thread of up to three earlier turns | Owner | keep | Natural way to refine. |
| Ask | Clarification, Cancel run, Retry | Safe handling of unclear, long or failed questions | Owner | keep | Reliability. |
| Ask | Recent questions list | Older questions on this dataset | Owner | merge | Home already lists recent questions; keep one list. |
| Datasets | Import (drop or choose), progress, plain errors | Adds a CSV | Owner | keep | Core. |
| Datasets | Rename, archive, restore, delete (typed confirmation), bulk actions | Manage files | Owner | keep | Needed; deletion is guarded. |
| Datasets | Mark as sample, Hide sample datasets | Label demo data | Owner | merge | One switch, in Datasets only; remove the duplicate in Settings. |
| Datasets | Download CSV | Latest saved file | Owner | keep | Common need. |
| Datasets | Preview and cell editing with undo, add and delete rows, save as a new version | Fix data in place | Owner, Analyst | keep | Valued by non-technical users; protected code, so no change. |
| Datasets | Version history and restore | Go back to an earlier saved version | Owner, Analyst | keep | Safety net for editing. |
| Datasets | Columns tab (types, descriptions) | Same descriptions as Business definitions | Analyst | merge | Two places for the same text; keep it in Business definitions and link to it. |
| Datasets | Data quality summary and drawer | Counts of missing, duplicate, empty columns, type issues | Owner, Analyst | keep | Counts only; no verdict (Rule 4). |
| Datasets | Currency note ("Set currency") | Says which columns are confirmed money | Owner | merge | Belongs with units in Business definitions; a link is enough. |
| Dashboards | Multiple dashboards, tiles, edit mode, layout | Arrange pinned charts and notes | Owner | keep | Core output. |
| Dashboards | Refresh, duplicate, delete | Keep boards current and tidy | Owner | keep | Common. |
| Dashboards | PDF export with calculation pages | A PDF for a partner or bank | Owner | keep | The deliverable. |
| Dashboards | CSV export | Tile rows | Owner, Analyst | keep | Common. |
| Dashboards | JSON export | Structured copy of a dashboard | Analyst | remove | Very few owners need it; CSV and PDF cover the cases. You would lose a machine-readable copy. |
| Dashboards | Dashboard history and restore | Earlier snapshots | Owner | keep | Safety net. |
| Dashboards | Display currency for a dashboard | Show money in another currency with a stated rate | Owner | keep | Rule-bound arithmetic, protected code; leave as is. |
| Dashboards | Saved charts library | Charts saved but not on a board | Owner, Analyst | merge | Show them inside "Add a chart" on a board, not as a separate area. |
| Predictions | Predict a number, a category, forecast | Local models with measured results next to a simple baseline | Learner, Analyst | keep | The three useful tasks. |
| Predictions | Group similar records, find unusual records | Clustering, anomaly scores | Learner | merge | Keep, but under a "More tools" disclosure so the first screen is three choices. |
| Predictions | Leakage warning | Warns when a column may give away the answer | Learner | keep | Prevents misleading results; approved exception. |
| Predictions | Advanced settings (scaling, seed, features) | Fine controls | Analyst | keep | Already collapsed. |
| Predictions | Saved models, batch prediction, CSV export, delete | Reuse a trained model | Learner, Analyst | keep | Needed to use a model. |
| Predictions | Earlier experiments list | History of training runs | Learner | keep | Small, collapsed. |
| Business definitions | What your columns mean, units, currency | Per-column text and confirmed units | Owner, Analyst | keep | Rule 4 lives here. |
| Business definitions | Your key metrics | Named calculations | Analyst | keep | Makes repeated questions consistent. |
| Business definitions | Draft with AI and Review drafts | AI suggestions approved one by one | Analyst | keep | Optional; never applied without approval. |
| Business definitions | Advanced: verified examples and search | Approved example questions with a reference check | Analyst | keep | Already under Advanced; Rule 5 safeguards. |
| Settings | Compact navigation | Smaller sidebar | Owner | remove | The rail already collapses with one click; you would lose a stored preference. |
| Settings | Hide sample datasets | Filter | Owner | merge | See Datasets. |
| Settings | Currency offered for money columns | Which currency to offer when confirming money | Owner | keep | Needed for Rule 4 flow. |
| Settings | Show technical details | Shows SQL and evidence codes | Analyst | keep | Needed by analysts. |
| Menu | Show admin tools (login off) | Reveals the Admin pages | Operator | keep | The honest toggle; no login protects it. |
| Everywhere | Projects switcher | Pick the business | Owner | keep | Core. |
| Everywhere | Error boundary, still-working messages, plain upload errors | Reliability copy | Everyone | keep | Added in P4. |

## Cross-cutting work

| Area | What it is | Who | Decision | Why |
|---|---|---|---|---|
| Accounts: login, roles, two-step sign-in, people, security log, one-time links | Built and tested, off by default, not independently reviewed | Hosted owners | keep (on hold) | Your decision of 2026-11-22; nothing runs unless `AUTH_MODE=on`. |
| Hosted package (`deploy/`, Caddy, per-company stack, backups, restore drill) | Built and run on one computer only | Operator | keep (on hold) | Not reviewed; real certificates and a real server not exercised. |
| Question-retrieval index (local embeddings) | Finds your definitions for a question | System | keep | Internal; needs the local model files. |
| Currency conversion (reference rates) | Optional daily rates for display | Owner | keep | Off unless configured; stated rates only. |
| Verified-example and benchmark machinery | Reference checks and the 45-question benchmark | Operator, Analyst | keep (hidden) | Rule 5 and Rule 4 safeguards. |
| `scripts/verify_demo.py` | Independent pandas check on your own file | Analyst, you | keep | Your ground truth tool. |

## What I would do first, if you approve

1. Merge the three duplicates the owner can see: Save to library into Pin, Hide-sample into Datasets, Columns-tab descriptions into Business definitions.
2. Remove the Setup guide after the first answer, and Compact navigation.
3. Fold Execution traces and Dataset change history into their neighbours.
4. Decide on JSON export.

None of this has been started.
