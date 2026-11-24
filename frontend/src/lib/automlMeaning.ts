import type { MLExperiment, MLResult } from "../automlapi";
import { formatDisplayNumber } from "./displayNumber";
import { formatNumber } from "./formatters";
import { metricTitle } from "./automlPresentation";

/**
 * Plain-language meaning of each number shown under a model's results (display only).
 * Every sentence is a fixed definition filled with the recorded value. No judgements such as "good" or "poor" are made,
 * because no documented thresholds exist for them (Rule 4). Nothing here changes training, metrics or the registry.
 */
export interface MetricMeaning {
  key: string;
  label: string;
  value: string;
  meaning: string;
}

const pct = (v: number, decimals = 0) => formatNumber(v * 100, { decimals });

export function metricMeanings(job: MLExperiment): MetricMeaning[] {
  const result = job.result;
  if (!result) return [];
  const selected = result.leaderboard.find((c) => c.selected);
  const descriptive = job.task === "clustering" || job.task === "anomaly";
  const metrics = (descriptive ? selected?.training_metrics : selected?.test_metrics) || null;
  const out: MetricMeaning[] = [];
  const target = (job.task === "forecasting" ? job.configuration.forecast?.measure || job.configuration.target : job.configuration.target || job.configuration.forecast?.measure) || "the target";
  const add = (key: string, value: string, meaning: string, label = metricTitle(key)) => out.push({ key, label, value, meaning });
  const num = (key: string): number | null => {
    const v = metrics?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const bigMisses = (rmse: number) => {
    const mae = num("mae");
    return mae != null && mae > 0 && rmse > 2 * mae
      ? ` It is more than twice the average miss (${formatDisplayNumber(rmse)} against ${formatDisplayNumber(mae)}), so some misses are much larger than the typical one.`
      : "";
  };
  if (!metrics) return out;

  if (job.task === "regression") {
    const mae = num("mae"), mse = num("mse"), rmse = num("rmse");
    if (mae != null) add("mae", formatDisplayNumber(mae), `On average, a prediction misses the real ${target} by about ${formatDisplayNumber(mae)}. It uses the same units as ${target}. Lower is better.`);
    if (mse != null) add("mse", formatDisplayNumber(mse), "The average of the squared misses. Squaring makes big misses count much more and puts the number in squared units, so it is not directly readable. Use the average miss for everyday meaning.");
    if (rmse != null) add("rmse", formatDisplayNumber(rmse), `Like the average miss, but big misses weigh more. Typical large misses are about ${formatDisplayNumber(rmse)}.${bigMisses(rmse)}`);
    if ("r2" in metrics) {
      const r2 = num("r2");
      add("r2", r2 == null ? "Not measured" : formatDisplayNumber(r2),
        r2 == null ? "Not defined for these held-out rows, for example when every real value is the same."
          : r2 < 0 ? "Below zero: on these held-out rows the model did worse than always guessing the average."
            : `The model accounts for about ${pct(r2)}% of the ups and downs in ${target}; the other ${pct(1 - r2)}% is not explained by the columns used. 100% would be perfect and 0% is no better than always guessing the average.`);
    }
  } else if (job.task === "classification") {
    const accuracy = num("accuracy"), precision = num("precision_macro"), recall = num("recall_macro"), f1 = num("f1_macro"), auc = num("roc_auc");
    if (accuracy != null) add("accuracy", pct(accuracy, 1) + "%", `Out of every 100 rows, about ${pct(accuracy)} were put in the right class. If one class is much more common than the others, a high share can hide mistakes on the smaller ones.`);
    if (precision != null) add("precision_macro", formatDisplayNumber(precision), `When the model names a class, it is right about ${pct(precision)}% of the time, averaged equally over the classes.`);
    if (recall != null) add("recall_macro", formatDisplayNumber(recall), `Of the rows that really belong to a class, the model finds about ${pct(recall)}%, averaged equally over the classes.`);
    if (f1 != null) add("f1_macro", formatDisplayNumber(f1), "One balanced score from 0 to 1 that combines the two numbers above, treating each class equally. 1 is perfect.");
    if (auc != null) add("roc_auc", formatDisplayNumber(auc), "How well the model ranks rows of one class above rows of another, from 0 to 1. 0.5 is no better than a coin flip and 1 is a perfect ranking.");
  } else if (job.task === "forecasting") {
    const mae = num("mae"), rmse = num("rmse"), wape = num("wape");
    if (mae != null) add("mae", formatDisplayNumber(mae), `On the final stretch that was held back, the forecast missed the real ${target} by about ${formatDisplayNumber(mae)} per period on average. It uses the same units as ${target}. Lower is better.`);
    if (rmse != null) add("rmse", formatDisplayNumber(rmse), `Like the average miss, but big misses weigh more. Typical large misses are about ${formatDisplayNumber(rmse)}.${bigMisses(rmse)}`);
    if (wape != null) add("wape", pct(wape, 1) + "%", `Add up all the misses and compare them with the real total over that stretch: the misses came to about ${pct(wape)}% of the real total. Lower is better.`);
  } else if (job.task === "clustering") {
    const sil = num("silhouette");
    if (sil != null) add("silhouette", formatDisplayNumber(sil), "How clearly the groups are separated, from -1 to 1. A higher number means records sit closer to their own group than to the others. It describes how the groups look; it does not say the groups are the right ones.");
    const profiles = result.details.cluster_profiles || [];
    const total = profiles.reduce((s, p) => s + p.count, 0);
    if (profiles.length && total > 0)
      add("groups", String(profiles.length), `The records fall into ${profiles.length} groups of ${profiles.map((p) => formatNumber(p.count) + " (" + (p.count / total * 100 < 1 ? "under 1" : pct(p.count / total)) + "%)").join(", ")}. The table below shows the average member of each group, so you can see what makes the groups different.`, "Number of groups");
  } else if (job.task === "anomaly") {
    const count = num("flagged_count"), fraction = num("flagged_fraction");
    if (count != null) add("flagged_count", formatNumber(count), `${formatNumber(count)} of ${formatNumber(result.rows_used)} records were marked as unusual compared with the rest.`);
    if (fraction != null) add("flagged_fraction", pct(fraction, 1) + "%", "This share comes from the method's sensitivity setting, not from the data, so it does not tell you how many records are truly wrong. Look at the highest-scoring rows. Unusual is not the same as an error or fraud.");
  }
  return out;
}

/**
 * Plain-language reading of a prediction the owner has just made (display only).
 * It states what the output is (an estimate for the values given, not a value looked up in the file) and, where recorded,
 * how far off the model was on rows it had not seen. No intervals or promises are invented.
 */
export interface PredictionMeaningInput {
  task: string;
  target?: string | null;
  rows: Record<string, unknown>[];
  rowCount: number;
  heldOutMae?: number | null;
  batch?: boolean;
}
const show = (v: unknown) => (typeof v === "number" ? formatDisplayNumber(v) : v == null ? "empty" : String(v));
const inputs = (features: unknown) => {
  const entries = Object.entries((features && typeof features === "object" ? features : {}) as Record<string, unknown>);
  return entries.map(([k, v]) => `${k} = ${show(v)}`).join(", ");
};
export function predictionMeaning(input: PredictionMeaningInput): string[] {
  const { task, rows, rowCount, heldOutMae } = input;
  const target = input.target || "the target";
  if (!rows.length) return [];
  const first = rows[0];
  const lines: string[] = [];
  const many = rowCount > 1 ? ` The same reading applies to each of the ${formatNumber(rowCount)} rows.` : "";
  const miss = heldOutMae != null && Number.isFinite(heldOutMae)
    ? ` On rows it had not seen, this model's average miss was about ${formatDisplayNumber(heldOutMae)}, so the real figure can differ from the estimate by roughly that much.`
    : "";
  if (task === "regression" && typeof first.prediction === "number") {
    lines.push(`For ${inputs(first.features) || "the values you entered"}, the model estimates ${target} at about ${formatDisplayNumber(first.prediction)}.`);
    lines.push(`This is a calculated estimate for those values, not a number looked up in your file. Even if you enter the exact values of a customer that is already in your data, the answer will usually differ from that customer's real ${target}.${miss}${many}`);
  } else if (task === "classification") {
    const probs = first.probabilities && typeof first.probabilities === "object" ? (first.probabilities as Record<string, number>) : null;
    const best = String(first.prediction);
    const p = probs && typeof probs[best] === "number" ? probs[best] : null;
    lines.push(`For ${inputs(first.features) || "the values you entered"}, the model's best guess is "${best}"${p != null ? `, with an estimated chance of about ${formatNumber(p * 100, { decimals: 0 })}%` : ""}.`);
    lines.push(`This is the label the model finds most likely, not one read from your file, and the percentage is the model's own estimate, not a promise.${many}`);
  } else if (task === "clustering") {
    const profile = first.cluster_profile && typeof first.cluster_profile === "object" ? (first.cluster_profile as { count?: number }) : null;
    lines.push(`For ${inputs(first.features) || "the values you entered"}, the record most resembles group ${show(first.cluster)}${profile?.count != null ? `, a group of ${formatNumber(profile.count)} records in the data the model learned from` : ""}.`);
    lines.push(`A group is a set of similar records found by the model. It is not a label you supplied, and being in a group does not predict a value. See the group table in the results above for what an average member looks like.${many}`);
  } else if (task === "anomaly") {
    const flagged = first.anomaly === true;
    lines.push(`For ${inputs(first.features) || "the values you entered"}, the model ${flagged ? "marks this record as unusual" : "does not mark this record as unusual"} (score ${show(first.anomaly_score)}; higher means more unusual).`);
    lines.push(`Unusual means this combination of values is rare compared with the data the model learned from. It does not mean the record is wrong or fraudulent.${many}`);
  } else if (task === "forecasting") {
    const last = rows[rows.length - 1];
    lines.push(`These are the model's forecast values for ${formatNumber(rowCount)} future period${rowCount === 1 ? "" : "s"}: from ${show(first.date)} (${show(first.prediction)}) to ${show(last.date)} (${show(last.prediction)}).`);
    const fmiss = heldOutMae != null && Number.isFinite(heldOutMae) ? ` On the final stretch it was tested on, its average miss was about ${formatDisplayNumber(heldOutMae)} per period.` : "";
    lines.push(`A forecast is a single best estimate for each period, with no range around it, and it is not in your file.${fmiss}`);
  }
  if (input.batch) lines.push("These rows come from a whole file you chose. The model learned from this same file, so comparing them with the real values is not a fair test of accuracy; the held-out numbers above are.");
  return lines;
}

/**
 * Plain-language "how to read this chart" lines. Fixed definitions only: nothing here judges whether a result is good or poor
 * and nothing is computed from the data (Rule 4). Keys match the charts in AutoMLPlots.
 */
export const CHART_READINGS = {
  actualVsPredicted:
    "Each dot is one row the model had never seen. Across is the real value and up is the model's estimate for it. If every estimate were exactly right, all dots would sit on a straight line rising from bottom left to top right. The farther a dot is from that line, the bigger the miss for that row.",
  residuals:
    "Each dot is one unseen row. Across is the model's estimate; up or down is the miss, calculated as real value minus estimate. A dot on the zero line was exactly right. Dots above zero are rows where the real value was higher than the estimate, and dots below zero are rows where it was lower. Dots spread far from zero are the big misses.",
  classCounts:
    "For each class, one bar shows how many unseen rows really belong to it and the other shows how many the model put in it. Bars of similar height mean the model gave each class about the right number of rows. This does not show whether the individual rows were right; see the numbers above for that.",
  clusters:
    "Each dot is one record, coloured by the group the model put it in. The two axes are mixed-together directions of the data used only to draw the picture; they are not columns of your file. Dots of the same colour that sit close together are records the model sees as similar. Groups that overlap are less clearly separated.",
  anomalyScores:
    "Each bar counts how many records fall in a score range. Records further right have a higher score and look more unusual. The darker flagged part shows how many in that range were marked unusual. Most records sit on the left; the few on the right are the ones to look at first.",
  forecast:
    "The line on the left is what actually happened (days with no sales are shown as filled zeros if you chose that). The line on the right is the model's forecast for the coming periods. It is a single best estimate with no range around it, so treat it as a rough guide.",
  finalWindow:
    "This compares what really happened in the last stretch of time that was held back with what the model predicted using only the history before that stretch. The closer the two lines, the better the model did on that stretch. It is the honest test for a forecast.",
  importance:
    "Each bar shows how much the model relied on that input column when it made estimates. A longer bar means more reliance. This describes the model, not the real world: a column the model relies on is not necessarily the cause of the result.",
} as const;

/** What the options on the prediction form do, in plain words. */
export const PREDICTION_HELP: { term: string; text: string }[] = [
  { term: "Saved model", text: "Which saved model to use. The one marked \"selected on validation\" is the one the app picked as best; the other models that were trained were saved too and can be used." },
  { term: "Single record", text: "Type the values for one customer. It can be a customer that is already in your file or an imaginary one. The model does not look anything up: it calculates an estimate from the values you type." },
  { term: "Existing registered dataset", text: "A whole file already in this project. You get one estimate for every row in it (up to 5,000 rows). Your real values stay in your file and the estimates are a separate result you can export. If you pick the file the model learned from, the estimates are not a fair test of accuracy." },
];

const LOWER_IS_BETTER = new Set(["rmse", "mae", "mse", "wape"]);

/** Why the model on top was picked, which models were compared, and whether all of them are saved. Uses recorded numbers only. */
export function selectionExplanation(job: MLExperiment): string[] {
  const r = job.result;
  if (!r) return [];
  const done = r.leaderboard.filter((c) => c.status === "completed");
  if (!done.length) return [];
  if (job.task === "clustering" || job.task === "anomaly") {
    return [
      `No models were compared here. ${done[0].algorithm} is the fixed method used for this task, so there is no "best model" to pick. ${job.task === "clustering" ? "The number of groups is a setting, not something the model proved." : "The share flagged is a setting of the method."}`,
      "The model is saved on this computer and can be used under \"Saved model\" when you make a prediction.",
    ];
  }
  const key = r.selection_metric;
  const lower = LOWER_IS_BETTER.has(key);
  const value = (c: (typeof done)[number]) => c.validation_metrics?.[key];
  const ranked = done.filter((c) => typeof value(c) === "number").sort((a, b) => (lower ? value(a)! - value(b)! : value(b)! - value(a)!));
  if (!ranked.length) return [];
  const where = job.task === "forecasting" ? "two earlier stretches of time that were held back (backtests)" : "the validation rows, which none of the models were trained on";
  const out: string[] = [];
  out.push(`The app trained ${done.length} models on the same rows and compared them on ${where}, using ${metricTitle(key)} (${lower ? "lower" : "higher"} is better). Best first: ${ranked.map((c) => `${c.algorithm} ${formatDisplayNumber(value(c))}`).join("; ")}.`);
  const selected = done.find((c) => c.selected) || ranked[0];
  out.push(`The best of them, ${selected.algorithm}, was then tested once on ${job.task === "forecasting" ? "the final stretch of time" : "rows"} that took no part in choosing it (the final test above). Because those rows were never used to choose, the final test is an honest check.`);
  const baseline = done.find((c) => ["DummyRegressor", "DummyClassifier", "Naive"].includes(c.algorithm));
  if (baseline) out.push(`${baseline.algorithm} is a deliberately simple guess, included so you can see whether any real model beats doing nothing clever.${selected.algorithm === baseline.algorithm ? " It came out best, which means none of the real models beat the simple guess." : ""}`);
  out.push(`All ${done.length} models that trained are saved on this computer, not only the winner. You can pick any of them under "Saved model" when you make a prediction; the app recommends the one marked "selected on validation".`);
  return out;
}


/* ---- Result-specific readings: each sentence below is computed from the plotted data of this one result. ----
 * No judgement words. Any threshold used (for example "more than 5 times the typical miss") is written into the sentence. */
export type ChartKey = keyof typeof CHART_READINGS;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b), m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const plural = (n: number, one: string, many = one + "s") => `${formatNumber(n)} ${n === 1 ? one : many}`;
const label = (name: string) => name.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export function chartInsights(result: MLResult | null | undefined): Partial<Record<ChartKey, string>> {
  const out: Partial<Record<ChartKey, string>> = {};
  if (!result) return out;
  const p = result.plots || {};
  const reg = p.regression;
  if (reg?.length) {
    const miss = reg.map((r) => Math.abs(r.residual)), typical = median(miss);
    const high = reg.filter((r) => r.residual < 0), low = reg.filter((r) => r.residual > 0);
    const large = typical > 0 ? reg.filter((r) => Math.abs(r.residual) > 5 * typical).sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)) : [];
    out.actualVsPredicted = `In this result: ${plural(reg.length, "unseen row is", "unseen rows are")} plotted. The typical miss is about ${formatDisplayNumber(typical)} (the median). ` +
      (typical > 0
        ? large.length
          ? `${plural(large.length, "row")} missed by more than 5 times the typical miss (more than ${formatDisplayNumber(5 * typical)}). The largest: ${large.slice(0, 3).map((r) => `real ${formatDisplayNumber(r.actual)}, estimate ${formatDisplayNumber(r.predicted)}`).join("; ")}.`
          : "No row missed by more than 5 times the typical miss."
        : "");
    const mean = reg.reduce((s, r) => s + r.residual, 0) / reg.length;
    const worstHigh = high.length ? high.reduce((a, b) => (b.residual < a.residual ? b : a)) : null;
    const worstLow = low.length ? low.reduce((a, b) => (b.residual > a.residual ? b : a)) : null;
    out.residuals = `In this result: the estimate was higher than the real value for ${plural(high.length, "row")} and lower for ${plural(low.length, "row")}. Averaged over these rows, estimates were ${mean < 0 ? "higher" : "lower"} than the real values by ${formatDisplayNumber(Math.abs(mean))}.` +
      (worstHigh ? ` The largest overestimate was ${formatDisplayNumber(-worstHigh.residual)} (real ${formatDisplayNumber(worstHigh.actual)}, estimate ${formatDisplayNumber(worstHigh.predicted)}).` : "") +
      (worstLow ? ` The largest underestimate was ${formatDisplayNumber(worstLow.residual)} (real ${formatDisplayNumber(worstLow.actual)}, estimate ${formatDisplayNumber(worstLow.predicted)}).` : "");
  }
  if (p.classification?.length) {
    out.classCounts = "In this result: " + p.classification.map((c) => `${c.class}: ${formatNumber(c.actual)} rows really belong to it and the model put ${formatNumber(c.predicted)} there (${c.predicted > c.actual ? "more than" : c.predicted < c.actual ? "fewer than" : "the same as"} the real number)`).join("; ") + ".";
  }
  if (p.clusters?.length) {
    const counts = new Map<number, number>();
    p.clusters.forEach((pt) => counts.set(pt.cluster, (counts.get(pt.cluster) || 0) + 1));
    const variance = result.details?.pca_explained_variance;
    const kept = variance && variance.length >= 2 ? variance[0] + variance[1] : null;
    out.clusters = `In this result: ${plural(p.clusters.length, "point is", "points are")} drawn (the chart shows at most 500). ` + [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `group ${k}: ${formatNumber(n)}`).join("; ") + "." +
      (kept != null ? ` The two axes together keep about ${pct(kept)}% of the variation in the data, so the picture is a simplified view.` : "");
  }
  const bins = p.anomaly_distribution;
  if (bins?.length) {
    const total = bins.reduce((s, b) => s + b.count, 0), flagged = bins.reduce((s, b) => s + b.flagged, 0);
    const flaggedBins = bins.filter((b) => b.flagged > 0);
    const top = bins.filter((b) => b.count > 0).sort((a, b) => b.upper - a.upper)[0];
    out.anomalyScores = `In this result: ${formatNumber(flagged)} of ${formatNumber(total)} records (${total ? formatNumber(flagged / total * 100, { decimals: 1 }) : "0"}%) were flagged` +
      (flaggedBins.length ? `, and flagged records start at scores of about ${formatDisplayNumber(Math.min(...flaggedBins.map((b) => b.lower)))}` : "") + "." +
      (top ? ` The highest score range (${formatDisplayNumber(top.lower)} to ${formatDisplayNumber(top.upper)}) holds ${plural(top.count, "record")}, ${formatNumber(top.flagged)} of them flagged.` : "");
  }
  const fc = p.forecast;
  if (fc?.length) {
    const hist = fc.filter((r) => r.actual != null), fut = fc.filter((r) => r.forecast != null);
    if (hist.length && fut.length) {
      const peak = fut.reduce((a, b) => (b.forecast! > a.forecast! ? b : a));
      const k = Math.min(fut.length, hist.length);
      const recent = hist.slice(-k).reduce((s, r) => s + r.actual!, 0) / k, ahead = fut.reduce((s, r) => s + r.forecast!, 0) / fut.length;
      const filled = result.details?.missing_periods?.length || 0;
      out.forecast = `In this result: the history covers ${plural(hist.length, "period")} from ${hist[0].date} to ${hist[hist.length - 1].date}${filled ? `, ${formatNumber(filled)} of which were filled in by your missing-period policy` : ""}. The forecast covers ${plural(fut.length, "period")} from ${fut[0].date} (${formatDisplayNumber(fut[0].forecast)}) to ${fut[fut.length - 1].date} (${formatDisplayNumber(fut[fut.length - 1].forecast)}), with its highest value on ${peak.date} (${formatDisplayNumber(peak.forecast)}). The average of the last ${plural(k, "real period")} was ${formatDisplayNumber(recent)} and the average forecast is ${formatDisplayNumber(ahead)}.`;
    }
  }
  const bt = p.backtest;
  if (bt?.length) {
    const real = bt.reduce((s, r) => s + r.actual, 0), predicted = bt.reduce((s, r) => s + r.predicted, 0);
    const worst = bt.reduce((a, b) => (Math.abs(b.actual - b.predicted) > Math.abs(a.actual - a.predicted) ? b : a));
    out.finalWindow = `In this result: over the final ${plural(bt.length, "period")} (${bt[0].date} to ${bt[bt.length - 1].date}) the real total was ${formatDisplayNumber(real)} and the forecast total was ${formatDisplayNumber(predicted)}. The largest miss was on ${worst.date}: real ${formatDisplayNumber(worst.actual)}, forecast ${formatDisplayNumber(worst.predicted)}.`;
  }
  const imp = result.feature_importance?.values;
  if (imp?.length) {
    const rows = imp.filter((v) => Number.isFinite(v.importance) && v.importance > 0).sort((a, b) => b.importance - a.importance);
    const sum = rows.reduce((s, v) => s + v.importance, 0);
    if (rows.length && sum > 0) {
      const share = (v: number) => pct(v / sum);
      const clean = (f: string) => f.replace(/^(numeric|categorical|datetime)__/, "");
      const top = rows.slice(0, 3);
      out.importance = `In this result: ${clean(top[0].feature)} counts most (${share(top[0].importance)}% of the importance shown)` + (top.length > 1 ? `, then ${top.slice(1).map((v) => `${clean(v.feature)} (${share(v.importance)}%)`).join(" and ")}` : "") + `; the top ${top.length} together make up ${pct(top.reduce((s, v) => s + v.importance, 0) / sum)}% of what is shown.`;
    }
  }
  return out;
}

/** One sentence per class about the "where it was wrong" table, from the stored confusion matrix. */
export function confusionInsight(result: MLResult | null | undefined): string[] {
  const m = result?.details?.confusion_matrix, labels = result?.details?.labels;
  if (!m?.length || !labels?.length) return [];
  return m.map((row, i) => {
    const total = row.reduce((s, v) => s + v, 0);
    if (!total) return `Of 0 rows really "${labels[i]}", none were in the held-out rows.`;
    const wrong = row.map((v, j) => ({ v, j })).filter((x) => x.j !== i).sort((a, b) => b.v - a.v)[0];
    return `Of ${formatNumber(total)} rows really "${labels[i]}", ${formatNumber(row[i])} (${pct(row[i] / total)}%) were put in the right class` + (wrong && wrong.v > 0 ? `; ${formatNumber(wrong.v)} went to "${labels[wrong.j]}".` : ".");
  });
}

/** What stands out in each group, from the stored group averages: the numeric column whose group average is furthest from the average of all records. */
export function clusterInsight(result: MLResult | null | undefined): string[] {
  const profiles = result?.details?.cluster_profiles;
  if (!profiles?.length) return [];
  const total = profiles.reduce((s, c) => s + c.count, 0);
  if (total <= 0) return [];
  const names = Object.keys(profiles[0].features).filter((k) => profiles.every((c) => typeof c.features[k] === "number"));
  const overall = Object.fromEntries(names.map((k) => [k, profiles.reduce((s, c) => s + (c.features[k] as number) * c.count, 0) / total]));
  return profiles.map((c) => {
    const share = c.count / total * 100 < 1 ? "under 1" : pct(c.count / total);
    const ranked = names.filter((k) => overall[k] > 0).map((k) => ({ k, ratio: (c.features[k] as number) / overall[k] })).sort((a, b) => Math.abs(Math.log(b.ratio || 1e-9)) - Math.abs(Math.log(a.ratio || 1e-9)));
    const top = ranked[0];
    const base = `Group ${c.cluster} (${formatNumber(c.count)} records, ${share}%)`;
    if (!top || Math.abs(top.ratio - 1) < 0.1) return `${base} is close to the average of all records on every number column.`;
    return `${base} stands out most on ${label(top.k).toLowerCase()}: ${formatDisplayNumber(c.features[top.k])} on average, against ${formatDisplayNumber(overall[top.k])} for all records` + (top.ratio >= 2 ? ` (about ${formatNumber(top.ratio, { decimals: top.ratio >= 10 ? 0 : 1 })} times as much).` : top.ratio <= 0.5 ? ` (about ${pct(top.ratio)}% of that average).` : ".");
  });
}

/** The prediction options for a forecast model (it has no input boxes). */
export function forecastHelp(horizon?: number | null, frequency?: string | null): { term: string; text: string }[] {
  const unit = frequency ? frequency + "s" : "periods";
  return [
    { term: "Saved model", text: "Which saved forecasting model to use. The one marked \"selected on validation backtest\" is the one the app picked as best; the other models that were trained were saved too." },
    { term: "Predict with saved model", text: `There are no boxes to fill in. The button forecasts the next ${horizon ? formatNumber(horizon) + " " : ""}${unit} after the last date in your data, using the model refitted on the full history. The numbers are estimates for dates that are not in your file, with no range around them.` },
  ];
}
