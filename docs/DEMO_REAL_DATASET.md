# Trying InsightIQ on a real CSV (for example from Kaggle)

A step-by-step check you can repeat on any public CSV. The aim is an **honest record on that one file**: which questions matched an independent calculation, and which did not. It is not a measurement of general accuracy, and nothing from it should be quoted as one.

**Before you start.** Use a file you are allowed to use and that holds nothing sensitive: when you ask questions, the question text, column names, the types you confirm and the computed result values can be sent to the AI provider you configured ([exactly what is sent](SECURITY_AND_PRIVACY.md)). Do not commit the file: `*.csv` is ignored by git on purpose.

## 1. Check the size

InsightIQ takes CSV files up to **60 MB, 1,000,000 rows and 100 columns** by default.

```sh
ls -lh your.csv          # size
wc -l your.csv           # rows (one more than the data rows)
head -1 your.csv         # the column names
```

## 2. Trim it if it is over a limit (pandas)

```python
import pandas as pd
df = pd.read_csv("your.csv")
df = df[["date", "region", "product", "quantity", "revenue"]]     # keep the columns you will ask about
df = df.sample(n=200_000, random_state=1) if len(df) > 200_000 else df   # a fixed-seed sample, if needed
df.to_csv("your-trimmed.csv", index=False, encoding="utf-8")
```

Say in your notes that the file was sampled; questions about totals then describe the sample, not the original.

## 3. Start the app on a fresh workspace

```sh
sh scripts/demo.sh        # stop later with: sh scripts/demo.sh stop
```

It needs your AI settings in `.env` (see `.env.example`) to answer new questions.

## 4. Upload and confirm the column types

1. On Home choose **Upload a dataset** and pick the file. You land on Ask.
2. In **Check column types** press **Use suggested types**, read each line, change any that are wrong, then tick the confirmation. Nothing is changed in your file.
3. Under **What are these numbers?** mark a column as money or a percentage **only if it is**. Without that, numbers appear plain.
4. Optional: write what your columns mean in **Business definitions** (the Columns tab in Datasets shows those descriptions read-only). Pinning an answer to a dashboard also saves its chart; there is no separate "save" step.

## 5. Write ten questions

Copy `docs/demo/verify_questions.template.json` to `my-questions.json` (outside the repository, or it will be ignored by git if it ends in `.csv`; JSON is fine to keep locally) and edit it for your columns. Mix kinds:

1. a count of rows,
2. a total of one column,
3. an average,
4. a total by one category,
5. the top 3 categories,
6. a total with one filter,
7. a count with a numeric condition,
8. a count of distinct values,
9. the minimum and maximum of a column,
10. one question about a date range or a ratio you can compute yourself.

Each entry has the question in plain English and a `compute` block that tells the checker how to calculate it (the template shows every supported form).

## 6. Get the independent answers

```sh
pip install -r backend/requirements-verify.txt
python scripts/verify_demo.py --csv your-trimmed.csv --questions my-questions.json
```

The script reads the CSV with pandas and **never uses InsightIQ's query path**. If you told InsightIQ a column is Text, add `--text thatcolumn`. Keep the printed table.

## 7. Ask the same ten questions in InsightIQ

For each, write down the answer sentence, and open **Show details** to see the data. To see the query itself, switch on **Show technical details** in Settings (the Menu has Settings). Note whether the question was understood as you meant it.

## 8. Compare and record both outcomes

Copy this table into a local note (not the repository if it names private data):

| # | Question | pandas says | InsightIQ says | Same? | Why, if not |
|---|---|---|---|---|---|
| 1 | | | | | |

Mark each row **same**, **different** or **not comparable**. Write down the **misses** as carefully as the matches: a wrong column, a total that differs because some values could not be converted to numbers and were left out, a tie, an empty value counted differently, rounding in the displayed sentence (the exact value is in Show details), or a question InsightIQ read differently than you meant. A miss is a finding, not an embarrassment, and it tells you what to explain to the next person.

At the end write one sentence like: *"On `your-trimmed.csv` (N rows), 8 of these 10 questions matched an independent calculation; the 2 that did not were …."* That sentence is about this file and these questions on this day. **Do not turn it into a percentage or an accuracy claim.**

## 9. Talking points: how is this different from a chat assistant?

These come from [COMPARISON.md](COMPARISON.md); say them as design facts you can show, not as claims of being better.

- The AI writes a **read-only database query**; the query and the result rows are one click away, so you can check what was calculated.
- Your **raw rows are not sent** to the AI provider. What is sent is listed exactly, and it includes computed result values, which can be real numbers and names.
- **Units** (money, percent) appear only after you confirm them; **column types** are confirmed by you first.
- Answers are **saved** with their question and can be pinned to dashboards and exported as a PDF; a saved answer can be re-run on current data without the AI.
- It works on **one table at a time, read-only, CSV only**, and the AI can still be wrong.

If someone asks "is it more accurate?", the honest answer is: *not claimed. Here is a file and a way to check it yourself.*
