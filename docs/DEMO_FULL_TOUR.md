# InsightIQ: full demo tour (every module, every button)

The 5-minute script is [DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md). This longer tour covers every button. **Only the 5-minute script is re-run click by click by an automated browser test on every release** (`frontend/e2e/26-stage7-demo-script.spec.ts`); this longer tour was last checked by hand at Stage 4 and some button labels may have moved since. If a step does not match the screen, trust the screen and the 5-minute script.

How to use this file: open the app, follow the steps in order, tick each box as you go. Each step says what to click, what you should see, and what to say. A short path (about 10 minutes) is marked **[SHORT]**; do everything for the full tour (about 40 minutes).

## 0. Before you start

**What you are demonstrating:** the redesigned owner experience (Stage 3). It runs as a throwaway copy on your computer. It is **not** your original workspace (Docker), which is never touched.

**Open:** http://127.0.0.1:5180 (already running if I started it for you).

**If the page does not load, start it yourself** (two terminals):

```
cd <project>/backend
env -i HOME=$HOME PATH=$PATH ../.venv/bin/uvicorn tests.e2e_server:app --host 127.0.0.1 --port 8010

cd <project>/frontend
API_PROXY_TARGET=http://127.0.0.1:8010 npm run dev -- --port 5180 --strictPort
```

Stop with Ctrl+C in each terminal. **Restarting the first one erases all demo data** (it stores everything in a temporary folder), which is the easiest way to start over.

**Files to upload** (in `docs/demo/`):

| File | Use |
|---|---|
| `shop-sales-2026.csv` | the main demo: 120 orders (order_id, order_date, region, product, quantity, unit_price, discount_pct, revenue) |
| `scratch-orders.csv` | a 3-row throwaway file for the delete and archive demos |

**Numbers you should see** (so you can tell it is correct): total revenue **356,446**, 120 rows. By region: East 109,219.5 · South 89,927 · West 84,978.5 · North 72,321.

### Read this first: what the "AI" is in this copy

This copy uses a **stand-in AI** (no internet, no real model), so tests are repeatable. It only understands three kinds of questions:

| Type this exactly | You get |
|---|---|
| `What is the total revenue?` (or any text without "by region") | total revenue 356,446 |
| `Total revenue by region` (any text containing "by region") | a 4-bar chart, one bar per region |
| `How many orders are there?` | 120 |

**Do not click the suggestion chips for the live answer.** They fill the box, but this stand-in answers any other text with total revenue, which would look wrong. Tell your guide: with the real AI configured, any plain-English question works. This copy only proves the app around it.

## 1. Projects and the top bar  **[SHORT]**

The top bar has: **Project** switcher (left), **dataset** selector (middle, appears once the project has data), **Menu** (right). On a phone-width window there is a ☰ button for the side menu.

- [ ] Click the **Project** button. You see the project list, **New project**, **Manage projects**.
- [ ] **New project** → type `Demo shop` → **Create project**. The bar now says Demo shop. *Say:* "A project keeps one business's data together. Everything I do now stays inside it."
- [ ] Look at the top bar: there is **no dataset selector yet** (nothing to choose). Press **Home**.

**Honest note to say:** projects organise data; they do not protect it. There is no login in this version.

## 2. Home (empty project)  **[SHORT]**

- [ ] The page says **Add your data to get started** with one **Upload a dataset** button, and a **Get started** list of four steps (Upload, Review the profile, Ask, Pin).
- [ ] Click **Upload a dataset**. You land on **Datasets**.

## 3. Datasets  **[SHORT, with extras]**

### 3.1 Import
- [ ] An empty project shows one drop zone ("Upload a CSV"). Click **Choose file** and pick `shop-sales-2026.csv` (or drag it in).
- [ ] You see "shop-sales-2026.csv imported successfully." and a table with one row: **Name, Rows (120), Columns (8), Added, Status**, and a **⋯** button at the right.
- [ ] Below it: the preview (first rows), a one-line summary "0 missing values · 0 duplicate rows · 0 empty columns · 0 type issues" with **Details**, and tabs **Preview** and **Columns**.
- [ ] The top bar now shows the dataset selector (name, rows, columns).

### 3.2 Look around the page
- [ ] **Details** (next to the summary) → a side panel "Data quality details" with the full review. Press **Esc** or the **×** to close. *Say:* "Counts only. I do not label data Good or Bad because I have no documented threshold for that."
- [ ] **Columns** tab → each column with its type and a description box. **Preview** tab → back to the rows.
- [ ] **Sort rows** drop-down changes the order of the preview. **Previous rows / Next rows** page through.
- [ ] Hover a cell: a small pencil shows only on hover or keyboard focus (not on every cell).

### 3.3 Edit a value (then undo it)
- [ ] Switch **Edit mode** to On. Click a **product** cell (for example "Lamp"), type `Lamp large`, press **Enter**.
- [ ] The footer counts "1 modified cell". Click **Save changes** and **OK** on the browser's confirm box. You see "Saved · Version 2".
- [ ] *(Optional)* edit another cell, then press **Discard** to throw the change away.

### 3.4 Row menu (**⋯** at the end of the row)
- [ ] **Rename** → type `Shop sales 2026` → **Save name** (the file name stays visible under it).
- [ ] **Download CSV** → downloads the latest saved file.
- [ ] **Version history** → a side panel listing revisions. You should see revision 2 (your edit) and revision 1. Press **Preview revision 1** to see it read-only; press **Restore revision 1** → **Create new revision** (confirm). A new revision 3 is made from revision 1; nothing is overwritten. Close the panel.
- [ ] **Archive** (see 3.5) and **Delete** (see 3.5).

### 3.5 Several datasets, archive and delete
- [ ] **Import CSV** (top right) → choose `scratch-orders.csv`. Now the table has two rows, a **Find a dataset** box appears, and each row has a checkbox.
- [ ] Row menu of scratch-orders → **Archive** → a dialog lists what depends on it → **Archive**. It leaves the **Active** list. Press **Archived** (filter buttons: **Active / Archived / All**). Row menu → **Restore** brings it back.
- [ ] Row menu → **Delete**. The dialog asks you to type the dataset's name and tick an acknowledgement if it has dependants; **Delete permanently** stays disabled until it matches exactly. *Say:* "Deleting is deliberately hard."
- [ ] Select both rows with the checkboxes: a bar appears with **Archive / Delete / Clear** (bulk actions). Press **Clear**.

## 4. Ask your data  **[SHORT]**

Go to **Ask** (side menu).

### 4.1 First visit: confirm column types
- [ ] The page has **Ask your data**, the question box ("Ask a question about …", in italics so it is clearly a hint), **Analyze**, and a "Check column types" card that is **open** the first time.
- [ ] **Analyze is disabled** and the page says "Confirm column types to continue." *Say:* "The app never analyses data until the owner confirms what each column is."
- [ ] Click **Use suggested types** (it proposes Whole number, Date, Decimal number…) and look at the plain names: Text, Whole number, Decimal number, Date, Date and time, Yes / No. Make sure **revenue** is **Decimal number**.
- [ ] Tick **I confirm these types** (or press **These types look right**). Analyze becomes available. *Say:* "It remembers this for the dataset; I will not be asked again."
- [ ] Under the type list, **What are these numbers?** has one line per number column: **Money (USD)** / **Percentage** / **Neither**, pre-selected from the column name and marked **Suggested**. Change any line, then tick the box (or press **These types look right**): the types and these choices are confirmed together. Until then every number is shown plainly (no $ and no %). The currency offered comes from Menu, Settings, **Currency offered for money columns**.

### 4.2 First answer
- [ ] Type `What is the total revenue?` and press **Enter** (or **Analyze**). Enter sends the question; **Shift+Enter** adds a new line. Progress text appears, then one sentence: **Your total revenue is $356,446.00.** (because you confirmed revenue as Money (USD) in step 4.1; had you chosen Neither it would read 356,446) with the caption "From … · 1 result row · using the column types you confirmed".
- [ ] **Show details** → tabs **Data** (the result) and **How this was calculated** (steps plus exact, unrounded values). The **SQL** tab (the exact query; **Copy SQL**) appears only after Menu, Settings, **Show technical details**. *Say:* "Every answer can be checked."
- [ ] **Copy answer** copies the sentence.
- [ ] **⋯** (More result actions) → **Download CSV**, **Run again on current data**, **Propose as verified example** (Pin to dashboard already saves the chart) (this only proposes; a person must approve it later in Business definitions).
- [ ] **Helpful / Not helpful**: press **Not helpful** to see reason buttons and a box, then **Save feedback**. *Say:* "Feedback is stored but never fed back to the AI."

### 4.3 Pin to a new dashboard
- [ ] **Pin to dashboard** → a dialog: **Title**, **Dashboard** (since you have none, **New dashboard…** is already chosen), **New dashboard name**, **Advanced** (refresh policy). Next to the **Pin** button read the sentence: "Pinning saves up to 1,000 result rows in this project on this computer."
- [ ] Change the title to `Total revenue`, name the dashboard `Weekly numbers`. *(Optional, to demo Refresh later: open **Advanced** and choose **Manual safe SQL refresh**.)*
- [ ] Press **Pin**. You see "Pinned to your dashboard. New dashboard “Weekly numbers” created." *Say:* "Nothing is saved until this exact button is pressed."

### 4.4 Follow-up and chart
- [ ] The box now says "Ask a follow-up about this result". Type `Total revenue by region` → **Analyze**. You get a bar chart with 4 bars and "Showing 4 rows: total revenue by region."
- [ ] **Visualization** drop-down changes the chart (bar / donut / table). Pin this one too: **Pin to dashboard** → choose **Weekly numbers** → title `Revenue by region` → **Pin**.
- [ ] **New question** clears the thread. **Recent questions** (at the bottom) lists past questions; click one to reopen it. **Data sharing** (under the box) explains what is sent to the AI provider. Say plainly: "No automatic masking is applied."
- [ ] Type `How many orders are there?` → you get 120 (this is a third working question).

## 5. Dashboards  **[SHORT]**

Go to **Dashboards**.

### 5.1 View mode
- [ ] You see a tab for **Weekly numbers**, **New dashboard**, **Saved charts · 2**. The title shows an **Updated <date>** chip (dates are written like "17 Nov 2026" everywhere). Tiles show the title **exactly as you typed it**, an **Updated** chip and a **Current** chip.
- [ ] **Export PDF** (green button, the main action) → open the PDF. Expect: page 1 title, "Project: Demo shop · Prepared <date>", the big revenue number with a one-line caption; a chart page; the last page "Appendix: how this was calculated" (SQL, facts, digest, limits); every page has "Snapshot of your data; may be out of date" and "Page X of Y". *Say:* "A bank can read the front pages; the appendix lets them verify."
- [ ] Dashboard **⋯** menu: **Duplicate dashboard**, **Export PDF without calculation pages**, **Refresh all**, **Delete dashboard**.

### 5.2 Tile menu (the **⋯** on each tile)
- [ ] **Details** → side panel with tabs **Exact rows** and **Evidence & provenance** (question, computed facts, SQL, digest).
- [ ] **Download CSV** (and **Download PNG** on chart tiles).
- [ ] **Refresh** → **Confirm refresh** (only if pinned with *Manual safe SQL refresh*; otherwise it is greyed out and the tooltip says why). After a refresh, **View previous snapshot** appears and opens a read-only history.

### 5.3 Edit mode
- [ ] Press **Edit dashboard**. New controls: **Dashboard title**, **Description**, **Add chart**, **Add note**, **Filters**, and on each tile a drag handle, ↑ ↓ arrows, copy, trash, **Layout** (width and height) and **Chart type**.
- [ ] **Add chart** → the **Saved charts** window: pick a chart and **Add chart widget**; a "Possible duplicate" box asks **Cancel / Add anyway / Replace**. The same window lists every saved chart with **Delete saved chart**.
- [ ] **Add note** → type a sentence → **Add note widget**. The tile is labelled as your own note.
- [ ] **Filters** → side panel: choose a column and values to narrow all charts, **Apply filter**; reset to clear.
- [ ] Click a tile title to rename it; **Reset to default** appears afterwards.
- [ ] Trash icon on a tile → a window "Delete this widget?" **Keep widget / Delete widget**. *Say:* "Saved charts stay in the library."
- [ ] Press **Done editing**.

### 5.4 Dashboard actions
- [ ] **New dashboard** (top) → name → **Create dashboard**. **Duplicate dashboard** and **Delete dashboard** are in the **⋯** menu (delete asks to confirm).
- [ ] **Display currency** only shows up when a chart has a confirmed currency (see section 7).

## 6. Predictions  (full tour)

Go to **Predictions**. Three steps are at the top: **1 What do you want to predict? · 2 Check and train · 3 Results and predict** (on a phone: ① ② ③ with the step name as the heading).

- [ ] **Step 1, What do you want to predict?** A line says which data you are using ("120 rows · Ready"); **Refresh profile** re-reads the file. Five task cards: **Predict a number**, **Predict a category**, **Group similar records**, **Find unusual records**, **Forecast future values** (the technical name is the small second line). Choose **Predict a number**, set **Target column** to `revenue`; a small table shows the target's most common values. **Profile-based suggestions** and **Earlier experiments** are closed disclosures. Press **Next: check and train** (it is the only primary button here).
- [ ] **Step 2, Check and train.** A **Search features** box and one row per column with its missing and unique counts. `order_id` is already excluded as an identifier. Tick `quantity`, `unit_price`, `discount_pct`, `region`; leave `order_date` and `product` off. **Leakage:** if a ticked column looks like it gives away the answer, a box says which column and why in numbers ("When revenue is 0, status is always cancelled (48 of 48 rows)"); it is a warning only and never blocks training. Tick **I confirm selected predictors…**. **Advanced settings** (experiment title, scaling, seed), **Training limits** and **About your data** are closed. Press **Train local models** (the only primary button) and wait a few seconds.
- [ ] **Step 3, Results and predict.** One plain sentence of measured facts first ("On rows it had not seen, the best model was right 76% of the time; always giving the most common answer would be right 82%…"), then **How accurate is this?** (the baseline column says "Simple guess, for comparison"), the final-test cards, charts ("What mattered most to the model"), **Where it was wrong**, and closed **Compare all models tried** and **Technical details**. Below, on the same step, **Predict with a saved model**: pick the **Saved model**, fill the inputs, **Predict with saved model**, **Export prediction CSV**. *Say:* "These are measured here, not claimed."

**Honest note:** in this demo file, revenue is quantity × price minus discount, so the model looks almost perfect and the warning names `revenue`. In real use that is called data leakage. Do not present the score as a genuine accuracy figure. The warning looks at the numbers (rules in [LEAKAGE_WARNING.md](LEAKAGE_WARNING.md)); a few column names (such as `status` or `net_revenue`) are still blocked by the training code regardless of the data.

## 7. Business definitions

Go to **Business definitions** (side menu).

- [ ] Two tabs: **What your columns mean** and **Your key metrics**; one primary button on each (**Save knowledge**). A line says how far you are ("5 of 8 columns described · 2 key metrics"). **Draft with AI** (an outline button) and its review list sit under the columns; **Advanced: verified examples and search** is one closed disclosure at the bottom.
- [ ] Type a **Dataset description** and a description for `revenue` ("Money taken from a sale").
- [ ] On **What your columns mean**, every column row has a "Shown as" drop-down: **No unit**, **Percentage**, a currency (for example **USD**), or the mixed / unknown options. A small note "Suggested: money. Not shown as such until you choose it." appears only until the owner has confirmed the dataset's numbers. Press **Save knowledge**. If something depends on the old setting, a window "Currency dependency impact" asks you to confirm.
- *Say:* "The app never shows a dollar sign or a percent sign because of a column name. A name only pre-selects a suggestion; the owner confirms it."
- [ ] Go back to **Ask**, run `What is the total revenue?` again. The answer now shows with the currency symbol only because you confirmed it (for USD: $356,446.00; for INR: ₹3,56,446.00) and a **Convert Currency** button appears under it (fixed **test** exchange rates in this copy): pick a **Target currency** → **Apply conversion**, and **Reset to Original Currency** to undo. Pin it and the dashboard shows a **Report currency** choice.
- [ ] On **Your key metrics**, **Add metric**: name, meaning, unit; the query is behind **Show the calculation** (open while it is empty).
- [ ] **Draft with AI** → a window "Draft data sharing" explains what is sent → **Confirm and draft**. You get drafts per column that you **Approve** or **Reject** (and **Clear rejected drafts**). In this copy the text is a fixed stand-in; nothing is applied until you approve.

## 8. Menu, Settings and the hidden developer area

- [ ] Click **Menu** (top right): **Settings**, **Show admin tools**, **Projects**, **Design system**.
- [ ] **Settings**: **Currency offered** and **Show technical details** ("Hide sample data" is in Datasets; the sidebar collapses with its own button).
- [ ] **Projects**: the full list with **Datasets / Dashboards** counts. **Open** switches; **⋯** has **Rename**, **Archive**, **Delete**; archived projects show **Restore**. Delete previews what is inside and needs the exact name typed. The Default project cannot be archived or deleted.
- [ ] **Show admin tools**: three more pages appear in the side menu under a banner that says **"Admin tools: Not protected by a login."** *Say:* "I did not build a login, so I do not pretend this area is secure."
  - **Accuracy check**: evaluation setup (modes, question list, offline replay). Empty until you run it.
  - **Performance & errors**: filters over past runs (**Apply analytics filters**, **Reset**).
  - **Execution traces**: step-by-step history of each question.
- [ ] Turn **Show admin tools** off again: those pages disappear from the owner's menu.
- [ ] **Design system**: the shared buttons, chips, tables, windows. This page exists only in this development copy.

## 9. Back to Projects: the last demo  **[SHORT]**

- [ ] **Project** switcher → **Default project**. Notice that Demo shop's datasets, questions and dashboards are **gone from every page**. Switch back to see them return. *Say:* "Each project is a separate view."

## 10. What to be honest about

Say these yourself before anyone asks:

1. The AI in this copy is a **stand-in** for repeatable tests; answer quality was not measured. With a real provider configured, answers can still be wrong: every answer shows how it was calculated so you can check it.
2. There is **no login**. Projects, the Admin switch and "Hide sample data" organise and tidy; they do not protect anything. Anyone using this computer can open everything.
3. Nothing is masked: with a real provider, questions, column names and some result values are sent to it.
4. No real first-time person has been timed; the "under 5 minutes" run was scripted.
5. The Predictions warning ("may give away the answer") looks at the numbers and can be wrong either way; the scores are measured on held-out rows next to a "simple guess", not promises about the future.
6. Exchange rates in this copy are test values.
7. Sample data is whatever you mark in Datasets. Nothing is guessed from a file name.

## 11. If something goes wrong

| Problem | Fix |
|---|---|
| Page does not load | start the two terminals in section 0, hard refresh (Cmd+Shift+R) |
| "Analyze" stays grey | press **These types look right** (or tick the confirm box) |
| Answer is "total revenue" for a different question | expected: stand-in AI (section 0) |
| Everything looks empty | you are in a different project: use the **Project** switcher |
| Want a clean start | stop and restart the backend terminal (data is temporary) |
| Refresh greyed out on a tile | the chart was pinned as a fixed snapshot; re-pin with **Manual safe SQL refresh** |
