# Demo-day playbook (read this the night before)

Companion to [ONLINE_RETAIL_DEMO_GUIDE.md](ONLINE_RETAIL_DEMO_GUIDE.md). Everything here was tried on the real app on 2026-11-23, except where marked *general knowledge* or *not tested*.

## 0. Setup checklist (5 minutes before)
1. Docker is running; open http://localhost:8080 ; top bar says **Project: Online Retail demo** (click the name to switch if not).
2. **Ask** → press **These types look right** once (Analyze stays disabled until you do).
3. Open **Dashboards** once and wait for it to load (about 8 seconds), then you can click around quickly.
4. Keep a saved answer open as a fallback. The AI provider rate-limited me twice; a retry worked.
5. Do not delete anything. The demo project, three datasets, dashboard and models are all kept.

---

## 1. Money, dollars and the currency button

**What is true in the app today (checked):**
- A column or metric is shown as money **only after the owner confirms it**. This is the rule you set on 2026-11-20 (Rule 4 in CLAUDE.md): "units (money, currency, percentage) are shown only after the owner confirms them". The app never guesses a currency from a column name.
- **USD is the default currency the app offers** (Menu → Settings → "Currency offered for money columns: USD (default)"). It is *offered*, not applied automatically.
- Once a unit is confirmed, answers show the symbol, say **"Amounts are in GBP."**, and offer **Change currency** and **Convert Currency**.
- Calculated values that mix columns (for example Quantity × UnitPrice) do **not** inherit a currency, by design ([CURRENCY.md](../CURRENCY.md): "ratios, products, unknown expressions... do not inherit monetary units"). That is why my free-wording revenue answers had no symbol.

**The demo that shows it (2 minutes).** Business definitions already has UnitPrice = GBP and a key metric "Sales revenue" = GBP.
1. Ask → chip **What is Sales revenue?** → Analyze. Result: **£10,666,684.54**, "Amounts are in GBP." ([screenshot](online-retail-shots/cur-metric.png)).
2. Click **Convert Currency** → target **USD** → **Apply conversion**. Result: **$13,988,290.11** with the line "1 GBP = 1.3114 USD · Frankfurter daily reference · Latest available 2026-11-23... Display conversion; original values retained." ([screenshot](online-retail-shots/cur-converted-usd.png)).
3. Point out **Reset to Original Currency** and **Export converted CSV (original columns retained)**. 22 currencies are offered.
4. Say: "The original figure is never overwritten; conversion is a display layer with its rate and date recorded."
5. Same on dashboards: the PDF and report have a **Report currency** selector (see CURRENCY.md; I did not test it on this dashboard).

**The dashboard in dollars (done on 2026-11-23, [screenshot](online-retail-shots/dashboard-final-usd.png)).** The revenue tiles on "Online Retail overview" are now money-aware, so the dashboard has a **Display currency** box (top right of the dashboard):
1. Open Dashboards. The revenue tiles show **£** (sales revenue £10,666,684.54; the countries bar chart, the monthly line and the best-month table have £ values and a £ axis).
2. Choose **USD** in **Display currency**. After a moment every revenue tile shows **$** (sales revenue **$13,982,956.77**, best month 2011-11-01 **$1,978,798.74**), with the line "1 GBP = 1.3109 USD · 2026-11-23 · Frankfurter daily reference". Today's rate changes daily, so the dollar figures will differ slightly tomorrow.
3. **Export PDF** with USD selected gives a PDF in dollars whose appendix records the rate, its date and source for every converted value ([USD PDF](Online_Retail_overview_USD.pdf); the original-currency PDF is [Online_Retail_overview.pdf](Online_Retail_overview.pdf)). The original GBP values are kept.
4. The choice is remembered per dashboard **in that browser only**. On another browser or after clearing data, choose USD again.
5. **What stays plain, and why (say it before they ask):** Average order value (534.4), the customer count and the units chart have no currency label. The app deliberately does not label ratios or counts as money, and it shows the note "No confirmed currency on some charts; those values stay unconverted."
6. **How the tiles got their currency:** a tile only carries a currency when the query it ran is *identical* to a key metric you defined in Business definitions with a currency. I defined four GBP metrics (Sales revenue, Sales revenue by month, Sales revenue by country, Best month by sales revenue). You then ask in **plain English**, for example **"What is Sales revenue by month?"**, using the metric's name. Since 2026-11-24 the AI is told to reuse a named metric's query exactly, so the answer comes back with GBP and the Convert button. *(My first version of this pasted SQL into the questions, which was wrong for a plain-English product; those questions were removed and the tiles rebuilt from plain questions.)* A question that does not use a metric's name, such as "which 5 countries have the most revenue?", writes its own SQL and stays unlabelled. Ask "What is <metric name>?" for the figures you want in dollars.

**Your recollection vs the rule.** You remembered "money is always shown in dollars as a standard". The nearest thing the product does is *offer USD by default* and let the owner switch. If you want USD **applied automatically to every money-looking result**, that would conflict with Rule 4 (no unit without the owner's confirmation) and touches the currency arithmetic that Rule 3 protects. It is your decision to amend; I have not changed anything. For tomorrow, say: "We deliberately do not assume a currency, because this file is in pounds and a silent dollar sign would be false."

**If asked "why can I only pick USD in the Ask card?"** True limitation: that card offers USD / Percentage / Neither; other currencies are chosen in Business definitions. Say so.

## 2. Dashboard drag and reorder (checked)
Dashboards → **Edit dashboard**. Every tile has a grip handle (icon of six dots, "Drag widget N") at its top-left. Drag a tile onto another to reorder, or use the up and down arrows beside it. The text beside the toolbar says "Drag tiles or use the arrow buttons to reorder. Changes save automatically." I dragged a tile, confirmed on the server that the order changed, and restored the order. ([screenshot](online-retail-shots/dashboard-edit.png)). Click **Done editing** when finished.

---

## 3. "Will all functions work like Power BI? How are we different?"

**Straight answer for faculty:** No. InsightIQ is not a Power BI replacement and does not claim to be. It solves a narrower problem for a different user. Power BI details below are *general knowledge*; check Microsoft's current documentation before quoting exact features or licensing.

| Area | Power BI (general knowledge) | InsightIQ (what the app does today) |
|---|---|---|
| Who it is for | Analysts and BI developers who build reports | A non-technical owner who wants an answer from a spreadsheet |
| Getting data in | Many connectors: databases, cloud services, files, live connections | **CSV files only**; no database or live connectors |
| Several tables | Relationships and data modelling across tables | **One table at a time**; no joins in a question |
| Calculations | DAX measures and Power Query transformations | Plain-English questions; owner-written key metrics as read-only SQL; no transformation tool (I made the summary files with a script, section 4) |
| Visuals | Large visual library, custom visuals, cross-filtering between visuals, drill-through | A small set: KPI, bar, line, donut, scatter, table; per-tile and dashboard filters |
| Sharing | Publish, share, scheduled refresh, row-level security | **Local, single user, no login by default, no sharing or scheduled refresh**; PDF export |
| Asking questions in English | Q&A / Copilot exist, depending on licence and setup | The core feature: the AI writes a query; you see the data, steps and SQL |
| Machine learning | Available through additional features and tools | Built in: 5 task types, local training, leakage warning, measured baseline comparison |

**Where InsightIQ is deliberately different (and good):**
1. **Every answer can be checked.** Answer, chart, result rows, plain-language steps, optional SQL; the PDF has a calculation appendix.
2. **Nothing is assumed.** Column types, money and percentages appear only after the owner confirms them (we showed the pounds-versus-dollars case).
3. **Honest limits in the screen itself.** "AI can make mistakes", "Admin tools: not protected by a login", "Anomaly flags are not fraud labels", "R² 0.27" shown plainly.
4. **Safety rails.** Read-only SQL guard (it refused `starts_with()` when I tried it), file never changed, no automatic sampling, forecasting stops on gaps until you choose a policy.
5. **Two minutes to first answer** without training, on a normal laptop, no licence.
6. **Prediction is explained**, not just run: leakage warning before and after, baseline "always guess the average" next to the model.

**What not to say:** that it is more accurate than Power BI or any tool, or that it is secure/private (there is no login; the question, column names, definitions and computed results go to the AI provider without masking). On this one file, ten of ten answers matched pandas; that is a record, not a general accuracy claim.

---

## 4. How I made the two extra datasets (and how you do it yourself)

**Update:** there are now three summary files; the third, `online-retail-first-orders.csv` (2,718 customers, with a yes/no "bought again" column), supports the classification card. The same script builds all three.

**First, a correction in wording.** This was **not sampling**. Sampling means a random subset of rows. I **summarised** the whole file (aggregation): every qualifying sales line contributed.
- **Why:** Predictions trains on at most 5,000 rows and the app refuses to sample by itself ("no automatic training sample is taken"). The owner must create a bounded dataset on purpose. The file has 541,909 rows, so I made two small tables.

**What each table is**
| File | One row is | Built from | Rows |
|---|---|---|---|
| `online-retail-customers.csv` | one customer | sales lines that have a CustomerID | 4,338 |
| `online-retail-daily.csv` | one trading day | all sales lines | 305 |

"Sales lines" = InvoiceNo does not start with C, Quantity > 0 and UnitPrice > 0 (same rule as the verification questions).

**Columns made.** Customers: `customer_id`, `country` (most frequent), `invoices` (distinct), `units_bought` (sum of Quantity), `different_products` (distinct StockCode), `total_spend` (sum of Quantity × UnitPrice), `days_between_first_and_last_order`. Daily: `day`, `revenue`, `invoices`, `units`.

**They reconcile to the headline number (checked):**
- Daily revenue adds up to **10,666,684.54**, exactly Q5.
- Customer `total_spend` adds up to 8,911,407.90; the other **1,755,276.64** was sold on lines with no customer. Together: 10,666,684.54.
- **Be upfront:** the customer table covers about 83.5% of sales revenue; lines without a customer cannot be assigned to anyone.

**Steps to do it live tomorrow (about 5 minutes):**
1. Terminal: `cd` into the project folder (the one that contains `docs/` and `data/`)
2. Run `python3 docs/demo/make_online_retail_summaries.py` (needs pandas; takes a few seconds). It prints `4338 customers; 305 days`. I ran it in a separate copy and the two output files were **byte-identical** to the ones already uploaded (checksums matched).
3. In the app: Datasets → upload icon (**Import CSV**) → choose `data/online-retail-customers.csv`. If the name already exists you will have a duplicate; for the demo it is simpler to show the **already uploaded** files and the script rather than re-import.
4. Open the script ([make_online_retail_summaries.py](make_online_retail_summaries.py)) and read it aloud: it is about 20 lines.
5. Say why: "The platform makes the owner choose what the model sees; it will not silently sample."

*Not tested:* making the summary inside the app by asking a question and downloading the result. Saved results keep at most 1,000 rows, so it would not capture all 4,338 customers; use the script.

---

## 5. Predictions: what to show (about 10 minutes)

> **Updated 2026-11-23 (later): use [PREDICTIONS_DEMO_SCRIPT.md](PREDICTIONS_DEMO_SCRIPT.md) instead of this section.** The old experiments were deleted and all five cards were rerun on the updated build, including a classification demo, the new "What each number means" and "What this prediction means" sections, and real-customer comparisons. The text below is kept for reference.

**Opening line (30 s).** "Asking a question looks backwards at the data. A prediction estimates something for a case it has not seen, and the honest question is: how wrong is it on data it did not train on? That is what this page measures. Training runs on this computer: **0 AI calls**."

**Order to present** (all already trained; Predictions → *Earlier experiments* → **Inspect experiment**. You can also train live; each run takes under a second):

1. **Pick the data and explain the limit (1 min).** Choose `online-retail-customers.csv`. Show the greyed cards: "Predict a category: no target with 2 to 20 classes"; on the big file "Dataset exceeds registered ingestion limits". "So the owner builds a bounded table first."
2. **Predict a number (regression), the main demo (4 min).**
   - Step 1: card **Predict a number**, target **total_spend**. Show the value table.
   - Step 2: read the leakage sentence aloud. Show `customer_id` "excluded: identifier". **Untick `units_bought`** and say: "spend is built from units, so keeping it would flatter the score." Tick the confirmation, **Train local models**.
   - Step 3: after training, scroll to **What each number means**. It explains every number in plain words using your own values (for example "On average, a prediction misses the real total_spend by about 1,795.86" and "the model accounts for about 27% of the ups and downs"). Read two of them aloud. Then read "What the measured results mean": validation error **1,231.57** vs the "always guess the average" **1,805.37**; final test error **1,795.86**, **R² = 0.27**. **Say the honest conclusion:** "better than guessing the average in validation, but it explains only about a quarter of the variation, because a few very large customers dominate spend." Do not oversell.
   - Open **Compare all models tried** (five models). Then **Predict with a saved model**: enter UK, 5 invoices, 60 products, 200 days → **1,304.44**. Point at "Prediction units: not inferred": the app does not invent a currency here either.
3. **Group similar records (clustering), 2 min.** 3 groups: 1,601 regular customers (average spend about 3,276), 2,719 occasional (about 620), **18 very large accounts (about 110,054)**. Silhouette 0.47 is labelled "descriptive, not accuracy". Business use: treat the 18 accounts as wholesale-style customers.
4. **Find unusual records, 1 min.** 217 of 4,338 (5.0%) flagged. Read the footnote: "not fraud labels"; it is a review list.
5. **Forecast, 2 min (if time).** Time `day`, measure `revenue`, horizon 7. With the default **Stop and explain gaps** the Train button stays disabled because the file skips days (305 trading days over 374; no Saturday sales). Choose **Explicit zero revenue** (69 days filled, which is the owner's assumption, stated on the page) → train. Result: validation error 11,813.51 vs "repeat last value" 17,001.76, but the final 7-day window had MAE 39,153.6 (WAPE 51.8%). Say: "backtests do not guarantee future accuracy; the page says so."

**If you only have 5 minutes:** regression (step 2) plus clustering.

**Questions to expect, with answers**
- *Why is R² only 0.27?* Spend is very uneven; a few customers dominate. Honest result, not a failure of the page.
- *Did the model beat a baseline?* On validation, yes (1,231.57 vs 1,805.37). The page says a baseline final-test score is shown only when recorded; do not claim improvement on the final test.
- *Why not classification?* No column with 2 to 20 classes in these tables. (Optional extension, not done: add a yes/no column such as "bought on 2 or more invoices" to the summary script; about 65.6% of customers have 2 or more invoices.)
- *Is the AI involved?* No; the page shows "0 LLM calls". The AI is used for questions in Ask and for optional AI drafts in Business definitions.
- *Can it predict revenue next month?* The forecast gives a 7-day point estimate with measured backtest error; no intervals.

**Do not claim:** accuracy of the models in general, that customer spend is "predictable", or any currency for predictions.

---

## 6. Copy-paste questions for Ask (the exact wording that matched pandas)
- How many lines are cancellations? A cancellation is a row whose InvoiceNo starts with the letter C. → **9,288**
- What is the sales revenue, leaving out cancellations and non-sale rows? Revenue is Quantity times UnitPrice. Only count rows where InvoiceNo does not start with C, Quantity is above 0 and UnitPrice is above 0. → **10,666,684.54**
- Which 5 countries have the most sales revenue? Revenue is Quantity times UnitPrice, only rows where InvoiceNo does not start with C, Quantity is above 0 and UnitPrice is above 0. → UK 9,025,222.08 first
- What is the sales revenue for each month? Revenue is Quantity times UnitPrice, only rows where InvoiceNo does not start with C, Quantity is above 0 and UnitPrice is above 0. Show the months in order. → line chart, peak 2011-11
- Chip: **What is Sales revenue?** → **£10,666,684.54**, then **Convert Currency** → USD.
- Follow-up after the countries answer: **Show the top 10 countries instead.**
