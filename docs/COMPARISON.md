# InsightIQ and a general chat assistant: what is different, and what is not

This page describes design differences you can check in the app. **It makes no claim that InsightIQ is more accurate than any other tool.** Both can give a wrong answer; the difference is in what you can inspect and what is kept. The wording about data handling follows `SECURITY_AND_PRIVACY.md`; nothing here says your data is private, secure or protected.

| Topic | A general chat assistant (pasting numbers or uploading a file) | InsightIQ | How you can check it |
|---|---|---|---|
| **How an answer is produced** | The assistant reads the text or file you give it and writes an answer. How it got there is usually not shown as a checkable step. | The AI writes a read-only database query for your table. The query runs on your data and the app shows the result. The answer sentence is built from that result. | Ask a question, open **Show details**: the data rows and (with technical details on in Settings) the query are shown. |
| **Your raw rows** | Pasted or uploaded content is part of what you send. | The CSV file and raw table rows are **not** sent to the AI provider. | `SECURITY_AND_PRIVACY.md`, "what is sent to the provider". |
| **What does leave the computer** | Whatever you paste or upload. | The question, column names, the type you confirmed for each column, row counts, your own definitions, up to three earlier turns of the same chat (with a small summary of earlier results), and, after a query runs, **computed result values and labels** used to word the answer. These can include real numbers and names from your data. | Same section. If a value must not leave, do not ask a question whose answer shows it. |
| **Units (money, percent)** | Often guessed from the numbers or column names. | A unit appears only after **you** confirm it for a column. Column-name guesses are shown only as a labelled suggestion. | Ask page: "What are these numbers?". Without confirmation, numbers are plain. |
| **Column types** | Inferred silently. | You confirm each column's type before the first question; the file is not changed. Values that cannot be converted are left out of totals and averages. | Ask page, "Check column types". |
| **Saved answers** | The chat history, if the product keeps one. | Every successful answer is kept with its question and its result rows (up to 1,000 rows each, newest 500 answers) on your computer. Pinned answers can be put on dashboards, exported as PDF or CSV. | Dashboards page; `SECURITY_AND_PRIVACY.md`. |
| **Business definitions** | You re-explain each time. | You can write what columns and key numbers mean once; they are used for later questions on that dataset. Nothing you write is treated as verified unless you approve it. | Business definitions page. |
| **Repeating a question** | May give a different answer each time. | A saved answer can be run again on the current data without calling the AI. | Result menu: "Run again on current data". |
| **Feedback** | Varies. | "Helpful / Not helpful" is stored for you. It is never sent to the AI and never changes answers. | `SECURITY_AND_PRIVACY.md`. |

## What InsightIQ does not do (limits)

- It answers **read-only questions about one table at a time** (a CSV file you add). It does not edit your file by asking, and it does not join several files in one question.
- It works on **CSV files**, up to the size shown on the upload screen (a measured safe default for a 2 GB container; see `P4_LARGE_FILES.md`). It does not connect to databases or live systems.
- **The AI can still be wrong.** It can misread a question or pick the wrong column. The query and the result rows are there so you can see what was calculated; the independent checker `scripts/verify_demo.py` lets you compare answers on your own file against a plain pandas calculation.
- It does not use your data to train anything and does not claim that the provider you configure keeps data private. That depends on the provider and your account with them.
- It does not predict beyond what a model measures on data it has not seen, and it shows those measured results, not promises. Predictions are separate from questions.
- It has **no masking or redaction** of values that appear in answers.
- Login, roles and two-step sign-in exist but are off by default, not independently reviewed, and not ready to host anyone's data (`ACCOUNTS_PLAN.md`).
