import { formatDisplayNumber } from "../lib/displayNumber";
import {TableFrame} from "./ui/data";
import type { MLExperiment } from "../automlapi";
import { resultNarrative, baselineComparison, plainSummary, leakageWarning, METRIC_LABELS, plainTerms } from "../lib/automlPresentation";
import { formatNumber } from "../lib/formatters";
import { useEffect, useState } from "react";
import { automlApi, type LeakageFinding } from "../automlapi";
export default function AutoMLSummary({ job }: { job: MLExperiment }) {
  const result = job.result;
  // The same read-only check as before training, so the warning can name the suspect columns (warning only).
  const [suspects, setSuspects] = useState<LeakageFinding[]>([]);
  const target = job.configuration.target, features = job.configuration.features.map((f) => f.name);
  useEffect(() => {
    setSuspects([]);
    if (!result || !target || !features.length || (job.task !== "regression" && job.task !== "classification")) return;
    let current = true;
    Promise.resolve().then(() => automlApi.leakage(job.dataset_id, job.task, target, features))
      .then((r) => { if (current && r?.findings) setSuspects(r.findings); })
      .catch(() => undefined);
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);
  if (!result) return null;
  const comparison = baselineComparison(job),
    test = result.split.test as { count?: number } | undefined;
  const counts = result.plots.classification;
  const observed = counts?.map((c) => c.actual) || [],
    imbalance =
      observed.length > 1 &&
      Math.max(...observed) >= 2 * Math.max(1, Math.min(...observed));
  return (
    <section className="ml-summary" aria-label="Measured model summary">
      <h3>What the measured results mean</h3>
      {plainSummary(job) && <p className="ml-headline ml-plain">{plainSummary(job)}</p>}
      {(leakageWarning(job) || !!suspects.length) && (
        <div className="ml-warning" role="alert" aria-label="Leakage warning">
          {leakageWarning(job) && <p>{leakageWarning(job)}</p>}
          {!!suspects.length && (
            <>
              <p>Columns that may have given away the answer:</p>
              <ul>{suspects.map((l) => <li key={l.column}><strong>{l.column}</strong>: {l.sentence}</li>)}</ul>
            </>
          )}
        </div>
      )}
      <p className="ml-headline">{resultNarrative(job)}</p>
      <p>
        Local training · 0 LLM calls ·{" "}
        {job.configuration.features.length || "Derived"} features ·{" "}
        {job.duration_seconds == null
          ? "Time not recorded"
          : formatNumber(job.duration_seconds) + " seconds"}
      </p>
      {comparison ? (
        <>
          <h4>How accurate is this?</h4>
          <p>
            {plainTerms(comparison.scope)}.{" "}
            {comparison.baseline.algorithm === "DummyRegressor"
              ? "Baseline predicts the training mean."
              : comparison.baseline.algorithm === "DummyClassifier"
                ? "Baseline predicts the training majority class."
                : "Baseline repeats the last observed value."}
          </p>
          <TableFrame label="Model summary">
            <table>
              <thead>
                <tr>
                  <th scope="col">Measured metric</th>
                  <th scope="col">Best model <small>({comparison.model.algorithm})</small></th>
                  <th scope="col">Simple guess, for comparison <small>({comparison.baseline.algorithm})</small></th>
                </tr>
              </thead>
              <tbody>
                {comparison.metrics.map((key) => (
                  <tr key={key}>
                    <th scope="row">{METRIC_LABELS[key] || key}</th>
                    <td>
                      {formatDisplayNumber(comparison.model.validation_metrics![key]!)}
                    </td>
                    <td>
                      {formatDisplayNumber(
                        comparison.baseline.validation_metrics![key]!,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <p>
            The baseline's final test score is shown only if it was actually
            recorded. This comparison uses matching validation scopes.
          </p>
        </>
      ) : (
        <p>Baseline not recorded.</p>
      )}
      {!!counts?.length && (
        <p>
          Stored held-out class counts:{" "}
          {counts
            .map((c) => c.class + ": " + formatNumber(c.actual))
            .join(", ")}
          .
        </p>
      )}
      {imbalance && (
        <p className="ml-warning">
          Class imbalance: the largest held-out class has at least twice as many
          rows as the smallest. Accuracy alone can conceal minority-class
          errors.
        </p>
      )}
      {test?.count != null && test.count < 30 && (
        <p className="ml-warning">
          Small held-out set: {formatNumber(test.count)} rows. Estimates may vary
          substantially.
        </p>
      )}
      {(job.task === "regression" || job.task === "classification") && (
        <p>
          One recorded grouped train/validation/test split; this is not repeated
          cross-validation.
        </p>
      )}
      {!result.feature_importance?.values?.length ? (
        <p>Feature importance not recorded for this model.</p>
      ) : (
        <p>
          Feature importance method: {result.feature_importance.method}{" "}
          Importance is not causation.
        </p>
      )}
      {job.task === "regression" && !result.plots.regression?.length && (
        <p>
          Held-out predictions not recorded; actual vs predicted plot omitted.
        </p>
      )}
      {job.task === "classification" && !result.details.confusion_matrix && (
        <p>Held-out confusion matrix not recorded; plot omitted.</p>
      )}
    </section>
  );
}
