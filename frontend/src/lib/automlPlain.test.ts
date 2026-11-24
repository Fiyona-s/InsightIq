import { describe, expect, it } from "vitest";
import { leakageWarning, plainSummary, METRIC_LABELS } from "./automlPresentation";
import type { MLExperiment } from "../automlapi";

const cand = (algorithm: string, v: Record<string, number>, t: Record<string, number> | null, selected = false) =>
  ({ algorithm, status: "completed", selected, validation_metrics: v, test_metrics: t }) as never;
const job = (task: string, model: ReturnType<typeof cand>, base: ReturnType<typeof cand>) =>
  ({ task, result: { leaderboard: [model, base], split: {}, plots: {} }, configuration: { features: [] } }) as unknown as MLExperiment;

describe("plain summary", () => {
  it("compares a classifier with always giving the most common answer, using only recorded numbers", () => {
    const text = plainSummary(job("classification", cand("HistGradientBoosting", { accuracy: 0.8, f1_macro: 0.7 }, { accuracy: 0.79, f1_macro: 0.7 }, true), cand("DummyClassifier", { accuracy: 0.735, f1_macro: 0.42 }, null)))!;
    expect(text).toContain("right 80.0% of the time");
    expect(text).toContain("most common answer would be right 73.5%");
    expect(text).toContain("better than that simple guess");
  });
  it("says so plainly when the model is no better than the simple guess", () => {
    const text = plainSummary(job("classification", cand("M", { accuracy: 0.74 }, { accuracy: 0.74 }, true), cand("DummyClassifier", { accuracy: 0.735 }, null)))!;
    expect(text).toContain("not clearly better");
  });
  it("describes regression error against always guessing the average", () => {
    const text = plainSummary(job("regression", cand("M", { mae: 10, r2: 0.5 }, { mae: 11, r2: 0.5 }, true), cand("DummyRegressor", { mae: 20, r2: 0 }, null)))!;
    expect(text).toContain("off by about 10 on average");
    expect(text).toContain("Always guessing the average would be off by about 20");
  });
  it("says nothing when there is no recorded comparison", () => {
    expect(plainSummary({ task: "classification", result: { leaderboard: [], split: {}, plots: {} } } as unknown as MLExperiment)).toBeNull();
  });
  it("has a plain name for every metric it explains", () => {
    for (const key of ["accuracy", "f1_macro", "mae", "r2"]) expect(METRIC_LABELS[key]).toBeTruthy();
  });
});

describe("leakage warning after training", () => {
  const mk = (task: string, t: Record<string, number>) => job(task, cand("M", t, t, true), cand("Dummy", t, null));
  it("appears at a held-out score of 0.98 or more and states the threshold", () => {
    expect(leakageWarning(mk("regression", { r2: 0.999 }))).toContain("0.98 or more");
    expect(leakageWarning(mk("classification", { accuracy: 0.985, f1_macro: 0.9 }))).toContain("Check your columns");
  });
  it("stays quiet for ordinary scores and never invents a warning for forecasts", () => {
    expect(leakageWarning(mk("regression", { r2: 0.8 }))).toBeNull();
    expect(leakageWarning(mk("classification", { accuracy: 0.8, f1_macro: 0.7 }))).toBeNull();
    expect(leakageWarning(mk("forecasting", { mae: 1 }))).toBeNull();
  });
});

describe('metric titles an owner can read', () => {
  it('names the macro metrics plainly in the table and on the cards', async () => {
    const { metricTitle } = await import('./automlPresentation');
    expect(METRIC_LABELS.precision_macro).toMatch(/averaged over classes/);
    expect(METRIC_LABELS.roc_auc).toMatch(/Ranking quality/);
    expect(metricTitle('recall_macro')).toBe('Recall (average over classes)');
    expect(metricTitle('roc_auc')).toBe('Ranking quality (ROC AUC)');
    expect(metricTitle('some_new_metric')).toBe('Some new metric');   // unknown keys stay readable
  });
});
