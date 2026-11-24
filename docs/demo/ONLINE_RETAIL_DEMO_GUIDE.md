# InsightIQ demo guide: Online Retail (for presenting to faculty)

Everything below was run on the real app (http://localhost:8080) on 2026-11-23, in the project **Online Retail demo**. Screenshots are in [online-retail-shots/](online-retail-shots/). The saved dashboard PDF is [Online_Retail_overview.pdf](Online_Retail_overview.pdf).

## 0. The whole point, in one minute (say this first)

**Problem.** A shop owner keeps sales in a spreadsheet. They cannot query it, so they wait days for an analyst or guess. Chatbots give answers they cannot check. BI tools need SQL.

**What InsightIQ does.** The owner uploads a CSV, asks questions in plain English, and gets an answer **they can verify**: the answer sentence, the chart, the rows behind it, the steps, and the SQL. The AI only *writes the query*. The numbers come from a database that runs it on the real file. Your file is never changed.

**Why this dataset.** "Online Retail" is a real UK gift-shop's transactions, 1 Dec 2010 to 9 Dec 2011: **541,909 invoice lines, 8 columns**. It is big enough to be real and messy enough (missing customers, cancellations, text codes) to show why each safety feature exists.

**The claim we can defend.** Not "the AI is always right". Instead: *every answer is checkable, and on this file all ten questions I asked matched an independent pandas calculation* (section 5). That is a record on one file, not a general accuracy figure.

## 1. Before you start

| Item | Detail |
|---|---|
| Open | http://localhost:8080 . The top bar shows **Project: Online Retail demo**. If it shows another project, click the project name and choose it. |
| What is in the project | `online-retail.csv` (541,909 rows, the original), `online-retail-customers.csv` (4,338 rows, one row per customer) and `online-retail-daily.csv` (305 rows, one per trading day). The last two are summaries I made with [make_online_retail_summaries.py](make_online_retail_summaries.py), only because Predictions accepts at most 5,000 rows (explained in section 2.7). |
| Saved for you | 1 dashboard (7 charts and numbers plus a note), 15 answered questions (plus 2 failed attempts kept in the history), 2 key metrics, column definitions, 4 trained prediction experiments, 1 saved prediction. Nothing was deleted from the platform. |
| Login | None. The app says so ("local and single-user"). Say this honestly if asked about security. |
| First click in a new browser | After you reopen the app, Ask asks you to press **These types look right** once before **Analyze** works. Do this before the demo. |
| AI | Answers use your configured AI provider. Two of my first ten questions failed once with "The AI provider has reached its rate or credit limit. Try again later." and passed on retry. Keep a saved answer open as a fallback. |
| Speed | Opening Dashboards can take about 8 seconds, because tiles re-check a 541,909-row file. Say "it is reading half a million rows" while it loads. |
| Real workspace safety | I backed up the real workspace first (`.backups/pre-retail-20261123`, integrity check ok). Only the new project and its datasets were added. |

**Suggested running order and timing (about 30 minutes):** Home 2 min, Datasets 5, Business definitions 4, Ask 8, Dashboards 4, Predictions 5, Admin and Settings 2.

## 2. Screen by screen: what to click, why it exists, how to read it

### 2.1 Home: "What do you want to know?"  ([screenshot](online-retail-shots/home.png))
- **Question box + Analyze.** The fastest path: type a question, get an answer. *Why:* a first-time owner should get an answer within two minutes without reading help.
- **Active dataset.** Shows which file the question is about, with rows and columns. *Why:* every answer must say which data it came from.
- **Suggested questions.** Generated from the file's columns and your definitions. After I saved a key metric called "Sales revenue", **"What is Sales revenue?"** appeared. *Interpretation:* Business definitions feed the suggestions, so the owner teaches the tool once.
- **Dashboards list and Recent questions.** Jump back into saved work.

### 2.2 The top bar and left menu
- **Project switcher** (top left). A project is one business workspace. Each page shows only that project's datasets, questions, dashboards and models. *Why:* a consultant can keep two clients apart on screen. **Say plainly:** projects organise work, they do not protect it; the Projects page states this.
- **Left menu:** Home, Ask, Datasets, Dashboards, Predictions, Business definitions. These are the owner's six jobs. The arrow icon collapses the menu.
- **Menu** (top right): Settings, Projects, and the switch **Show admin tools**. Developer pages are hidden until you turn that on.

### 2.3 Datasets  ([main](online-retail-shots/datasets-main.png), [Details drawer](online-retail-shots/datasets-quality-review.png), [Import dialog](online-retail-shots/import-dialog.png))
**Files panel (left).**
- **Upload icon = Import CSV.** Dialog states the limits: CSV, up to 60 MB, up to 1,000,000 rows, UTF-8. *Why:* limits are shown before you try, not after a failure. (I imported this file with the same endpoint the dialog uses; the dialog itself is shown but I did not import twice.)
- **New-folder icon = New project.** **Refresh icon** reloads the list.
- **Project switcher, "Find a dataset", Show archived.** Archive hides a file without deleting it, and it can be restored.
- **Checkboxes** appear when there is more than one file: select several to archive, mark as sample, or delete in one action. **Delete** asks for confirmation and shows what depends on the file.
- **"…" on each row:** Rename, Download CSV (the last saved version), Version history, Mark as sample, Archive, Delete.

**Dataset page (right).**
- **Header line:** "541,909 records · 8 columns".
- **Quality summary:** "136,534 missing values · 5,268 duplicate rows · 0 empty columns · 64,164 type issues". Click **Details** to open the drawer ([screenshot](online-retail-shots/datasets-quality.png)).
  - *136,534 missing = 1,454 empty Descriptions + 135,080 empty CustomerIDs (24.9% of lines).* **Interpretation:** a quarter of sales lines have no customer, so "how many customers" can only count the lines that have one.
  - *5,268 duplicate rows* counts copies after the first identical row. The app only informs; it never deletes.
  - *64,164 type issues* is **not** an error. InvoiceNo values such as `C536379` and StockCode values such as `85123A` contain letters, so they are not pure numbers. The drawer lists five examples for each. **Interpretation:** identifiers are text, and the app is telling you so before you add them up.
- **Money columns: UnitPrice · GBP, Change currency.** Shows the unit you confirmed (section 2.4). *Why:* the app never guesses that a column is money.
- **Preview / Columns tabs.** Preview shows the first rows in a table with **Sort rows**. Columns lists each column with its inferred type, missing count, unique count, sample values and your description ([screenshot](online-retail-shots/datasets-columns.png)).
- **Edit mode (Off → On)** ([screenshot](online-retail-shots/datasets-edit-mode.png)). Turns the table into an editor: click a cell to change it (Enter applies, Escape cancels), **Add Row**, **Delete Row** on each row. It first asks you to **Confirm column types before saving** ("Use suggested types" then "Confirm types"). I switched it on to look and switched it off again; I did not edit the demo file. *Why it exists:* fixing a typo in the data without opening Excel; every save becomes a numbered version ("Saved · Version 1"), and Version history in the row menu can restore one.
- **Everything is stored as text.** All eight columns are imported as text and the types are confirmed in Ask. This is deliberate (section 2.5).

### 2.4 Business definitions  ([columns](online-retail-shots/kb-columns-filled.png), [metrics](online-retail-shots/kb-metrics-filled.png), [advanced](online-retail-shots/kb-advanced.png))
Goal: teach the tool what the numbers mean, in the owner's words.
- **What your columns mean.** One description per column and one for the dataset. I wrote them from the file's published notes (for example "InvoiceNo starting with C is a cancellation").
- **Currency dropdown on each column.** I set **UnitPrice = GBP** because the data source states prices are in pounds sterling. The app shows "Suggested: money. Not shown as such until you choose it." *Why:* the rule is that no unit is shown until the owner confirms it.
- **Save definitions.** Because I changed a currency, a **Currency dependency impact** dialog appeared ([screenshot](online-retail-shots/kb-currency-impact.png)): "Currency changes affect future answers. Dashboards and saved results keep their saved snapshots." It listed what depends on this file (1 dashboard, 7 saved charts, 13 saved questions). I ticked the confirmation. *Why:* changing a unit must never silently rewrite something already shown.
- **Your key metrics → Add metric.** A metric has a Name, a plain Definition, a Currency and a **calculation (a read-only query)**. I added:
  - *Sales revenue* (GBP): sum of Quantity × UnitPrice, leaving out `InvoiceNo LIKE 'C%'`, Quantity ≤ 0 and UnitPrice ≤ 0.
  - *Cancelled lines*: count of `InvoiceNo LIKE 'C%'`.
  - **Teachable moment:** my first attempt used `starts_with()` and the save was refused: "Unsupported or unsafe SQL operation". The SQL guard allows a fixed set of safe operations. `LIKE` is allowed. This shows that even an owner-written query is checked.
- **Draft with AI.** Opens a disclosure first: "sends only the dataset name, column names, inferred types, row counts, null counts and unique counts. No sample values, quality examples or row data." I cancelled; it needs **Confirm and draft**. *Why:* the owner sees exactly what leaves the computer before any AI call.
- **Advanced: verified examples and search.** For analysts. A "verified example" is an answer you approve against your own independent reference; the page warns "Approval verifies agreement with your independent reference, not general correctness". **Show what Ask would use** previews which definitions Ask would pick up for a question.

### 2.5 Ask your data  (["…" menu](online-retail-shots/ask-more-menu.png), [answer with chart](online-retail-shots/q6.png), [details](online-retail-shots/q6-details.png), [calculation](online-retail-shots/q6-calc.png), [follow-up](online-retail-shots/followup.png))
**Step 1: "Check column types" (first question on each file).** ([screenshot](online-retail-shots/ask-column-types.png); reopen it any time with the **Check column types** link under the box.)
- Each column has a type dropdown: Text, Whole number, Decimal number, Date, Date and time, Yes / No. **Use suggested types** fills them in; I chose it, which gave Quantity = whole number, UnitPrice = decimal, InvoiceDate = date and time, CustomerID = whole number. Under each column: "0 missing · 0 failed conversions".
- **"What are these numbers?"** offered Quantity / UnitPrice / CustomerID as Money (USD) / Percentage / Neither. UnitPrice came pre-selected as "Money (USD)... Suggested". **I changed it to Neither**, because this file is in pounds and a "$" would be a false claim. Only USD is offered on this card; other currencies are set in Business definitions. **See [DEMO_DAY_PLAYBOOK.md](DEMO_DAY_PLAYBOOK.md) section 1 for the currency demo (symbol, Change currency, Convert Currency).** My ten verification answers show plain numbers because they were asked with this setting and with free wording.
- **"I confirm these types. Values that cannot be converted are left out of totals and averages."** Tick it. *Why this screen exists:* the file is stored as text; an answer such as a sum is only valid if the owner agrees which columns are numbers. This is the "type confirmation rule": no calculation runs on unconfirmed types.

**Step 2: ask.**
- **Question box and Analyze.** Plain English. *Tip:* put the rule in the question (for example "only rows where InvoiceNo does not start with C, Quantity is above 0 and UnitPrice is above 0"). Vague words like "revenue" are ambiguous; the stated rule removes the ambiguity.
- **Dataset chip under the box** shows what the question runs on. **"Your file is never changed"** is a promise the app keeps: queries are read-only.
- **"What is sent to the AI?"** expands to: your question, column names, confirmed definitions, bounded conversation summaries and computed results go to your AI provider; *no automatic masking is applied.* Say this plainly: the app does not hide sensitive values from the provider.
- **Suggested chips** (for example "How many records are in this dataset?") fill the box; they do not run on click (I checked), so the confirmation rule stays in force.

**Step 3: the answer card.**
- **Answer sentence + "From online-retail.csv · 5 result rows · using the column types you confirmed".** The provenance line is the point: where the number came from.
- **Chart or number.** The **Visualization** dropdown offers only charts that fit the result: a single number offers KPI/Table; a ranked list offers Bar/Donut/Table; a time series offers Line/Table.
- **Pin to dashboard.** Saves this answer as a tile (section 2.6). **Copy answer** copies the sentence. **Helpful / Not helpful** records feedback for you; it never enters prompts or knowledge.
- **"…" menu:** *Download CSV*, *Run again on current data* (re-runs the question), *Propose as verified example* (analyst feature).
- **Show details** has tabs:
  - **Data:** the exact result table, paginated, with Download CSV. Top five countries: 9,025,222.08 / 285,446.34 / 283,453.96 / 228,867.14 / 209,715.11.
  - **How this was calculated:** plain steps ("Read the selected dataset. Used your confirmed column types. Kept the rows matching your filters. Grouped... Calculated...") plus *unrounded* statistics (for example total 10,032,704.634). Headline answers are rounded for reading; this tab keeps the exact values on purpose.
  - **SQL** appears when **Settings → Show technical details** is on ([screenshot](online-retail-shots/ask-technical-details.png)). It is off by default because owners do not need it; analysts and examiners do.
- **Follow-up box** ("Ask a follow-up about this result"). I asked "Show the top 10 countries instead." and it understood *instead* from the previous question: 10 rows, same rule. *Why:* analysis is a conversation.
- **Left panel (Recent questions).** History grouped Today / Yesterday / Earlier. **New question** starts fresh. Repeated questions show "asked 2x". The panel collapses with the icon at its top.
- **Failed questions** say why, with **Retry**, **Edit question**, **View details**. Mine said "rate or credit limit": an honest provider message, not a made-up answer.

### 2.6 Dashboards  ([view](online-retail-shots/dashboard-final.png), [edit mode](online-retail-shots/dashboard-edit.png), [filters](online-retail-shots/dashboard-filters.png), [add note](online-retail-shots/dashboard-add-note.png))
- **Pin dialog** ([screenshot](online-retail-shots/pin-dialog-filled.png)): **Title**, **Dashboard** (choose existing or "New dashboard…"). It warns "Pinning saves up to 1,000 result rows in this project on this computer." *Why:* a tile is a saved snapshot, so it still shows the numbers you saw.
- **"Online Retail overview"** has 8 items: Sales revenue 10,666,684.54; Average order value 534.4; Customers 4,338; Top 5 countries; Top 5 products; Best month; Sales revenue by month (line); and a note.
- **Chips on each tile:** *Updated 23 Nov 2026* (when the snapshot was taken) and *Current* (it matches the data now).
- **Edit dashboard** (calm toolbar): drag any tile by its grip handle ("Drag widget N") or use its up/down arrows to reorder, and the order saves automatically (I tested both on this dashboard and restored the order); title and description are editable; **Chart type** per tile (I switched the Best-month tile from KPI to Table so the month 2011-11-01 is visible); **Layout**; arrows or drag to reorder; copy and trash icons per tile; **Add chart**; **Add note**; **Filters** (dashboard-wide and per tile, "0 active" until used); **Done editing**. Changes save automatically.
- **Add note:** your own words, labelled **USER-AUTHORED NOTE**. *Why:* the app never writes findings for you; interpretation is the owner's.
- **"…" next to Export PDF (More actions):** Duplicate dashboard, Export PDF without calculation pages, Refresh all, Delete dashboard. **"…" on each tile:** Refresh, Download CSV, Details.
- **Export PDF:** 12 pages: a page per tile, then an *Appendix: how this was calculated* with exact (unrounded) tables and the SQL, so a bank or partner can check the figures. ([sample](Online_Retail_overview.pdf)). *Interpretation:* the PDF carries its own evidence.
- **Update 2026-11-23:** the four revenue tiles were rebuilt so they carry a confirmed currency (GBP) and can be shown in dollars with **Display currency**; see [DEMO_DAY_PLAYBOOK.md](DEMO_DAY_PLAYBOOK.md) section 1. The dashboard note was rewritten to say so. The limits below that mention a missing label or currency describe the earlier version, except that Average order value and the customer count still carry no currency by design.
- **Honest limits I observed (say them before someone asks):**
  1. The Customers tile shows only the first figure (4,338); the second figure (lines without a customer) is not on the tile. It is in the answer card.
  2. A single-number tile for "best month" shows the revenue but not the month; switching to Table fixes it.
  3. Bar charts hide an axis label when they would overlap (the "United Kingdom" label is missing on the countries chart).

### 2.7 Predictions  ([picker](online-retail-shots/ml-step1-chosen.png), [check and train](online-retail-shots/ml-step2.png), [results](online-retail-shots/ml-results.png))
Three steps: **1 What do you want to predict? → 2 Check and train → 3 Results and predict.** All training is local: **"0 LLM calls"**. Results are measured on rows the model did not see.

**Why not the 541,909-row file?** It said "Dataset exceeds registered ingestion limits". Training accepts at most 5,000 rows, and the app refuses to sample automatically. So the owner creates a bounded file on purpose. I built a per-customer table (4,338 rows) and a per-day table (305 rows) with a saved script. Say this: *it is a design choice that makes the owner responsible for what the model sees.*

Five cards; unavailable ones explain themselves ("No target with 2–20 observed classes found", "No date column found"):

1. **Predict a number (Regression)** on customers, target `total_spend`.
   - Step 2 lists features and shows "Check for leakage before you train. Only tick columns you would already know when you make a prediction." `customer_id` is excluded automatically ("excluded: identifier"). I unticked `units_bought` because spend is worked out from units; keeping it would make the result look better than it is. The leakage warning is shown before and after training.
   - Tick **"I confirm selected predictors are available at prediction time..."**, then **Train local models** (0.86 s).
   - **Reading the result:** on validation rows the best model (HistGradientBoostingRegressor) was off by about **1,231.57** on average, against **1,805.37** for "always guess the average". On the final untouched test rows it was off by about 1,795.86, **R² = 0.27**. *Plain reading:* it beats the naive guess in validation, but it explains only about a quarter of the variation. Customer spend is dominated by a few very large buyers. *Why we show this:* honest, measured, no claim of improvement beyond the stored comparison.
   - **Predict with a saved model:** pick a model, enter a customer (UK, 5 invoices, 60 products, 200 days) → **1,304.44**. The page says "Prediction units: not inferred", so no currency is invented.
2. **Group similar records (Clustering).** 3 groups with silhouette 0.47 ("descriptive, not accuracy"): 1,601 regular customers (avg spend about 3,276), 2,719 occasional customers (about 620), and **18 very large accounts (about 110,054 average)**. *Interpretation:* a few wholesale-like buyers; the business should treat them separately.
3. **Find unusual records (Anomaly detection).** 217 of 4,338 customers (5.0%) flagged. Wording: "Anomaly flags identify unusual feature combinations. They are not fraud labels." *Interpretation:* a review list, not proof of anything.
4. **Forecast future values.** Time column `day`, measure `revenue`, horizon 7, weekly pattern 7. The default **Missing periods = "Stop and explain gaps"** left **Train** disabled, because the file has gaps (305 trading days across 374 calendar days; the shop has no Saturday sales). I chose **Explicit zero revenue**, which fills 69 gaps with zero. *That is the owner's assumption, and the app states it.* Result: validation error 11,813.51 vs "repeat the last value" 17,001.76, but the final 7-day window had MAE 39,153.6 (WAPE 51.8%) because the final 7 days of the data (early December 2011) were hard for the model to predict. "Backtests do not guarantee future accuracy."
5. **Predict a category (Classification):** not available on these files (needs a target with 2 to 20 classes). Say so.

**Earlier experiments** lists past runs with **Inspect experiment** and **Delete experiment & models**.

### 2.8 Menu → Settings and Projects  ([settings](online-retail-shots/settings.png), [projects](online-retail-shots/projects.png))
- **Currency offered for money columns** (default USD): the currency the app *offers* when you confirm money. **Show technical details** reveals SQL and evidence codes.
- A note says AI keys live in the server environment, and that the workspace is "local and single-user".
- **Projects page:** create, rename, archive (reversible), delete only with typed confirmation and a dependency preview. It says: "Projects organise your work; they do not protect it".

### 2.9 Admin tools (Menu → Show admin tools)  ([nav](online-retail-shots/admin-nav.png))
Labelled on every page: **"Admin tools: not protected by a login. Anyone using this computer can open them."** For developers, not owners.
- **Accuracy check** ([screenshot](online-retail-shots/admin-accuracy.png)): a benchmark of 45 reference questions on a fictional retail file; the last stored partial run scored 1 of 2 and the page says "This small sample does not measure general system accuracy." Do not quote it as accuracy.
- **Performance & errors** ([screenshot](online-retail-shots/admin-performance.png)): runs, failures, retries, latency, token sums and estimated cost from what was actually recorded ("nothing is estimated for runs that did not record them").
- **Execution traces** ([screenshot](online-retail-shots/admin-traces.png)): each question step by step, including the SQL it ran.
- **Dataset change history** ([screenshot](online-retail-shots/admin-history.png)): imports and edits, with a plain statement of what it does *not* cover ("not a complete audit trail and not tamper-proof").
- **Backup info** ([screenshot](online-retail-shots/admin-backup.png)): where data lives and the exact backup and restore commands.

## 3. Reading the Online Retail results (interpretation to say aloud)
All figures are from the answers above. Percentages are simple ratios of those figures.
- **Revenue.** Net revenue counting cancellations as credits is **9,747,747.93**; sales revenue excluding cancellations and non-sale rows is **10,666,684.54**. The gap of about 0.92 million (returns and other non-sale rows) shows why "revenue" must be defined.
- **Cancellations.** 9,288 of 541,909 lines are cancellations, about **1.7%** of lines.
- **Market concentration.** The United Kingdom is **9,025,222.08 of 10,666,684.54, about 84.6%** of sales revenue. The next four countries together are about 1.0 million. *Business reading:* heavily UK-dependent; export is small.
- **Products.** By units, "PAPER CRAFT , LITTLE BIRDIE" (80,995) and "MEDIUM CERAMIC TOP STORAGE JAR" (78,033) lead, each ahead of the others. A product can top *units* without topping *revenue*; ask both.
- **Customers.** 4,338 customers bought something, and 132,220 sales lines have no customer recorded. *Reading:* customer counts and customer-level analysis cover only identified buyers.
- **Order value.** Average order value is **534.40** (sales revenue divided by distinct invoices; wholesale-style orders pull this up).
- **Seasonality.** Monthly sales revenue rises from about 0.72 million in July 2011 to **1,509,496.33 in November 2011**, the peak. December is not a fair comparison: the data stops on 9 December (8 trading days). *Interpretation (a hypothesis, not proven by the file):* this is a gift shop, so a pre-Christmas peak is plausible.
- **Customer segments.** About 0.4% of customers (18 of 4,338) form a very large-account group; most customers buy occasionally.

## 4. Questions faculty may ask, with honest answers
- **"Can the AI make things up?"** It can misread a question. That is why every answer shows its data, steps and (optionally) SQL, and why the numbers come from the database, not from the AI's text. The footer says "AI can make mistakes. Review important results before using them."
- **"Is it accurate?"** On this file, 10 of 10 questions matched pandas. That is a record on one file. The built-in benchmark is a small fictional sample and is not an accuracy claim.
- **"Is the data secure or private?"** There is no login, and the app says so. The question, column names, definitions and computed results are sent to the AI provider without masking. Do not describe it as secure.
- **"Why is everything imported as text?"** So the owner, not a guess, decides what is a number or a date. It also makes messy columns (such as `85123A`) safe.
- **"Why can't I just click a suggestion and run it?"** The chips fill the box. Running without confirmed types would bypass the confirmation rule.
- **"Why GBP is not offered on the Ask card?"** Only USD, Percentage and Neither are offered there; GBP and 20 others are in Business definitions. I used "Neither" in Ask so no wrong "$" appears.
- **"What would you improve?"** Pinned single-number tiles should show their label (for example the month), the Customers tile should show both figures, long axis labels should wrap, and the Ask type card should offer the dataset's own currency.

## 5. Verification: InsightIQ vs independent pandas ([questions file](verify_questions.online_retail.json))
I computed the ten answers with pandas **before** running the app, and compared afterwards. Screenshots: [q2](online-retail-shots/q2.png), [q3](online-retail-shots/q3.png), [q4](online-retail-shots/q4.png), [q5](online-retail-shots/q5.png), [q6](online-retail-shots/q6.png), [q7](online-retail-shots/q7.png), [q8](online-retail-shots/q8.png), [q9](online-retail-shots/q9.png), [q10](online-retail-shots/q10.png).

| # | Question | pandas | InsightIQ | Match |
|---|---|---|---|---|
| 1 | Rows in the file | 541,909 | 541,909 | yes |
| 2 | Different invoices | 25,900 | 25,900 | yes |
| 3 | Cancellation lines | 9,288 | 9,288 | yes |
| 4 | Net revenue | 9,747,747.93 | 9,747,747.93 | yes |
| 5 | Sales revenue | 10,666,684.54 | 10,666,684.54 | yes |
| 6 | Top 5 countries by revenue | UK 9,025,222.08; Netherlands 285,446.34; EIRE 283,453.96; Germany 228,867.14; France 209,715.11 | same five, same values | yes |
| 7 | Top 5 products by units | 80,995; 78,033; 55,047; 48,474; 37,891 | same five, same values | yes |
| 8 | Customers / lines without customer | 4,338 / 132,220 | 4,338 / 132,220 | yes |
| 9 | Highest month | 2011-11, 1,509,496.33 | 2011-11-01, 1,509,496.33 | yes |
| 10 | Average order value | 534.40 | 534.4 | yes |

**What is and is not shown.** Questions 2 to 10 included the calculation rule in the wording. Without it, "revenue" is ambiguous and the answer can differ, which is a limit of plain-English questions, not a bug. Q7 and Q9 first failed with the provider's rate limit; the matching answers are from the retry. Rows 6 to 10 of the top-10 countries follow-up were not independently checked.

## 6. Data and files behind this demo
- `data/online-retail.csv`: the sheet of `Online Retail 2.xlsx` converted without changes (541,909 rows; `InvoiceNo`, `StockCode` and `CustomerID` kept as text). Its SHA-256 differs from the checksum in the verification file because the first conversion wrote some `CustomerID` values differently; row count, columns and all ten answers are identical. SHA-256 used in this demo: `959c8b3847939247e4007cbbd6dfcf3fdc78bc8236a08eba94565e15679914d8`.
- `data/online-retail-customers.csv`, `data/online-retail-daily.csv`: built by [make_online_retail_summaries.py](make_online_retail_summaries.py) from sales lines (not cancelled, Quantity > 0, UnitPrice > 0).
- Real workspace: backup before the change `.backups/pre-retail-20261123`. `sh docs/baseline/check.sh` now reports **CHANGED** by design (new project and three datasets). To return to the earlier state, restore that backup (see [RESTORE_FROM_ZIP.md](../RESTORE_FROM_ZIP.md) and the Backup info page).
