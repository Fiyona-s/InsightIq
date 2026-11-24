# Owner journey (Stage 3)

What a first-time owner does, in order, and what they see. Recorded in a real browser against a throwaway workspace with the controlled test provider (no live AI call). Video: [stage3/journey/new-owner-journey.webm](stage3/journey/new-owner-journey.webm). Test: `frontend/e2e/19-stage3-journey.spec.ts`.

**Honest limit.** The recorded run is scripted. It finished in **3 seconds** on this computer and the test fails if it exceeds 300 seconds or opens any help/guide page. A scripted run proves the path exists and needs no help text; it does **not** measure how long a person needs to read, type and decide. I have not timed a human.

## The path

| # | What the owner does | What they see | Screenshot |
|---|---|---|---|
| 1 | Opens the project menu, **New project**, types a name, **Create project** | The top bar shows the new project; Home says "Add your data to get started" with one button and a four-step progress line | [01](stage3/journey/01-home-new-project.png) |
| 2 | **Upload a dataset**, chooses a CSV | "…imported successfully"; one table row with rows, columns, date; preview underneath | [02](stage3/journey/02-datasets.png) |
| 3 | Goes Home. Types a question in the big box, **Ask now** | Ask opens with the question already typed. **Nothing has run.** | [03](stage3/journey/03-ask-first-visit.png) |
| 4 | Sets "revenue" to *Decimal number*. A short card **What are these numbers?** then lists each number column with **Money (USD)** / **Percentage** / **Neither**, pre-selected from the column name and marked **Suggested**. The owner ticks **I confirm these types** (or presses **These types look right**; one click confirms the types and these choices), types the question and presses **Enter** or **Analyze** | Analyze stays disabled until the owner confirms, even if every column is Text. Until then nothing is shown as money or a percentage. Then one sentence: "Your total revenue is $2,500.00." (the $ appears because the owner confirmed revenue as money). **Show details** offers the data and a plain "How this was calculated"; the SQL appears only if Show technical details is switched on in Settings. | [04](stage3/journey/04-first-answer.png) |
| 5 | **Pin to dashboard** | A dialog with **New dashboard…** already chosen (the project has none), a name field, and next to the **Pin** button: "Pinning saves up to 1,000 result rows in this project on this computer." **Pin** | [05](stage3/journey/05-pin-dialog.png) |
| 6 | **Dashboards**, **Export PDF** | The dashboard "Weekly numbers" with the pinned tile; the PDF downloads. Front page: title, project, prepared date, the large number and a one-line caption; last pages: the appendix showing how it was calculated (example pages (screenshots removed 2026-11-23)) | [06](stage3/journey/06-dashboard.png) |

## Rules that hold on this path

- A unit (a $ or a %) is shown only for a column the owner confirmed. A column name never turns a number into money or a percentage by itself; it can only pre-select a **Suggested** choice for the owner to accept or change (CLAUDE.md, rule 4).
- A question typed on Home is **never** run from Home. The owner always passes through Ask, where column types are confirmed first (the existing confirmation rule is unchanged).
- Saving anything (pin or save to library) happens **only** on the explicit Pin/Save click; the API's confirmation flag is sent from that click and nowhere else. Unit tests prove nothing is saved by opening, editing or cancelling.
- No login, "private" or "secure" wording is used. Projects organise data; they do not protect it.

## Reopening a question later

Every successful answer is saved with its own question on this computer (up to 1,000 rows; the newest 500 answers are kept). After a reload or restart, **Recent questions** reopens the chat with its answer, no AI call needed. Questions asked before this was added say so and offer **Ask it again**.

## What I could not claim

- No measurement with a real first-time person, so "understood in 5 seconds" is a design goal, not a result.
- The controlled test provider only answers a few question shapes, so answer *quality* is not assessed here.

## Predictions (Stage 4)

1. **What do you want to predict?** Pick a task card and, for a number or category, the column to predict. One button: **Next: check and train**.
2. **Check and train.** Tick the columns you would already know when you make a prediction. If one looks like it gives the answer away (for example "When revenue is 0, status is always cancelled"), a warning names it and why; it never blocks. Confirm, then **Train local models**.
3. **Results and predict.** One sentence says how often the best model was right on rows it had not seen, next to what a simple guess would score. Below it: the numbers behind it, what mattered, where it was wrong, and **Predict with a saved model**.

## Business definitions (Stage 4)

Two tabs: **What your columns mean** (a description and a unit for each column; **Draft with AI** suggests descriptions after showing exactly what would be sent) and **Your key metrics** (a name, a plain meaning and a unit; the calculation is one click away). **Advanced** holds verified examples and search and is closed by default.

