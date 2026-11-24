# Predictions demo script (all five cards, run on 2026-11-23 on the real app, port 8080)

Everything below was trained and used live on the updated build. Screenshots are in [predictions-demo/](predictions-demo/). The old experiments were deleted first, so the project now holds exactly the five experiments below (one per card), each with its saved model and the predictions shown. Training is local: **0 AI calls**, each run takes about a second, so you can also retrain live.

## The one idea to get across

**A prediction is an estimate the model calculates for the values you give it. It is not the original value from your dataset.** The model learned patterns from your rows, then estimates for a case. To prove it, the demo enters customers that are in the file and compares the estimate with the real value (card 1 below). The estimate is usually close in size but never exactly the real value.

## Your questions answered, with values from the platform

### 1. What are we predicting? Is it an existing row in the dataset?
**We predict a value for a set of input values. It can be an existing row or an imaginary one, but the model never looks the row up.** It calculates an estimate from the numbers it is given. The real value stays in your file and is usually different. The batch option shows this on every existing row. On the customers file, with the saved regression model (columns: country, invoices, different products, days between first and last order), the model estimated `total_spend` like this ([screen](predictions-demo/6-batch-prediction-existing-rows.png)):

| Row in the file | Real total_spend | Model's estimate | Difference |
|---|---|---|---|
| Customer 12346 (UK, 1 invoice, 1 product, 0 days) | 77,183.60 | 1,353.01 | 75,830.59 too low |
| Customer 12347 (Iceland, 7, 103, 365) | 4,310.00 | 6,599.85 | 2,289.85 too high |
| Customer 12348 (Finland, 4, 22, 282) | 1,797.24 | 1,308.03 | 489.21 too low |
| Customer 12349 (Italy) | 1,757.55 | 1,039.64 | 717.91 too low |
| Customer 12350 (Norway) | 334.40 | 497.76 | 163.36 too high |

Across all 4,338 customers the typical (median) difference is about **300**, and **64.5%** of customers are within 500. A few are off by a very large amount (the biggest difference is 217,033.92). *Caution:* these are rows the model learned from, so this is **not** a fair test; the held-out numbers on the results page are the honest ones (average miss 1,795.86). Customer 12346 is a single order of 74,215 units worth 77,183.60, far outside the pattern of the other customers, so the model cannot estimate it well.

### 2. The options on the prediction form (a "What do these options mean?" link is now on the page)
- **Saved model**: which of the saved models to use. The one marked "selected on validation" is the app's pick; the others were saved too.
- **Prediction input: Single record**: you type the values for one customer. It can be real or imaginary. One estimate comes back.
- **Prediction input: Existing registered dataset**: choose a file already in the project (up to 5,000 rows). You get one estimate per row, shown 50 at a time, and *Export prediction CSV* gives them all.
- **Blank boxes** use the typical value from the training data. **Forecast models** have no boxes: the button forecasts the saved horizon (7 days in this demo).

### 3. On what basis is the best model chosen? Are all models saved?
The app trains several models on the same rows and picks the winner on the **validation rows** (20% the models were *not* trained on), then tests the winner **once** on the untouched **test rows** (another 20%). Choosing on validation and testing on separate rows keeps the final test honest.
- **Predict a number**: lowest **typical large error (RMSE)** on validation. This run, best first: HistGradientBoostingRegressor **3,673.44**, DummyRegressor (the simple "guess the average") 4,151.57, RandomForestRegressor 5,004.62, LinearRegression 5,436.59, Ridge 5,477.31. *Notice that three of the five real models did worse than the simple guess on this measure* because a few huge customers distort the squares. The page shows this ranking under **Why this model was chosen**.
- **Predict a category**: highest **balanced score (Macro F1)** on validation; imbalanced classes use balanced weights.
- **Forecast**: lowest RMSE on two earlier time windows that were held back (backtests); the final window tests the winner, and the saved forecaster is refit on all the history afterward. *Subtle point to expect:* SeasonalNaive had a lower error on the final window (19,405.79) than the chosen LagRidge (62,268.96), but the choice is made before looking at the final window, so it cannot be changed after seeing it; that is what keeps the final test honest. See **Compare all models tried**.
- **Groups / unusual records**: no selection. KMeans and IsolationForest are fixed methods; the number of groups and the flagged share are settings.
- **All models that trained are saved, not only the winner.** The project holds 14 saved models for the 5 experiments: regression 5, classification 4, forecast 3, groups 1, unusual records 1. Each is stored as a file on this computer with a checksum, and each can be chosen in "Saved model". The winner is marked "selected". The limits are 50 experiments and 50 saved predictions.

### 4. Reading the charts (every chart now explains itself from its own data)
Under each chart there are two lines. **"How to read this"** is the fixed definition. **"In this result:"** is written from the plotted data of *that* result, so it changes whenever the data or the model changes. It states any threshold it uses. It never calls a result good or poor.

What it says for the five demo results (copied from the live screens, [all five](predictions-demo/)):

| Card | Chart | "In this result" (generated) |
|---|---|---|
| 1 Predict a number | Actual vs predicted | 200 unseen rows plotted; typical miss about **427.14** (median); **25 rows missed by more than 5 times the typical miss** (more than 2,135.72); largest: real 9,817.12 estimated 65,828.16; real 5,704.97 estimated 57,799.12; real 7,454.07 estimated 57,908.68 |
| 1 | Residuals | estimate higher than real for 122 rows and lower for 78; on average estimates were higher by **929.58**; largest overestimate **56,011.04**, largest underestimate **17,051.93** |
| 2 Predict a category | Class counts | no: 133 really belong, model put 175 there (more); yes: 411 really belong, model put 369 there (fewer) |
| 2 | Wrong-class table | of 133 really "no", 70 (53%) right, 63 went to "yes"; of 411 really "yes", 306 (74%) right, 105 went to "no" |
| 2 | What mattered most | first_order_value 30%, then first_order_units 25% and first_order_different_products 19%; top 3 make up 74% |
| 3 Groups | Customer segments | 500 points drawn (group 0: 180; group 1: 317; group 2: 3); the two axes keep about 79% of the variation |
| 3 | Group table | Group 0 (1,601, 37%) stands out on days between first and last order: 280.74 vs 130.45 overall (about 2.2 times); Group 1 (2,719, 63%) on total spend: 619.73 vs 2,054.27 (about 30% of that average); Group 2 (18, under 1%) on total spend: 110,053.72 (about 54 times as much) |
| 4 Unusual records | Anomaly scores | 217 of 4,338 (5.0%) flagged, starting at scores of about -0.016; the highest score range (0.2563 to 0.2811) holds 3 records, all flagged |
| 5 Forecast | History and forecast | history 374 periods (2010-12-01 to 2011-12-09), 69 filled by your missing-period policy; forecast 7 periods from 52,089.28 to 150,553.86, highest on 2011-12-16 |
| 5 | Final window | over the final 7 periods (2011-12-03 to 2011-12-09) the real total was **528,931.36** and the forecast total **296,657.81**; largest miss on 2011-12-09 (real 200,920.60, forecast 47,368.12) |

Say this about card 1: *most customers are estimated closely (typical miss about 427), but 25 of the 200 were far off, and the worst were overestimates of customers whose real spend was under 10,000. That is why the "typical large error" (9,557.81) is so much bigger than the average miss.* (The earlier "four customers" wording used a stricter cut-off; the screen's rule is the one above.)

### 5. What every card now shows (all five)
Each results page has, in order: the plain summary; the numbers and **What each number means**; **Why this model was chosen** (for groups and unusual records it says no models were compared); the charts with **How to read this** and **In this result**; the tables with a one-line reading per class or group; and, below, the saved models, **What do these options mean?** (for forecasts it explains that there are no boxes and what the button forecasts) and, after a prediction, **What this prediction means**. "Technical details" and "Model schema" are gone.

---

## Data used (all in the project "Online Retail demo")
| File | One row is | Rows | Used by |
|---|---|---|---|
| `online-retail-customers.csv` | one customer | 4,338 | cards 1, 3, 4 |
| `online-retail-first-orders.csv` | one customer who first bought before 1 June 2011: their first order, and whether they bought again | 2,718 | card 2 |
| `online-retail-daily.csv` | one trading day | 305 | card 5 |

All three come from the big file with [make_online_retail_summaries.py](make_online_retail_summaries.py) (run `python3 docs/demo/make_online_retail_summaries.py` from the project folder). They are **summaries of the whole file, not samples**. Training accepts at most 5,000 rows and refuses to sample by itself, so the owner builds a bounded table on purpose. The first-orders table stops at 1 June 2011 so every customer in it had at least six months to come back.

## How to read every results page (say this once)
Each results page now has three layers, top to bottom:
1. **"What the measured results mean"**: one sentence comparing the model with a simple guess.
2. **The numbers**, then **"What each number means"** (new): every number in plain words, using your own values.
3. **"What this prediction means"** (new, appears after you press *Predict with saved model*): what the output is and is not.

The old "Technical details" and "Model schema" blocks are gone from this page.

---

## Card 1: Predict a number (regression), 4 minutes ([screens](predictions-demo/))
**Question:** how much will a customer spend in total?
1. Data `online-retail-customers.csv` → card **Predict a number** → target **total_spend** ([1-number-step1-target](predictions-demo/1-number-step1-target.png)).
2. **Next: check and train.** Read the leakage sentence aloud. `customer_id` is excluded ("identifier"). **Untick `units_bought`** (spend is worked out from units, which would flatter the score). Tick the confirmation, **Train local models** ([step 2](predictions-demo/1-number-step2-leakage-check.png)).
3. Results ([step 3](predictions-demo/1-number-step3-results.png)). Final test on 730 unseen customers: average miss **1,795.86**, typical large miss **9,557.81**, **R² 0.2725**. Read "What each number means": *"the model accounts for about 27% of the ups and downs in total_spend; the other 73% is not explained by the columns used."* Honest summary: it beats "always guess the average" on the validation split (1,231.57 against 1,805.37), but spend is dominated by a few very large customers, so most of the variation stays unexplained.
4. **Predict with a saved model** (the form is under the results). Three predictions:

| You enter | Real value in the file | The model's estimate | Reading |
|---|---|---|---|
| Iceland, 7 invoices, 103 products, 365 days (customer 12347) | 4,310.00 | **6,599.85** | about 2,290 too high |
| Finland, 4 invoices, 22 products, 282 days (customer 12348) | 1,797.24 | **1,308.03** | about 489 too low |
| UK, 5 invoices, 60 products, 200 days (not a real customer) | none | **1,304.44** | an estimate for a customer who does not exist |

   Screens: [12347](predictions-demo/1-number-step4-prediction-real-12347.png), [12348](predictions-demo/1-number-step4-prediction-real-12348.png), [hypothetical](predictions-demo/1-number-step4-prediction-hypothetical.png). The page says: *"This is a calculated estimate for those values, not a number looked up in your file... On rows it had not seen, this model's average miss was about 1,795.86."*
   **This is the answer to "is it predicting the original value?": no.** For customer 12347 the model said 6,599.85 and the real value is 4,310.00.
   "Prediction units: not inferred" appears because no currency was confirmed for the target.

## Card 2: Predict a category (classification), 3 minutes
**Question:** will a new customer buy again, judged only from their first order?
1. Data `online-retail-first-orders.csv` → **Predict a category** → target **bought_again** (2,130 yes, 588 no) ([step 1](predictions-demo/2-category-step1-target.png)).
2. Features: country, first order units, products, value and month. (`customer_id` excluded.) Confirm, train ([step 2](predictions-demo/2-category-step2-leakage-check.png)).
3. Results ([step 3](predictions-demo/2-category-step3-results.png)). **This is the honest, interesting one.** On validation the model was right **69.8%** of the time, while *always answering "yes" would be right 79.2%*. The app says so: "not clearly better than that simple guess: these columns may not predict this well", and warns about **class imbalance** ("accuracy alone can conceal minority-class errors"). The model does beat the simple guess on **balanced score (0.61 against 0.44)** and **ranking quality (ROC AUC 0.68 against 0.5)**. Final test: accuracy 69.1%, balanced score 0.62.
   *Teaching point:* when one answer is far more common, accuracy is a trap; the balanced numbers matter. *Business reading:* a customer's first order tells you only a little about whether they return.
4. Predictions: 

| You enter | Real answer | Model's best guess | Reading |
|---|---|---|---|
| Iceland, 319 units, 31 products, 711.79, December (customer 12347) | yes | **yes, about 78%** | correct |
| UK, 74,215 units, 1 product, 77,183.60, January (customer 12346) | no | **yes, about 65%** | **wrong**: a single huge order that never repeated |
| UK, 300 units, 40 products, 500, March (not real) | none | **yes, about 53%** | close to a coin flip |

   Screens: [12347](predictions-demo/2-category-step4-prediction-real-12347.png), [12346](predictions-demo/2-category-step4-prediction-real-12346.png), [hypothetical](predictions-demo/2-category-step4-prediction-hypothetical.png). The page says the percentage "is the model's own estimate, not a promise". Use the wrong case on purpose.

## Card 3: Group similar records (clustering), 2 minutes
**Question:** what kinds of customer do we have? (No target.)
1. Customers file → **Group similar records** → Next → confirm → train ([step 3](predictions-demo/3-clustering-step3-results.png)).
2. **Number of groups: 3** (1,601 = 37%; 2,719 = 63%; 18 = under 1%). Silhouette **0.4718**: "how clearly the groups are separated... it does not say the groups are the right ones". The group table shows an average member: regular (avg spend about 3,276), occasional (about 620), and **18 very large accounts (about 110,054)**.
3. Predictions: a large account (UK, 60 invoices, 50,000 units, 600 products, 100,000 spend, 300 days) → **group 2** (18 records); a small customer (1 invoice, 100 units, spend 200) → **group 1** (2,719 records) ([big](predictions-demo/3-clustering-step4-prediction-big-account.png), [small](predictions-demo/3-clustering-step4-prediction-small-customer.png)). The page: "A group is a set of similar records found by the model... being in a group does not predict a value."

## Card 4: Find unusual records (anomaly detection), 2 minutes
**Question:** which customers look unlike the rest?
1. Customers file → **Find unusual records** → train ([step 3](predictions-demo/4-anomaly-step3-results.png)). **217 of 4,338 flagged (5.0%).** The page explains the share comes from the method's sensitivity setting, not from the data, so it is not a count of real problems.
2. Predictions: large account → **unusual** (score 0.2567); typical customer (4 invoices, 400 units, spend 700) → **not unusual** (score -0.162); extreme account (200 invoices, 280,000 spend) → **unusual** (score 0.282) ([screens](predictions-demo/)). Higher score means more unusual. The page: "It does not mean the record is wrong or fraudulent."

## Card 5: Forecast future values, 3 minutes
**Question:** what will daily revenue be over the next 7 days?
1. `online-retail-daily.csv` → **Forecast future values** → open *Profile-based suggestions* → **Use suggestion** for the forecast → Next ([step 1](predictions-demo/5-forecast-step1.png)).
2. With the default **Missing periods = Stop and explain gaps**, **Train stays disabled** because the file skips days (305 trading days over 374; no Saturday sales) ([screen](predictions-demo/5-forecast-step2-gap-policy-default.png)). Choose **Explicit zero revenue** (69 days filled with zero: the owner's assumption, stated on the page). Train.
3. Results ([step 3](predictions-demo/5-forecast-step3-results.png)): on the final 7-day stretch held back, average miss **39,153.6 per period**, **WAPE 51.8%** ("the misses came to about 52% of the real total"). Forecasts are single estimates with no range.
4. **Predict with saved model** gives the next 7 days, 2011-12-10 to 2011-12-16 ([screen](predictions-demo/5-forecast-step4-prediction.png)): 52,089.28; 34,457.79; 74,289.60; 71,536.95; 61,613.69; 85,706.22; 150,553.86.
   **Be ready for this:** 10 December 2011 is a Saturday, and the history has no Saturday sales, yet the model gives about 52,000 for it. That shows the forecast is rough (this model does not pick up the weekday pattern), consistent with the large error above. Say so openly: *the page reports the error, and it should be treated as a rough estimate.*

---

## If you are short of time
Cards 1 and 2. Card 1 teaches "estimate, not the original value". Card 2 teaches "accuracy can mislead".

## Questions to expect
- **Is it predicting the real value in the dataset?** No. It estimates for the values you enter. For customer 12347 it said 6,599.85; the real value is 4,310.00.
- **Why can it be wrong?** It learns average patterns, and some customers do not follow them (customer 12346). The page reports how wrong it was on unseen data.
- **Why is classification not better than the simple guess on accuracy?** Because 79% of customers bought again, "always yes" is right 79% of the time. The model's balanced score and ranking quality are better, but the honest conclusion is that a first order says little about returning.
- **Is the AI involved?** No. "0 LLM calls": scikit-learn models trained on this computer.
- **Can I trust the percentages?** They are the model's own estimates, not promises.

## What is saved in the app now (nothing to redo)
Five experiments (one per card), their saved models, and 12 saved predictions are in the project, so you can open each with **Earlier experiments → Inspect experiment**. If you retrain live, you create an extra experiment; that is harmless.
