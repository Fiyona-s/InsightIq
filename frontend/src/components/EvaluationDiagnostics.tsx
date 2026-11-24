import {ErrorState} from "./WorkspaceStates";
import { formatNumber } from "../lib/formatters";
import { useState } from "react";
import {
  type BenchmarkCase,
  type Evaluation,
  type EvaluationRate,
} from "../phase4api";
import { SQLCode, WorkflowInspector, RetrievalPanel } from "./RunInsights";
import { ResultTable } from "./DashboardPage";

export type EvaluationRow = NonNullable<Evaluation["results"]>[number];
export type ResultFilter =
  "all" | "correct" | "incorrect" | "execution_failure" | "unevaluated";
export function matchesResult(row: EvaluationRow, filter: ResultFilter) {
  if (filter === "all") return true;
  if (filter === "correct") return row.correct === true;
  if (filter === "incorrect") return row.correct === false;
  if (filter === "unevaluated") return row.correct == null;
  return (
    row.status === "execution_failed" ||
    (!!row.run &&
      row.run.status === "failed" &&
      (row.run.events?.some(
        (e) => e.step === "execute" && e.status === "rejected",
      ) ||
        [
          "execution_error",
          "resource_limit",
          "timeout",
          "sandbox_unavailable",
          "worker_error",
        ].includes(row.run.error_code || "")))
  );
}
export function useEvaluationRows(
  job: Evaluation | null,
  cases: BenchmarkCase[] = [],
) {
  const [filter, setFilter] = useState<ResultFilter>("all");
  const records = new Map((job?.results || []).map((r) => [r.case_id, r]));
  const rows = (job?.case_ids || []).map(
    (id) =>
      records.get(id) ||
      ({
        case_id: id,
        category: cases.find((c) => c.id === id)?.category || "Unknown",
        difficulty: cases.find((c) => c.id === id)?.difficulty || "Unknown",
        question:
          cases.find((c) => c.id === id)?.question ||
          "Question metadata unavailable",
        reference_sql: cases.find((c) => c.id === id)?.reference_sql || null,
        expected: cases.find((c) => c.id === id)?.expected || null,
        actual: null,
        correct: null,
        run: null,
        failure_labels: [],
        comparison: "Not evaluated — prediction not recorded",
        status: undefined,
      } as EvaluationRow),
  );
  return {
    rows: rows.filter((r) => matchesResult(r, filter)),
    filter,
    setFilter,
    total: rows.length,
  };
}
export function EvaluationResultFilter({
  value,
  onChange,
  shown,
  total,
}: {
  value: ResultFilter;
  onChange: (value: ResultFilter) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="evaluation-result-filter">
      <label>
        Filter question results
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as ResultFilter)}
        >
          <option value="all">All questions</option>
          <option value="correct">Correct</option>
          <option value="incorrect">Incorrect</option>
          <option value="execution_failure">Execution failure</option>
          <option value="unevaluated">Unevaluated</option>
        </select>
      </label>
      <small>
        {formatNumber(shown)} / {formatNumber(total)} selected questions shown. Filters do not change report
        metrics.
      </small>
    </div>
  );
}
export function formatRate(rate?: EvaluationRate) {
  return rate
    ? `${rate.value == null ? "Not measured" : formatNumber(rate.value * 100, { decimals: 1 }) + "%"} · ${rate.numerator} / ${rate.denominator} ${rate.unit}`
    : "Not measured — denominator unavailable";
}
export function EvaluationResearchSummary({ job }: { job: Evaluation }) {
  const m = job.metrics;
  return (
    <section
      className="evaluation-research-summary"
      aria-label="Research summary"
    >
      <h3>Research summary</h3>
      <p className="insight-note">
        {formatNumber(job.case_ids.length)} selected questions; {m?.completed_cases == null ? 0 : formatNumber(m?.completed_cases)}{" "}
        checked. This sample is not overall benchmark accuracy. Policy:{" "}
        {job.comparison_policy || "Legacy strict typed contract"}.
      </p>
      <div className="metrics-grid">
        {[
          ["SQL validity", "sql_validity"],
          ["SQL execution success", "execution_success"],
          ["Strict result correctness", "result_correctness"],
          ["Answerable-question accuracy", "answerable_accuracy"],
          ["Correct abstention", "correct_abstention"],
        ].map(([label, key]) => (
          <div className="metric-card" key={key}>
            <small>{label}</small>
            <strong>{formatRate(m?.rates?.[key])}</strong>
            <small>{m?.rates?.[key]?.description}</small>
          </div>
        ))}
      </div>
      <p className="insight-note">
        {job.mode === "offline"
          ? "New local replay latency"
          : "Model-run latency"}
        : p50 {m?.p50_latency_ms ?? "Unknown"} / p95{" "}
        {m?.p95_latency_ms ?? "Unknown"} ms; n=
        {m?.latency_sample_size == null ? "unknown" : formatNumber(m?.latency_sample_size)}.{" "}
        {job.mode === "offline"
          ? "0 new LLM calls; historical generation attempts, tokens and cost are shown only in source details."
          : `Average generation attempts: ${m?.average_attempts == null ? "Unknown" : formatNumber(m.average_attempts, {decimals:2})}, n=${m?.completed_cases ?? 0}. Reported token coverage: ${m?.usage_sample_size ?? "unknown"} / ${m?.completed_cases ?? 0}; cost coverage: ${m?.cost_sample_size ?? "unknown"} / ${m?.completed_cases ?? 0}.`}
      </p>
      <details className="reviewed-rates">
        <summary>
          Independent cause reviews · {m?.reviewed_cases == null ? 0 : formatNumber(m?.reviewed_cases)} reviewed cases
        </summary>
        <p>
          Unreviewed causes remain unknown. An alias-only mismatch does not
          certify an aggregation, filter or join error.
        </p>
        <dl>
          {[
            ["Wrong join", "wrong_join"],
            ["Wrong filter", "wrong_filter"],
            ["Wrong aggregation", "wrong_aggregation"],
            ["Hallucinated column", "hallucinated_column"],
            ["Hallucinated table", "hallucinated_table"],
          ].map(([label, key]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{formatRate(m?.rates?.[key])}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
export function EvaluationCaseDetails({
  row,
  job,
  showOutputs = true,
}: {
  row: EvaluationRow;
  job: Evaluation;
  showOutputs?: boolean;
}) {
  const run = row.run,
    m = run?.metrics,
    offline = job.mode === "offline";
  return (
    <div className="evaluation-case-details">
      <p>
        <strong>
          {row.case_id} · {row.difficulty} ·{" "}
          {row.correct == null
            ? "Not evaluated"
            : row.correct
              ? "Correct"
              : "Incorrect"}
        </strong>
      </p>
      <p>{row.question}</p>
      {row.comparison_details?.alias_only_mismatch && (
        <p className="comparison-diagnostic">
          Alias-only contract mismatch: positional typed values match, but
          output column names differ. Strict correctness remains failed.{" "}
          {row.comparison_details.notice}
        </p>
      )}
      <div className="sql-comparison">
        <div>
          <h3>Generated SQL</h3>
          <pre>
            <SQLCode
              sql={row.replayed_sql || run?.sql || "No saved SQL prediction"}
            />
          </pre>
        </div>
        <div>
          <h3>Reference SQL</h3>
          <pre>
            <SQLCode
              sql={row.reference_sql || "Clarification / abstention expected"}
            />
          </pre>
        </div>
      </div>
      {showOutputs && (
        <>
          <h3>Predicted result</h3>
          {row.actual ? (
            <ResultTable result={row.actual} />
          ) : (
            <p>{run?.clarification || "No successful SQL output"}</p>
          )}
          <h3>Expected result</h3>
          {row.expected ? (
            <ResultTable result={row.expected} />
          ) : (
            <p>Appropriate clarification / abstention</p>
          )}
        </>
      )}
      {run?.error && <ErrorState as="p" className="alert">{run.error}</ErrorState>}
      <dl className="evaluation-case-metadata">
        <div>
          <dt>
            {offline ? "Historical generation attempts" : "Generation attempts"}
          </dt>
          <dd>{run?.attempts == null ? "Unknown" : formatNumber(run?.attempts)}</dd>
        </div>
        <div>
          <dt>{offline ? "Historical model run latency" : "Total latency"}</dt>
          <dd>{m?.total_latency_ms == null ? "Unknown" : formatNumber(m?.total_latency_ms)} ms</dd>
        </div>
        <div>
          <dt>Retrieval / SQL execution latency</dt>
          <dd>
            {m?.retrieval_latency_ms == null ? "Unknown" : formatNumber(m?.retrieval_latency_ms)} /{" "}
            {m?.query_latency_ms == null ? "Unknown" : formatNumber(m?.query_latency_ms)} ms
          </dd>
        </div>
        {offline && (
          <div>
            <dt>New local replay latency</dt>
            <dd>{row.offline_latency_ms ?? "Not measured"} ms</dd>
          </div>
        )}
        <div>
          <dt>{offline ? "Historical reported tokens" : "Reported tokens"}</dt>
          <dd>{m?.total_tokens == null ? "Unknown" : formatNumber(m?.total_tokens)}</dd>
        </div>
        <div>
          <dt>
            {offline ? "Historical estimated cost" : "Estimated model cost"}
          </dt>
          <dd>
            {m?.estimated_cost_usd == null
              ? "Unknown"
              : "$" + formatNumber(m.estimated_cost_usd, { decimals: 6 })}{" "}
            · estimate, not an invoice
          </dd>
        </div>
        <div>
          <dt>Model / pipeline</dt>
          <dd>
            {row.source_model || m?.provider_model || m?.model || job.model} /{" "}
            {row.source_pipeline || job.pipeline}
          </dd>
        </div>
        <div>
          <dt>Prompt / workflow version</dt>
          <dd>
            {run?.prompt_version || "Unknown — not recorded"} /{" "}
            {run?.workflow_version || "Unknown — not recorded"}
          </dd>
        </div>
        <div>
          <dt>Prompt SHA-256</dt>
          <dd>{run?.prompt_hash || "Unknown — not recorded"}</dd>
        </div>
        <div>
          <dt>Benchmark / dataset / content fingerprint</dt>
          <dd>
            {job.version} / {job.dataset_id} /{" "}
            {job.dataset_fingerprint || "Unknown — not recorded"}
          </dd>
        </div>
      </dl>
      {row.replay_diagnostics &&
        Object.keys(row.replay_diagnostics).length > 0 && (
          <p>
            New replay validation: {row.replay_diagnostics.validation};
            execution: {row.replay_diagnostics.execution}.
          </p>
        )}
      {run?.attempt_history?.length ? (
        <details>
          <summary>SQL attempt outcomes</summary>
          {run.attempt_history.map((a) => (
            <article key={a.attempt}>
              <strong>
                Attempt {formatNumber(a.attempt)}: {a.outcome}
              </strong>
              <p>
                Validation {a.validation}; execution {a.execution};{" "}
                {a.error_code || "no error"}
              </p>
              <pre>
                <SQLCode sql={a.sql || "No SQL"} />
              </pre>
              <small>
                Generation context fingerprint: {a.context_fingerprint}
              </small>
            </article>
          ))}
        </details>
      ) : null}
      {run?.retrieval ? (
        <RetrievalPanel retrieval={run.retrieval} />
      ) : (
        <p>Retrieved context unavailable in this saved record.</p>
      )}
      {run && <WorkflowInspector run={run} />}
      <p className="insight-note">
        Diagnostics: {row.failure_labels.join(", ") || "none"}. Execution
        success does not certify business correctness. Reference SQL is
        displayed only within evaluation diagnostics.
      </p>
    </div>
  );
}
