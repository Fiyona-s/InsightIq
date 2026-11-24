import { formatDisplayNumber } from "../lib/displayNumber";
import {TableFrame} from "./ui/data";
import {Card} from "./ui/layout";
import {mlTaskLabel,metricTitle,plainTerms} from "../lib/automlPresentation";
import {EmptyState,LoadingState} from "./WorkspaceStates";
import AutoMLSummary from "./AutoMLSummary";
import { metricMeanings, selectionExplanation, confusionInsight, clusterInsight } from "../lib/automlMeaning";
import DatasetName from "./DatasetName";
import { formatNumber } from "../lib/formatters";
import { lazy, Suspense } from "react";
import type { MLExperiment, MLMetrics } from "../automlapi";
const AutoMLPlots = lazy(() => import("./AutoMLPlots"));
export const mlValue = (v: unknown): string =>
  v == null
    ? "Not measured"
    : typeof v === "number"
      ? formatDisplayNumber(v)
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
export function MLTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
}) {
  const names = columns || Object.keys(rows[0] || {});
  return (
    <TableFrame label="Model comparison" className="ml-table">
      <table>
        <thead>
          <tr>
            {names.map((c) => (
              <th scope="col" key={c}>{c.replaceAll("_", " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {names.map((c) => (
                <td key={c} title={mlValue(r[c])}>
                  {mlValue(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <EmptyState as="p" className="insight-note">No rows available.</EmptyState>}
    </TableFrame>
  );
}
function Metrics({ metrics, n }: { metrics: MLMetrics | null; n?: number }) {
  return (
    <div className="ml-metric-list">
      {metrics ? (
        Object.entries(metrics).map(([key, value]) => (
          <div key={key}>
            <small>{metricTitle(key)}</small>
            <strong>
              {key === "flagged_fraction" && value != null
                ? formatNumber(value * 100, { decimals: 1 }) + "%"
                : mlValue(value)}
            </strong>
            {n != null && <small>n={formatNumber(n)}</small>}
          </div>
        ))
      ) : (
        <p className="insight-note">Not measured for this split.</p>
      )}
    </div>
  );
}
export default function AutoMLResults({ job }: { job: MLExperiment }) {
  const result = job.result;
  if (!result) return null;
  const selected = result.leaderboard.find((c) => c.selected),
    test = result.split.test as { count?: number } | undefined;
  return (
    <Card className="ml-results" aria-label="AutoML experiment results">
      <div className="insight-heading">
        <div>
          <span className="eyebrow">Measured on your data</span>
          <h2>{job.title}</h2>
          <p>
            {mlTaskLabel(job.task)} · {formatNumber(result.rows_used)} rows / periods used ·{" "}
            {job.duration_seconds == null ? "—" : formatNumber(job.duration_seconds)} seconds
          </p>
        </div>
        <span className="ml-badge">0 LLM calls</span>
      </div>
      <AutoMLSummary job={job}/>
      <p className="insight-note">{plainTerms(result.scope)}</p>
      {result.warnings.map((w, i) => (
        <p className="ml-warning" key={i}>
          {plainTerms(w)}
        </p>
      ))}
      <h3>
        {job.task === "clustering" || job.task === "anomaly"
          ? "Descriptive fitted-data metrics"
          : "Final test on rows the model never saw"}
      </h3>
      <Metrics
        metrics={(job.task==="clustering"||job.task==="anomaly"?selected?.training_metrics:selected?.test_metrics)||null}
        n={
          test?.count ??
          (job.task === "forecasting"
            ? job.configuration.forecast?.horizon
            : result.rows_used)
        }
      />
      <p className="insight-note">
        {job.task === "regression"
          ? "MAE/RMSE use target units; MSE uses squared units; lower error is better. R² can be negative and is undefined for constant held-out targets. Units: " +
            "not confirmed for this display" +
            "."
          : job.task === "classification"
            ? "Accuracy is the correct fraction. Macro precision/recall/F1 weight classes equally; ROC-AUC is shown only when defined."
            : job.task === "anomaly"
              ? "Anomaly flags identify unusual feature combinations. They are not fraud labels or measured fraud accuracy."
              : job.task === "clustering"
                ? "Silhouette describes internal separation and is undefined for one cluster or one cluster per row. PCA coordinates are projections, not original business features."
                : "MAE/RMSE use the measure units. WAPE is absolute error / absolute actual total, and is undefined for a zero denominator. No prediction intervals are estimated."}
      </p>
      {(() => {
        const meanings = metricMeanings(job);
        return meanings.length ? (
          <section className="ml-meanings" aria-label="What each number means">
            <h3>What each number means</h3>
            <p className="insight-note">In plain words, for the numbers above and in the comparison table.</p>
            <dl>
              {meanings.map((m) => (
                <div key={m.key}>
                  <dt>{m.label}: <strong>{m.value}</strong></dt>
                  <dd>{m.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null;
      })()}
      {(() => {
        const why = selectionExplanation(job);
        return why.length ? (
          <section className="ml-meanings" aria-label="Why this model was chosen">
            <h3>Why this model was chosen</h3>
            {why.map((line, i) => <p key={i}>{line}</p>)}
          </section>
        ) : null;
      })()}
      {result.details.reference_date && (
        <p className="insight-note">
          RFM reference date: {result.details.reference_date}.{" "}
          {result.details.frequency_definition}.
        </p>
      )}
      <Suspense
        fallback={
          <LoadingState as="p" role="status" className="skeleton-block">
            Loading result charts…
          </LoadingState>
        }
      >
        <AutoMLPlots result={result} />
      </Suspense>
      <p className="insight-note">
        {result.feature_importance.method} Point displays cap at 200 held-out
        rows or 500 entities; metrics use the full disclosed evaluation scope.
        The anomaly histogram uses all fitted rows.
      </p>
      {result.details.confusion_matrix && (
        <>
          <h3>Where it was wrong: actual (rows) against predicted (columns)</h3>
          <MLTable
            rows={result.details.confusion_matrix.map((r, i) => ({
              actual: result.details.labels?.[i],
              ...Object.fromEntries(
                r.map((v, j) => [result.details.labels?.[j] || String(j), v]),
              ),
            }))}
          />
          {confusionInsight(result).map((line, n) => <p className="ml-plot-reading ml-plot-insight" key={n}>{line}</p>)}
        </>
      )}
      {result.details.cluster_profiles && (
        <>
          <h3>Cluster characteristics — original feature summaries</h3>
          <MLTable
            rows={result.details.cluster_profiles.map((p) => ({
              cluster: p.cluster,
              size: p.count,
              ...p.features,
            }))}
          />
          {clusterInsight(result).map((line, n) => <p className="ml-plot-reading ml-plot-insight" key={n}>{line}</p>)}
          <p className="insight-note">
            Numerical features show within-cluster means; categorical/date
            features show their modal observed label. {result.details.pca_note}
          </p>
        </>
      )}
      {result.plots.anomalies && (
        <>
          <h3>Highest-scoring rows and feature context</h3>
          <MLTable rows={result.plots.anomalies.slice(0, 50)} />
          <small>
            Showing the top {formatNumber(Math.min(50, result.plots.anomalies.length))}{" "}
            scores; use batch prediction CSV to export every row.
          </small>
        </>
      )}
      {result.details.backtests && (
        <>
          <h3>Chronological backtesting</h3>
          <MLTable rows={result.details.backtests.map((b) => ({ ...b }))} />
        </>
      )}
      <details className="insight-panel ml-compare">
        <summary>Compare all models tried</summary>
        <h3>Model comparison</h3>
      <p className="insight-note">
        Selection: {result.selection_metric} on {result.selection_split}. Other
        candidates' final test metrics are not measured.
      </p>
      <MLTable
        columns={[
          "algorithm",
          "selection",
          "training_score",
          "validation_score",
          "test_score",
          "fit_seconds",
        ]}
        rows={result.leaderboard.map((c) => {
          const key =
            job.task === "clustering"
              ? "silhouette"
              : job.task === "anomaly"
                ? "flagged_fraction"
                : result.selection_metric;
          return {
            algorithm: c.algorithm,
            selection: c.selected
              ? "Selected on " + result.selection_split
              : c.status === "failed"
                ? c.error
                : "Candidate",
            training_score: c.training_metrics?.[key] ?? null,
            validation_score: c.validation_metrics?.[key] ?? null,
            test_score: c.test_metrics?.[key] ?? null,
            fit_seconds: c.fit_seconds,
          };
        })}
      />
      <details className="insight-panel">
        <summary>All candidate metrics by evaluation split</summary>
        {result.leaderboard.map((c) => (
          <article key={c.algorithm}>
            <h3>{c.algorithm}</h3>
            {c.error && <p className="ml-warning">{c.error}</p>}
            <h4>Training</h4>
            <Metrics metrics={c.training_metrics} />
            <h4>Validation / earlier backtests</h4>
            <Metrics metrics={c.validation_metrics} />
            <h4>Untouched test</h4>
            <Metrics metrics={c.test_metrics} />
          </article>
        ))}
      </details>
      </details>
    </Card>
  );
}
