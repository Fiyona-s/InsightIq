# Data-leakage warning (Predictions)

Approved exception 3c (CLAUDE.md rule 3): a **warning only**. It never changes training, the registry, reported metrics or what gets trained, and it never blocks anything. Code: `backend/app/leakage_check.py` (read-only; no writes, no AI, does not import or edit the protected `backend/app/automl/` package). Route: `POST /api/datasets/{id}/leakage-check` (project-scoped). Tests: `backend/tests/test_stage4_leakage_check.py`.

## When it runs

- **Before training**, on the "Check and train" step, for the predictors the owner has ticked (it re-runs when the target or the ticked columns change).
- **After training**, on the results step, together with the score rule D.
- Only for the tasks "Predict a number" and "Predict a category". The other tasks have no target to give away.

## The rules (constants live in `leakage_check.py`)

Rows used: the dataset's rows with a target value, at most 5,000 (the local training ceiling).

| Rule | Looks for | Threshold | Sentence |
|---|---|---|---|
| **A** | One predictor value that always means one outcome, where that outcome is not the usual one. | The value occurs in at least **10 rows** and at least **2%** of rows, and the target has the same value in **every** one of them (100% purity); the target value is not the overall most common. | "When revenue is 0, status is always cancelled (48 of 48 rows)." |
| **B** | A predictor that nearly decides the target. | Taking the most common target value inside each predictor value, they cover at least **98%** of all rows; the predictor has at most **20 distinct values per 100 rows** (so a unique id is not a rule); the target's own most common value is below 98%; the target has at most 50 distinct values. | "Knowing refund_status tells you status in 99% of rows." |
| **C** | A numeric predictor that is almost a copy of a numeric target. | **Absolute Pearson correlation of at least 0.98**, or equal to the target in every row; at least 95% of rows numeric, at least 10 pairs. | "total_with_tax moves with total almost exactly (correlation 0.99)." |
| **D** | (After training) a suspiciously high score. | Validation or final-test accuracy, macro-F1 or R² of **0.98 or more** (the Stage 3 rule, unchanged). | "This score is unusually high ..." and the suspects from A-C are named. |

Empty cells count as the value "(empty)". Only one finding per predictor is shown (A before B before C).

## What the warning says and does not say

It says a column **may give away** the answer (never that it does), shows the counts behind that, and suggests unticking it. It does not say the column is wrong (a strong, legitimate predictor can trigger B or C), it does not exclude the column, and it adds no quality badge. It uses counts only; no model-written text.

## Not covered

- The protected `automl/data.py` still blocks some columns **by name** (for example `status`, `refunded`, `delivered`, `net_revenue`) with a hard error; that is unrelated to this warning and unchanged (owner decision D3: not touched).
- Leakage that needs several columns together, or time-based leakage, is not detected.
