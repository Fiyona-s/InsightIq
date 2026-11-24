import {TableFrame} from "./ui/data";
import {ErrorState} from "./WorkspaceStates";
import { formatNumber } from "../lib/formatters";
import { type Evaluation, type BenchmarkCase } from "../phase4api";
import { Button } from "./ui/button";
import {
  useEvaluationRows,
  EvaluationResultFilter,
  EvaluationCaseDetails,
  EvaluationResearchSummary,
} from "./EvaluationDiagnostics";
export default function OfflineEvaluationResults({
  job,
  onCancel,
  cases,
}: {
  job: Evaluation;
  onCancel: () => void;
  cases?: BenchmarkCase[];
}) {
  const view = useEvaluationRows(job, cases);
  const m = job.metrics,
    active = !["completed", "failed", "cancelled"].includes(job.status);
  return (
    <section
      className="evaluation-results offline-results"
      aria-label="Offline evaluation results"
    >
      <div className="insight-heading">
        <div>
          <span className="eyebrow">OFFLINE EVALUATION — NO LLM CALLS</span>
          <h2>Saved prediction replay</h2>
          <p role="status">
            {job.status} · {formatNumber(m?.completed_cases || 0)} / {formatNumber(job.case_ids.length)}{" "}
            questions checked
          </p>
          <strong className="offline-call-indicator">
            {formatNumber(job.provider_calls)} new LLM calls
          </strong>
        </div>
        {active && (
          <Button variant="outline" onClick={onCancel}>
            Cancel offline evaluation
          </Button>
        )}
      </div>
      <progress
        aria-label="Offline evaluation progress"
        max={job.case_ids.length}
        value={m?.completed_cases || 0}
      />
      {job.error && (
        <ErrorState as="p" className="alert" role="alert">
          {job.error}
        </ErrorState>
      )}
      <p className="insight-note">
        Accuracy covers evaluated saved predictions only. Missing predictions
        are unscored; reference verification is separate.
      </p>
      <div className="metrics-grid">
        {[
          ["Evaluated predictions", m?.evaluated_count ?? 0],
          ["Correct", m?.correct_count ?? 0],
          ["Incorrect", m?.incorrect_count ?? 0],
          ["Missing predictions", m?.missing_predictions ?? 0],
          ["Execution / validation failures", m?.execution_failures ?? 0],
          ["Reference failures", m?.reference_failures ?? 0],
          [
            "Accuracy over evaluated predictions",
            m?.accuracy == null
              ? "Not evaluated"
              : formatNumber(m.accuracy * 100, { decimals: 1 }) + "%",
          ],
          ["New LLM cost", "$0.00"],
        ].map(([label, value]) => (
          <div className="metric-card" key={String(label)}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {m?.evaluated_count === 0 && m.missing_predictions !== 0 && (
        <p className="offline-missing-notice">
          Not evaluated — no saved prediction
        </p>
      )}
      <EvaluationResearchSummary job={job} />
      <EvaluationResultFilter
        value={view.filter}
        onChange={view.setFilter}
        shown={view.rows.length}
        total={view.total}
      />
      {!view.rows.length && (
        <p className="insight-note">No questions match this filter.</p>
      )}
      <TableFrame label="Offline comparison">
        <table className="offline-comparison-table">
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Prediction / status</th>
              <th scope="col">Expected output</th>
              <th scope="col">Actual output</th>
              <th scope="col">Comparison / failure reason</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.case_id}>
                <td>
                  <strong>
                    {row.case_id} · {row.difficulty}
                  </strong>
                  <p>{row.question}</p>
                </td>
                <td>
                  <strong>
                    {row.correct == null
                      ? "Not evaluated"
                      : row.correct
                        ? "Correct"
                        : "Incorrect"}
                  </strong>
                  <small>{row.status?.replaceAll("_", " ")}</small>
                  {row.source_evaluation_id ? (
                    <>
                      <small>
                        Source: {row.source_model} · {row.source_pipeline}
                      </small>
                      <small>
                        Evaluation {row.source_evaluation_id} · run{" "}
                        {row.source_run_id}
                      </small>
                      <details>
                        <summary>Saved prediction and trace</summary>
                        <EvaluationCaseDetails
                          row={row}
                          job={job}
                          showOutputs={false}
                        />
                      </details>
                    </>
                  ) : (
                    <span>
                      {row.status === "missing_prediction"
                        ? "Not evaluated — no saved prediction"
                        : "Not evaluated — prediction not recorded"}
                    </span>
                  )}
                </td>
                <td>
                  {row.expected ? (
                    <>
                      <small>
                        {row.expected.columns
                          .map((c) => `${c.name} (${c.type})`)
                          .join(", ")}
                      </small>
                      <pre>{JSON.stringify(row.expected.rows, null, 2)}</pre>
                    </>
                  ) : (
                    <span>Appropriate clarification / abstention</span>
                  )}
                </td>
                <td>
                  {row.actual ? (
                    <>
                      <small>
                        {row.actual.columns
                          .map((c) => `${c.name} (${c.type})`)
                          .join(", ")}
                      </small>
                      <pre>{JSON.stringify(row.actual.rows, null, 2)}</pre>
                    </>
                  ) : (
                    <span>
                      {row.status === "missing_prediction"
                        ? "No prediction to execute"
                        : row.status === "execution_failed"
                          ? "Execution failed"
                          : row.status === "reference_failed"
                            ? "Not scored — reference failed"
                            : row.run?.clarification || "No SQL output"}
                    </span>
                  )}
                </td>
                <td>{row.comparison}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <p className="insight-note">
        {m?.diagnostic_note} Source model usage and historical traces describe
        prior runs; new model usage is zero.
      </p>
      <div className="toolbar">
        <a
          className="button button-outline"
          href={`/api/evaluations/${job.id}/report.json`}
          download
        >
          Export offline JSON report
        </a>
        <a
          className="button button-outline"
          href={`/api/evaluations/${job.id}/report.csv`}
          download
        >
          Export offline CSV report
        </a>
      </div>
    </section>
  );
}
