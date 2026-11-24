import { describe, expect, it } from "vitest";
import { metricMeanings, predictionMeaning, selectionExplanation, CHART_READINGS, PREDICTION_HELP, chartInsights, confusionInsight, clusterInsight, forecastHelp } from "./automlMeaning";
import type { MLResult } from "../automlapi";
import type { MLExperiment } from "../automlapi";

const job = (task: string, test: Record<string, number | null>, extra: Record<string, unknown> = {}, training = test) =>
  ({
    task,
    configuration: { target: "total_spend", features: [], forecast: task === "forecasting" ? { measure: "revenue" } : null },
    result: { rows_used: 4338, leaderboard: [{ algorithm: "M", status: "completed", selected: true, test_metrics: test, training_metrics: training, validation_metrics: null }], split: {}, plots: {}, details: extra },
  }) as unknown as MLExperiment;
const by = (items: ReturnType<typeof metricMeanings>, key: string) => items.find((i) => i.key === key)!;

describe("plain meaning of each number", () => {
  it("explains regression numbers with the recorded values and the target name", () => {
    const m = metricMeanings(job("regression", { mae: 1795.86, mse: 91351702.04, rmse: 9557.81, r2: 0.2725 }));
    expect(by(m, "mae").meaning).toContain("misses the real total_spend by about 1,795.86");
    expect(by(m, "r2").meaning).toContain("about 27%");
    expect(by(m, "r2").meaning).toContain("73%");
    expect(by(m, "mse").meaning).toContain("squared units");
    expect(by(m, "rmse").meaning).toContain("more than twice the average miss");
  });
  it("does not claim large misses when RMSE is not above twice MAE", () => {
    const m = metricMeanings(job("regression", { mae: 10, rmse: 12, r2: 0.5 }));
    expect(by(m, "rmse").meaning).not.toContain("twice");
  });
  it("says plainly when R squared is negative or not defined", () => {
    expect(by(metricMeanings(job("regression", { mae: 3, r2: -0.4 })), "r2").meaning).toContain("worse than always guessing the average");
    expect(by(metricMeanings(job("regression", { mae: 3, r2: null })), "r2").meaning).toContain("Not defined");
  });
  it("explains classification numbers", () => {
    const m = metricMeanings(job("classification", { accuracy: 0.8, precision_macro: 0.7, recall_macro: 0.6, f1_macro: 0.65, roc_auc: 0.9 }));
    expect(by(m, "accuracy").meaning).toContain("about 80 were put in the right class");
    expect(by(m, "precision_macro").meaning).toContain("about 70%");
    expect(by(m, "recall_macro").meaning).toContain("about 60%");
    expect(by(m, "roc_auc").meaning).toContain("coin flip");
  });
  it("explains forecasting numbers using the measure name", () => {
    const m = metricMeanings(job("forecasting", { mae: 39153.6, rmse: 62268.96, wape: 0.5182 }));
    expect(by(m, "mae").meaning).toContain("real revenue by about 39,153.6 per period");
    expect(by(m, "wape").value).toBe("51.8%");
    expect(by(m, "wape").meaning).toContain("about 52% of the real total");
  });
  it("describes clustering with group sizes and says silhouette does not prove the groups are right", () => {
    const m = metricMeanings(job("clustering", { silhouette: 0.4718 }, { cluster_profiles: [{ cluster: 0, count: 1601, features: {} }, { cluster: 1, count: 2719, features: {} }, { cluster: 2, count: 18, features: {} }] }));
    expect(by(m, "silhouette").meaning).toContain("does not say the groups are the right ones");
    expect(by(m, "groups").meaning).toContain("1,601 (37%)");
    expect(by(m, "groups").meaning).toContain("18 (under 1%)");
    expect(by(m, "groups").label).toBe("Number of groups");
  });
  it("says the flagged share is a setting and unusual is not fraud", () => {
    const m = metricMeanings(job("anomaly", { flagged_count: 217, flagged_fraction: 0.05 }));
    expect(by(m, "flagged_count").meaning).toContain("217 of 4,338");
    expect(by(m, "flagged_fraction").meaning).toContain("sensitivity setting");
    expect(by(m, "flagged_fraction").meaning).toContain("not the same as an error or fraud");
  });
  it("never makes a quality judgement and returns nothing without recorded metrics", () => {
    const all = [
      ...metricMeanings(job("regression", { mae: 1, mse: 1, rmse: 5, r2: 0.2 })),
      ...metricMeanings(job("classification", { accuracy: 0.5, f1_macro: 0.4 })),
    ].map((i) => i.meaning).join(" ");
    expect(all).not.toMatch(/\b(good|poor|excellent|bad|weak|strong|reliable)\b/i);
    expect(metricMeanings({ task: "regression", configuration: {}, result: null } as unknown as MLExperiment)).toEqual([]);
    expect(metricMeanings(job("regression", {}, {}, {}))).toEqual([]);
  });
});

describe("plain meaning of a prediction", () => {
  const feats = { country: "United Kingdom", invoices: 5, different_products: 60 };
  it("says a regression value is an estimate, not a lookup, and quotes the recorded held-out miss", () => {
    const t = predictionMeaning({ task: "regression", target: "total_spend", rows: [{ features: feats, prediction: 1304.44 }], rowCount: 1, heldOutMae: 1795.86 }).join(" ");
    expect(t).toContain("country = United Kingdom, invoices = 5, different_products = 60");
    expect(t).toContain("estimates total_spend at about 1,304.44");
    expect(t).toContain("not a number looked up in your file");
    expect(t).toContain("average miss was about 1,795.86");
    expect(t).not.toContain("each of the");
  });
  it("makes no claim about error when none was recorded", () => {
    const t = predictionMeaning({ task: "regression", target: "total_spend", rows: [{ features: feats, prediction: 10 }], rowCount: 1 }).join(" ");
    expect(t).not.toContain("average miss");
  });
  it("mentions the row count for several rows and warns that a chosen file was part of training", () => {
    const t = predictionMeaning({ task: "regression", target: "y", rows: [{ features: {}, prediction: 1 }], rowCount: 40, batch: true }).join(" ");
    expect(t).toContain("each of the 40 rows");
    expect(t).toContain("not a fair test of accuracy");
  });
  it("reads a classification with its estimated chance", () => {
    const t = predictionMeaning({ task: "classification", rows: [{ features: feats, prediction: "yes", probabilities: { yes: 0.72, no: 0.28 } }], rowCount: 1 }).join(" ");
    expect(t).toContain('best guess is "yes"');
    expect(t).toContain("about 72%");
    expect(t).toContain("not a promise");
  });
  it("reads a cluster, an anomaly flag and a forecast without inventing meaning", () => {
    const c = predictionMeaning({ task: "clustering", rows: [{ features: feats, cluster: 2, cluster_profile: { count: 18 } }], rowCount: 1 }).join(" ");
    expect(c).toContain("most resembles group 2");
    expect(c).toContain("18 records");
    expect(c).toContain("does not predict a value");
    const a = predictionMeaning({ task: "anomaly", rows: [{ features: feats, anomaly: true, anomaly_score: 0.21 }], rowCount: 1 }).join(" ");
    expect(a).toContain("marks this record as unusual");
    expect(a).toContain("does not mean the record is wrong or fraudulent");
    const f = predictionMeaning({ task: "forecasting", target: "revenue", rows: [{ date: "2011-12-10", prediction: 20000 }, { date: "2011-12-16", prediction: 30000 }], rowCount: 7, heldOutMae: 39153.6 }).join(" ");
    expect(f).toContain("7 future periods");
    expect(f).toContain("from 2011-12-10");
    expect(f).toContain("no range around it");
    expect(f).toContain("39,153.6 per period");
  });
  it("returns nothing without rows", () => {
    expect(predictionMeaning({ task: "regression", rows: [], rowCount: 0 })).toEqual([]);
  });
});

describe("why this model was chosen", () => {
  const c = (algorithm: string, v: Record<string, number>, selected = false) => ({ algorithm, status: "completed", selected, validation_metrics: v, test_metrics: null, training_metrics: null });
  const exp = (task: string, metric: string, board: ReturnType<typeof c>[]) => ({ task, configuration: {}, result: { selection_metric: metric, leaderboard: board, details: {}, rows_used: 1, split: {}, plots: {} } }) as unknown as MLExperiment;
  it("ranks regression models by lowest validation RMSE, names the baseline and says all models are saved", () => {
    const t = selectionExplanation(exp("regression", "rmse", [c("DummyRegressor", { rmse: 4151.57 }), c("HistGradientBoostingRegressor", { rmse: 3673.44 }, true), c("Ridge", { rmse: 4000 })])).join(" ");
    expect(t).toContain("trained 3 models");
    expect(t).toContain("lower is better");
    expect(t.indexOf("HistGradientBoostingRegressor 3,673.44")).toBeLessThan(t.indexOf("Ridge 4,000"));
    expect(t).toContain("validation rows, which none of the models were trained on");
    expect(t).toContain("tested once");
    expect(t).toContain("DummyRegressor is a deliberately simple guess");
    expect(t).toContain("All 3 models that trained are saved");
  });
  it("ranks classifiers by highest balanced score", () => {
    const t = selectionExplanation(exp("classification", "f1_macro", [c("DummyClassifier", { f1_macro: 0.44 }), c("RandomForestClassifier", { f1_macro: 0.61 }, true)])).join(" ");
    expect(t).toContain("higher is better");
    expect(t.indexOf("RandomForestClassifier 0.61")).toBeLessThan(t.indexOf("DummyClassifier 0.44"));
  });
  it("says so when the simple guess won, and uses backtests for forecasts", () => {
    const t = selectionExplanation(exp("forecasting", "rmse", [c("Naive", { rmse: 10 }, true), c("LagRidge", { rmse: 12 })])).join(" ");
    expect(t).toContain("none of the real models beat the simple guess");
    expect(t).toContain("backtests");
  });
  it("says no models were compared for clustering and anomaly detection", () => {
    expect(selectionExplanation(exp("clustering", "Configured algorithm", [c("KMeans", {}, true)])).join(" ")).toContain("No models were compared");
    expect(selectionExplanation(exp("anomaly", "Configured algorithm", [c("IsolationForest", {}, true)])).join(" ")).toContain("setting of the method");
  });
  it("returns nothing without a result", () => {
    expect(selectionExplanation({ task: "regression", result: null } as unknown as MLExperiment)).toEqual([]);
  });
});

describe("chart readings and form help", () => {
  it("covers every chart, makes no quality judgement and does not describe a line the chart does not draw", () => {
    const all = Object.values(CHART_READINGS).join(" ") + PREDICTION_HELP.map((h) => h.text).join(" ");
    expect(Object.keys(CHART_READINGS)).toHaveLength(8);
    expect(all).not.toMatch(/\b(good|poor|excellent|bad|reliable|accurate model)\b/i);
    expect(CHART_READINGS.actualVsPredicted).not.toMatch(/diagonal|drawn line/i);
    expect(CHART_READINGS.residuals).toContain("zero line");
    expect(CHART_READINGS.importance).toContain("not necessarily the cause");
  });
  it("explains all three prediction options, including that a single record is not a lookup", () => {
    expect(PREDICTION_HELP.map((h) => h.term)).toEqual(["Saved model", "Single record", "Existing registered dataset"]);
    expect(PREDICTION_HELP[1].text).toContain("does not look anything up");
    expect(PREDICTION_HELP[2].text).toContain("not a fair test of accuracy");
  });
});

describe("result-specific chart readings", () => {
  const res = (plots: Record<string, unknown>, details: Record<string, unknown> = {}, importance: unknown[] = []) => ({ plots, details, feature_importance: { values: importance } }) as unknown as MLResult;
  const reg = (rows: [number, number][]) => rows.map(([actual, predicted], i) => ({ row_index: i, actual, predicted, residual: actual - predicted }));

  it("describes regression dots from their own numbers and states the threshold it used", () => {
    const pts = reg([[100, 110], [200, 190], [300, 310], [400, 390], [500, 520], [9000, 60000]]);
    const i = chartInsights(res({ regression: pts }));
    expect(i.actualVsPredicted).toContain("6 unseen rows are plotted");
    expect(i.actualVsPredicted).toContain("more than 5 times the typical miss");
    expect(i.actualVsPredicted).toContain("real 9,000, estimate 60,000");
    expect(i.residuals).toContain("higher than the real value for 4 rows and lower for 2 rows");
    expect(i.residuals).toContain("The largest overestimate was 51,000");
  });
  it("changes when the data changes (no fixed text)", () => {
    const calm = chartInsights(res({ regression: reg([[100, 101], [200, 199], [300, 302]]) }));
    const wild = chartInsights(res({ regression: reg([[100, 101], [200, 199], [300, 9000]]) }));
    expect(calm.actualVsPredicted).not.toEqual(wild.actualVsPredicted);
    expect(calm.actualVsPredicted).toContain("typical miss is about 1 (the median)");
  });
  it("describes class counts, groups, anomaly scores, forecast, final window and importance", () => {
    const i = chartInsights(res({
      classification: [{ class: "yes", actual: 411, predicted: 300 }, { class: "no", actual: 133, predicted: 244 }],
      clusters: [{ x: 0, y: 0, cluster: 0, entity: "a" }, { x: 1, y: 1, cluster: 0, entity: "b" }, { x: 2, y: 2, cluster: 1, entity: "c" }],
      anomaly_distribution: [{ lower: -0.3, upper: -0.1, count: 90, flagged: 0 }, { lower: 0.1, upper: 0.3, count: 10, flagged: 8 }],
      forecast: [{ date: "2011-12-08", actual: 100, forecast: null }, { date: "2011-12-09", actual: 200, forecast: null }, { date: "2011-12-10", actual: null, forecast: 50 }, { date: "2011-12-11", actual: null, forecast: 150 }],
      backtest: [{ date: "d1", actual: 10, predicted: 12 }, { date: "d2", actual: 20, predicted: 40 }],
    }, { pca_explained_variance: [0.6, 0.25], missing_periods: ["x", "y"] }, [{ feature: "units", importance: 0.6 }, { feature: "country", importance: 0.3 }, { feature: "month", importance: 0.1 }]));
    expect(i.classCounts).toContain("yes: 411 rows really belong to it and the model put 300 there (fewer than");
    expect(i.classCounts).toContain("no: 133 rows really belong to it and the model put 244 there (more than");
    expect(i.clusters).toContain("group 0: 2; group 1: 1");
    expect(i.clusters).toContain("about 85%");
    expect(i.anomalyScores).toContain("8 of 100 records (8.0%) were flagged");
    expect(i.anomalyScores).toContain("start at scores of about 0.1");
    expect(i.forecast).toContain("2 periods from 2011-12-08 to 2011-12-09");
    expect(i.forecast).toContain("2 of which were filled in");
    expect(i.forecast).toContain("highest value on 2011-12-11 (150)");
    expect(i.forecast).toContain("The average of the last 2 real periods was 150 and the average forecast is 100");
    expect(i.finalWindow).toContain("real total was 30 and the forecast total was 52");
    expect(i.finalWindow).toContain("largest miss was on d2");
    expect(i.importance).toContain("units counts most (60%");
    expect(i.importance).toContain("together make up 100%");
  });
  it("says nothing for charts it has no data for", () => {
    expect(chartInsights(res({}))).toEqual({});
    expect(chartInsights(null)).toEqual({});
  });
  it("reads the wrong-class table per class from the stored matrix", () => {
    const lines = confusionInsight(res({}, { labels: ["no", "yes"], confusion_matrix: [[60, 73], [120, 291]] }));
    expect(lines[0]).toBe('Of 133 rows really "no", 60 (45%) were put in the right class; 73 went to "yes".');
    expect(lines[1]).toContain('Of 411 rows really "yes", 291 (71%)');
  });
  it("says what stands out in each group, with the ratio against all records", () => {
    const lines = clusterInsight(res({}, { cluster_profiles: [
      { cluster: 0, count: 1601, features: { country: "UK", total_spend: 3276.33, invoices: 7.77 } },
      { cluster: 1, count: 2719, features: { country: "UK", total_spend: 619.73, invoices: 1.8 } },
      { cluster: 2, count: 18, features: { country: "UK", total_spend: 110053.72, invoices: 67.39 } },
    ] }));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("Group 2 (18 records, under 1%) stands out most on total spend: 110,053.72 on average");
    expect(lines[2]).toMatch(/times as much/);
  });
  it("never uses a judgement word", () => {
    const all = Object.values(chartInsights(res({ regression: reg([[1, 5], [2, 2], [3, 9], [4, 4], [900, 5]]) }))).join(" ");
    expect(all).not.toMatch(/\b(good|poor|excellent|bad|reliable|great|terrible)\b/i);
  });
});

describe("readings stay readable and cover forecasts", () => {
  const r = (details: Record<string, unknown>, importance: unknown[] = []) => ({ plots: {}, details, feature_importance: { values: importance } }) as unknown as MLResult;
  it("hides internal column prefixes in the importance sentence", () => {
    const t = chartInsights(r({}, [{ feature: "numeric__first_order_value", importance: 0.5 }, { feature: "categorical__country_Germany", importance: 0.5 }])).importance!;
    expect(t).toContain("first_order_value counts most");
    expect(t).toContain("country_Germany");
    expect(t).not.toContain("numeric__");
    expect(t).not.toContain("categorical__");
  });
  it("says a smaller group is a percentage of the average, not 'times less'", () => {
    const lines = clusterInsight(r({ cluster_profiles: [{ cluster: 0, count: 10, features: { spend: 100 } }, { cluster: 1, count: 90, features: { spend: 5 } }] }));
    expect(lines[1]).toContain("(about 34% of that average).");
    expect(lines.join(" ")).not.toContain("times less");
  });
  it("explains the forecast button with the saved horizon", () => {
    const h = forecastHelp(7, "day");
    expect(h.map((x) => x.term)).toEqual(["Saved model", "Predict with saved model"]);
    expect(h[1].text).toContain("next 7 days after the last date in your data");
    expect(h[1].text).toContain("no range around them");
    expect(forecastHelp(null, null)[1].text).toContain("next periods");
  });
});
