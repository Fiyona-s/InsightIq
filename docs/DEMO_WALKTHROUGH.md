# InsightIQ: 5-minute demo script

For an owner or an interviewer. Follow the steps in order on **throwaway data**. Every "You should see" line is checked by an automated browser test that follows this script click by click (`frontend/e2e/26-stage7-demo-script.spec.ts`), so if the screen differs, something has changed.

**What you are showing:** a local, single-user app that lets a non-technical owner upload a CSV, ask in plain English, and check the answer. **What you are not showing:** a login, per-company data, or a live AI (see "Say this plainly" at the end).

## 0. Start a clean throwaway copy (1 minute, once)

Two terminals, from the project folder:

```sh
cd backend  && env -i HOME=$HOME PATH=$PATH ../.venv/bin/uvicorn tests.e2e_server:app --host 127.0.0.1 --port 8010
cd frontend && API_PROXY_TARGET=http://127.0.0.1:8010 npm run dev -- --port 5180 --strictPort
```

Open **http://127.0.0.1:5180**. This copy stores everything in a temporary folder and uses a **stand-in AI** that answers three questions the same way every time. It is **not** your real workspace. Restart the first terminal to erase everything and start over.

Files are in `docs/demo/`: `shop-sales-2026.csv` (120 orders; total revenue 356,446).

## 1. Home, empty project (20 seconds)

1. Open **Home**. **You should see:** "Add your data to get started", a green **Upload a dataset** button, and a "Get started" list of four steps.
2. Click the green **Upload a dataset**. **You should see:** the **Datasets** page.

## 2. Upload (30 seconds)

3. Click **Choose file** and pick `shop-sales-2026.csv` (or drag it in). **You should see:** "shop-sales-2026.csv imported successfully.", a table with one row (**120** rows, **8** columns), and a one-line summary "0 missing values · 0 duplicate rows · 0 empty columns · 0 type issues". The row has no "Sample" label: nothing is a sample unless you mark it.

## 3. Ask, with a first answer (60 seconds)

4. Click **Ask**. **You should see:** **Analyze** is greyed out and the page says "Confirm column types to continue."
5. Click **Use suggested types**, then tick **I confirm these types**. *Say:* "The app never analyses data until the owner confirms what each column is. Revenue is pre-selected as Money, marked Suggested, because I confirm it; a column name alone never makes a dollar sign appear."
6. Type `What is the total revenue?` and press **Enter**. **You should see:** one sentence, **Your total revenue is $356,446.00.**, with "From shop-sales-2026.csv · 1 result row · using the column types you confirmed". **Show details** is closed.
7. Click **Show details**, then **How this was calculated**. *Say:* "Every answer can be checked. The exact, unrounded values are here; the headline is rounded for reading."

## 4. Pin, follow-up, dashboard, PDF (90 seconds)

8. Click **Pin to dashboard**. **You should see:** the sentence "Pinning saves up to 1,000 result rows in this project on this computer." Type `Weekly numbers` in **New dashboard name** and click **Pin**. **You should see:** "Pinned to your dashboard."
9. In the box (now "Ask a follow-up about this result") type `Total revenue by region` and press **Enter**. **You should see:** a bar chart with four bars and "Showing 4 rows".
10. Click **Pin to dashboard**, choose **Weekly numbers**, click **Pin**.
11. Click **Dashboards**. **You should see:** the dashboard **Weekly numbers** with **two tiles** and an **Updated <date>** chip.
12. Click **Export PDF** (the green button). **You should see:** a PDF whose last pages are "Appendix: how this was calculated" (the question, the exact values, the SQL) and whose every page says "Snapshot of your data; may be out of date".
13. Click **Home**. **You should see:** your dashboard and the recent question.

## 5. Predictions (60 seconds)

14. Click **Predictions**, then **Predict a number**. Choose the target **revenue** and click **Next: check and train**.
15. Tick **quantity**, **unit_price**, **discount_pct**, **region**; leave the others off. Tick the confirmation box and click **Train local models**. **You should see:** the results page, a plain sentence of measured facts, and **How accurate is this?** with a column labelled **Simple guess, for comparison**. *Say:* "The score is measured on rows the model had not seen, next to a guess that always says the average. Here revenue is quantity times price, so a good score is expected and proves nothing about real-world prediction. If a column looked like it gave away the answer, a warning would name it. No AI call was made."

## 6. Business definitions and the Admin area (30 seconds)

16. Click **Business definitions**. **You should see:** two tabs, **What your columns mean** and **Your key metrics**. Type a dataset description. *Say:* "AI can draft definitions, but each one is a suggestion I approve one at a time, and a metric's calculation is approved on its own."
17. Click **Menu**, then **Show admin tools**. **You should see:** more pages under "Admin tools" and the banner **"Admin tools: not protected by a login. Anyone using this computer can open them."** Click **Accuracy check**: it explains that "0 of 45" means nothing has been measured yet, not low accuracy. Click **Backup info** (where data and backups live, how to restore) and **Dataset change history** (what it covers and what it does not).
18. Click **Menu**, then **Show admin tools** again to switch them off. The owner's menu is back to six pages.

## Say this plainly (before anyone asks)

1. The AI in this copy is a **stand-in**. With a real provider, answers can still be wrong; that is why every answer shows how it was calculated.
2. There is **no login**. Projects, the Admin switch and "Hide sample data" organise the screen; they do not protect anything. Anyone using this computer can open everything.
3. Nothing is masked. With a real provider, your questions, column names and some result values are sent to it.
4. No claim of general accuracy is made. The 45-question accuracy check is a small fictional benchmark.
5. CSV files only. No logins, per-company data or hosted version exist yet.

## If something goes wrong

| Problem | Fix |
|---|---|
| Page does not load | Check both terminals are running; hard refresh (Cmd+Shift+R). |
| **Analyze** stays grey | Type a question; on a first visit also tick **I confirm these types**. |
| The answer is "total revenue" for a different question | Expected: the stand-in AI only knows three questions (`What is the total revenue?`, `Total revenue by region`, `How many orders are there?`). |
| Everything looks empty | You are in another project: use the **Project** button in the top bar. |
| Start over | Restart the first terminal (all demo data is temporary). |
