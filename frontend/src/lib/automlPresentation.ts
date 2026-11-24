import { formatDisplayNumber } from "./displayNumber";
import type {
  MLProfile,
  MLTask,
  MLExperiment,
  MLCandidate,
} from "../automlapi";
import { formatNumber } from "./formatters";
export const mlTasks: {id: MLTask; name: string; technical: string; description: string}[] = [
  {id: "regression", name: "Predict a number", technical: "Regression", description: "Estimate a numeric target from other columns."},
  {id: "classification", name: "Predict a category", technical: "Classification", description: "Assign one of the observed target labels."},
  {id: "clustering", name: "Group similar records", technical: "Clustering", description: "Explore groups with similar feature values."},
  {id: "anomaly", name: "Find unusual records", technical: "Anomaly detection", description: "Score unusual combinations of numeric features."},
  {id: "forecasting", name: "Forecast future values", technical: "Forecasting", description: "Predict a measure across future time periods."},
];
export function mlTaskLabel(task: MLTask) {
  const item = mlTasks.find(t => t.id === task);
  return item ? `${item.name} (${item.technical})` : task;
}
export function splitPolicy(task: MLTask) {
  return task === "regression" || task === "classification"
    ? "One fixed grouped 60/20/20 train/validation/test split; duplicate feature groups stay together. The final test is held out during model selection. No adjustable split or CV folds."
    : task === "forecasting"
      ? "Chronological backtests select the model; the final horizon is held out for evaluation. The saved forecast model is then refitted on the full history."
      : "Descriptive fit on the recorded usable data; there is no held-out prediction-accuracy score.";
}
export const mlSteps = [
  "What do you want to predict?",
  "Check and train",
  "Results and predict",
];
export function taskSupport(profile: MLProfile | null, task: MLTask) {
  if (!profile) return "Wait for the dataset profile.";
  const minimum =
    task === "regression" || task === "classification"
      ? 60
      : task === "anomaly"
        ? 20
        : 12;
  if (profile.total_rows > 5000) return "Training is limited to 5,000 rows.";
  if (profile.sampled_rows < minimum)
    return `Too few rows to train (minimum ${minimum}).`;
  const columns = profile.columns.filter(
    (c) => !c.constant && !c.potential_identifier,
  );
  if (task === "regression" && !columns.some((c) => c.kind === "numeric"))
    return "No nonconstant numeric target found.";
  if (
    task === "classification" &&
    !columns.some((c) => c.cardinality >= 2 && c.cardinality <= 20)
  )
    return "No target with 2–20 observed classes found.";
  if (task === "forecasting" && !columns.some((c) => c.kind === "datetime"))
    return "No date column found.";
  if (task === "forecasting" && !columns.some((c) => c.kind === "numeric"))
    return "No numeric measure found.";
  if (
    task === "anomaly" &&
    !columns.some((c) => c.kind === "numeric" && !c.potential_leakage)
  )
    return "No eligible numeric feature found.";
  if (task === "clustering" && !columns.length)
    return "No nonconstant non-identifier features found.";
  return "";
}
export function taskSuggestions(profile: MLProfile | null) {
  if (!profile) return [];
  const columns = profile.columns.filter(
    (c) => !c.constant && !c.potential_identifier,
  );
  const numeric = columns
    .filter((c) => c.kind === "numeric")
    .sort((a, b) => b.cardinality - a.cardinality);
  const categorical = columns
    .filter((c) => c.cardinality >= 2 && c.cardinality <= 20)
    .sort(
      (a, b) =>
        Number(b.kind === "categorical") - Number(a.kind === "categorical") ||
        a.cardinality - b.cardinality,
    );
  const date = columns.find((c) => c.kind === "datetime");
  const options: {
    task: MLTask;
    target?: string;
    date?: string;
    reason: string;
  }[] = [];
  if (numeric[0] && !taskSupport(profile, "regression"))
    options.push({
      task: "regression",
      target: numeric[0].name,
      reason: `${numeric[0].name} is numeric with ${formatNumber(numeric[0].cardinality)} distinct values.`,
    });
  if (categorical[0] && !taskSupport(profile, "classification"))
    options.push({
      task: "classification",
      target: categorical[0].name,
      reason: `${categorical[0].name} has ${formatNumber(categorical[0].cardinality)} observed classes; class balance must still pass validation.`,
    });
  if (date && numeric[0] && !taskSupport(profile, "forecasting"))
    options.push({
      task: "forecasting",
      target: numeric[0].name,
      date: date.name,
      reason: `${date.name} contains dates and ${numeric[0].name} is numeric. Period coverage still needs checking.`,
    });
  if (!taskSupport(profile, "clustering"))
    options.push({
      task: "clustering",
      reason: `${columns.length} nonconstant, non-identifier columns are available for descriptive grouping.`,
    });
  if (!taskSupport(profile, "anomaly"))
    options.push({
      task: "anomaly",
      reason: `${columns.filter((c) => c.kind === "numeric" && !c.potential_leakage).length} eligible numeric columns are available; anomaly scores are not labels.`,
    });
  return options;
}
export function resultNarrative(job: MLExperiment) {
  const result = job.result;
  if (!result) return "Results not recorded.";
  const selected = result.leaderboard.find((c) => c.selected),
    m = selected?.test_metrics;
  const value = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n)
      ? formatDisplayNumber(n)
      : "Not measured";
  if (job.task === "regression") {
    if (m?.mae == null) return "Held-out prediction error not recorded.";
    return (
      `On held-out data, predictions were off by about ${value(m.mae)} on average (MAE; R² = ${value(m.r2)}).` +
      (m.r2 != null && m.r2 < 0
        ? " Negative held-out R²: worse than predicting the held-out average, the reference used by R²."
        : "")
    );
  }
  if (job.task === "classification")
    return m
      ? `On held-out data, Macro F1 = ${value(m.f1_macro)}; accuracy was ${m.accuracy == null ? "Not measured" : formatNumber(m.accuracy * 100, { decimals: 1 }) + "%"}. Macro F1 weights each class equally; accuracy can conceal errors in smaller classes.`
      : "Held-out classification metrics not recorded.";
  if (job.task === "forecasting")
    return m
      ? `On the final held-out window, MAE was ${value(m.mae)} and RMSE was ${value(m.rmse)}; WAPE was ${m.wape == null ? "Not measured (zero or unavailable actual total)" : formatNumber(m.wape * 100, { decimals: 1 }) + "%"} over ${job.configuration.forecast?.horizon ?? "the recorded"} periods. Forecasts are point estimates, without intervals.`
      : "Held-out forecast error not recorded.";
  if (job.task === "clustering")
    return `The fitted-data grouping contains ${result.details.cluster_profiles?.length ?? "an unrecorded number of"} clusters across ${formatNumber(result.rows_used)} rows or entities. This is descriptive, not held-out prediction accuracy.`;
  const descriptive = selected?.training_metrics;
  return `${value(descriptive?.flagged_count)} of ${formatNumber(result.rows_used)} fitted rows were flagged. ${result.details.score_definition || "The saved model determines the score threshold."} No fraud accuracy is measured.`;
}
export function baselineComparison(
  job: MLExperiment,
): {
  scope: string;
  model: MLCandidate;
  baseline: MLCandidate;
  metrics: string[];
} | null {
  const result = job.result;
  if (!result) return null;
  const baselineName =
    job.task === "regression"
      ? "DummyRegressor"
      : job.task === "classification"
        ? "DummyClassifier"
        : job.task === "forecasting"
          ? "Naive"
          : null;
  const model = result.leaderboard.find((c) => c.selected),
    baseline = result.leaderboard.find(
      (c) => c.algorithm === baselineName && c.status === "completed",
    );
  if (!model?.validation_metrics || !baseline?.validation_metrics) return null;
  const metrics = Object.keys(baseline.validation_metrics).filter(
    (k) =>
      model.validation_metrics?.[k] != null &&
      baseline.validation_metrics?.[k] != null,
  );
  return metrics.length
    ? {
        scope:
          job.task === "forecasting"
            ? "Earlier chronological validation backtests"
            : "Validation split (not the final test)",
        model,
        baseline,
        metrics,
      }
    : null;
}

/** A held-out score at or above this is treated as "suspiciously high" (documented in the warning itself). */
export const LEAKAGE_SCORE_THRESHOLD = 0.98;

/** Plain-language names for the measured metrics (the stored keys are unchanged). */
export const METRIC_LABELS: Record<string, string> = {
  accuracy: "Accuracy (share right)",
  precision_macro: "Precision, averaged over classes",
  recall_macro: "Recall, averaged over classes",
  f1_macro: "Balanced score (Macro F1)",
  roc_auc: "Ranking quality (ROC AUC)",
  mae: "Average error (MAE)",
  rmse: "Typical large error (RMSE)",
  r2: "R² (1 is perfect, 0 is no better than the average)",
  wape: "Error as a share of the total (WAPE)",
};

/** Short titles for the metric cards under a model's final test; unknown keys fall back to the key in plain words. */
const CARD_LABELS: Record<string, string> = {
  accuracy: "Accuracy",
  precision_macro: "Precision (average over classes)",
  recall_macro: "Recall (average over classes)",
  f1_macro: "Balanced score (Macro F1)",
  roc_auc: "Ranking quality (ROC AUC)",
  mae: "Average error (MAE)",
  rmse: "Typical large error (RMSE)",
  r2: "R²",
  wape: "Error as a share of the total (WAPE)",
  flagged_fraction: "Share flagged",
};
export function metricTitle(key: string): string {
  return CARD_LABELS[key] ?? key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/** One sentence an owner can read: the best model against the simplest possible guess. Only recorded numbers. */
export function plainSummary(job: MLExperiment): string | null {
  const c = baselineComparison(job);
  if (!c) return null;
  const m = c.model.validation_metrics as Record<string, number | null>, b = c.baseline.validation_metrics as Record<string, number | null>;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  const pct = (n: number) => formatNumber(n * 100, { decimals: 1 }) + "%";
  if (job.task === "classification" && num(m.accuracy) != null && num(b.accuracy) != null) {
    const better = m.accuracy! > b.accuracy! + 0.01;
    return `On rows it had not seen while choosing models, the best model was right ${pct(m.accuracy!)} of the time. Always giving the most common answer would be right ${pct(b.accuracy!)}. ${better ? "So it is better than that simple guess." : "So it is not clearly better than that simple guess: these columns may not predict this well."}`;
  }
  const err = (job.task === "regression" || job.task === "forecasting") && num(m.mae) != null && num(b.mae) != null;
  if (err) {
    const better = m.mae! < b.mae! * 0.99;
    const guess = job.task === "forecasting" ? "repeating the last value" : "always guessing the average";
    return `On rows it had not seen while choosing models, the best model's predictions were off by about ${formatDisplayNumber(m.mae!)} on average. ${guess[0].toUpperCase() + guess.slice(1)} would be off by about ${formatDisplayNumber(b.mae!)}. ${better ? "So it is better than that simple guess." : "So it is not clearly better than that simple guess."}`;
  }
  return null;
}

/** Shown after training when the held-out score is suspiciously high. The threshold is stated in the message. */
export function leakageWarning(job: MLExperiment): string | null {
  const selected = job.result?.leaderboard.find((c) => c.selected);
  const m = (selected?.test_metrics || selected?.validation_metrics) as Record<string, number | null> | undefined;
  if (!m) return null;
  const high = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= LEAKAGE_SCORE_THRESHOLD;
  const hit = job.task === "regression" ? high(m.r2) : job.task === "classification" ? high(m.accuracy) || high(m.f1_macro) : false;
  return hit
    ? "This score is unusually high (0.98 or more, where 1 is perfect). That often means a column you used already contains the answer, for example one worked out from the thing you are predicting, or only known after the outcome. Check your columns before trusting these results."
    : null;
}

/** Plain wording for messages the training service writes (display only; the stored text is unchanged). */
export function plainTerms(text?: string | null): string {
  return (text || "").replace(/content fingerprint|source fingerprint|recorded fingerprint|fingerprint/gi, "saved data check").replace(/imputation/gi, "typical-value filling");
}
