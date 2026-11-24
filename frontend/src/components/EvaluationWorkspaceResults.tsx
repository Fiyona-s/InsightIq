import { WhyNothingScored } from "./AdminExtras";
import {TableFrame} from "./ui/data";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import { useEffect, useRef, useState } from "react";
import { type Evaluation, type Benchmark } from "../phase4api";
import { request } from "../api";
import { formatNumber } from "../lib/formatters";
import {
  selectedRows,
  outcome,
  reasons,
  tally,
  scopeLabel,
  type EvaluationRow,
  type EvaluationPresentation,
} from "../lib/evaluationPresentation";
import { SQLCode } from "./RunInsights";
const n = (v: number) => formatNumber(v);
function Output({
  result,
  label,
}: {
  result: EvaluationRow["actual"];
  label: string;
}) {
  return (
    <section>
      <h3>{label}</h3>
      {result ? (
        <>
          <p>
            Showing first {n(Math.min(20, result.rows.length))} of{" "}
            {n(result.rows.length)} stored rows.
          </p>
          <TableFrame label="Results summary">
            <table>
              <thead>
                <tr>
                  {result.columns.map((c, i) => (
                    <th scope="col" key={i}>
                      {c.name} · {c.type}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j}>
                        {v === null
                          ? "NULL"
                          : typeof v === "number"
                            ? formatNumber(v)
                            : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </>
      ) : (
        <p>
          No stored output.{" "}
          {label === "Expected result"
            ? "This case may require clarification / abstention; inspect the stored scoring reason."
            : ""}
        </p>
      )}
    </section>
  );
}
export default function EvaluationWorkspaceResults({
  job,
  benchmark,
  onSetUpLive,
}: {
  job: Evaluation;
  benchmark: Benchmark;
  onSetUpLive?: () => void;
}) {
  const [filter, setFilter] = useState({
      outcome: "Failures",
      difficulty: "All",
      type: "All",
      reason: "All",
      search: "",
    }),
    [row, setRow] = useState<EvaluationRow | null>(null),
    [meta, setMeta] = useState<EvaluationPresentation | null>(null),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null),
    opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let current = true;
    setMeta(null);
    setError("");
    request<EvaluationPresentation>("/evaluations/" + job.id + "/presentation")
      .then((m) => {
        if (current) setMeta(m);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [job.id, job.updated_at]);
  useEffect(() => {
    setRow(null);
  }, [job.id]);
  useEffect(() => {
    if (!row) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener.current?.focus();
    };
  }, [row]);
  const rows = selectedRows(job),
    counts = tally(job),
    failed = rows.filter((r) => r.correct !== true),
    visible = rows.filter(
      (r) =>
        (filter.outcome === "All" ||
          (filter.outcome === "Failures" && r.correct !== true) ||
          outcome(r) === filter.outcome) &&
        (filter.difficulty === "All" || r.difficulty === filter.difficulty) &&
        (filter.type === "All" || r.category === filter.type) &&
        (filter.reason === "All" || reasons(r).includes(filter.reason)) &&
        `${r.case_id} ${r.question}`
          .toLowerCase()
          .includes(filter.search.toLowerCase()),
    );
  const diff = meta?.results.find((r) => r.case_id === row?.case_id)?.diff;
  const percent = counts.scored
    ? formatNumber((counts.correct / counts.scored) * 100, { decimals: 1 }) +
      "%"
    : "Not measured";
  return (
    <section
      className="evaluation-workspace-results"
      aria-label="Stored evaluation summary"
    >
      {counts.scored === 0 && onSetUpLive && (
        <WhyNothingScored total={benchmark.case_count} onLive={onSetUpLive} />
      )}
      <div className="evaluation-summary">
        <h2>
          {job.case_ids.length === benchmark.case_count
            ? "Selected-run accuracy"
            : "Partial-run accuracy"}
        </h2>
        <p className="evaluation-score">
          {percent} · {n(counts.correct)} correct / {n(counts.scored)} scored
        </p>
        <p>
          {n(counts.incorrect)} incorrect · {n(counts.unscored)} unscored
          (separate from correct and incorrect)
        </p>
        <strong>{scopeLabel(job, benchmark.case_count)}</strong>
        <p>
          {formatDate(job.completed_at || job.created_at, "datetime")} ·{" "}
          {job.mode === "offline" ? "Offline replay · 0 new LLM calls" : "Live"}
        </p>
        <p>
          {job.version === benchmark.version
            ? benchmark.title
            : "Stored benchmark"}{" "}
          · {job.version} · Scoring version:{" "}
          {error
            ? "Unavailable"
            : meta
              ? meta.scoring_version || "Not recorded"
              : "Loading…"}
        </p>
        <p className="insight-note">
          Accuracy covers scored selected questions on this authored fictional
          retail benchmark. This small sample does not measure general system
          accuracy.
        </p>
      </div>
      <details className="evaluation-breakdown-group" open={counts.scored > 0}>
      <summary>By difficulty and by question type</summary>
      <div className="evaluation-breakdowns">
        {(["difficulty", "category"] as const).map((key) => (
          <section key={key}>
            <h3>By {key === "category" ? "question type" : "difficulty"}</h3>
            {Array.from(new Set(rows.map((r) => r[key]))).map((group) => {
              const part = rows.filter((r) => r[key] === group),
                scored = part.filter((r) => r.correct != null),
                correct = part.filter((r) => r.correct === true).length;
              return (
                <div className="evaluation-breakdown" key={group}>
                  <span>{group}</span>
                  <meter
                    min={0}
                    max={scored.length || 1}
                    value={correct}
                    aria-label={group + " stored accuracy"}
                  />
                  <strong>
                    {n(correct)} of {n(scored.length)} scored
                  </strong>
                  <small>
                    {n(part.length - scored.length)} unscored
                    {scored.length < 5
                      ? " · Small group: fewer than 5 scored questions."
                      : ""}
                  </small>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      </details>
      <h2>Incorrect and unscored questions</h2>
      <div className="evaluation-filters">
        {(
          [
            [
              "outcome",
              ["Failures", "All", "Correct", "Incorrect", "Unscored"],
            ],
            ["difficulty", ["All", ...new Set(rows.map((r) => r.difficulty))]],
            ["type", ["All", ...new Set(rows.map((r) => r.category))]],
            ["reason", ["All", ...new Set(rows.flatMap(reasons))]],
          ] as [keyof typeof filter, string[]][]
        ).map(([key, options]) => (
          <label key={key}>
            Filter {key}
            <select
              aria-label={"Filter " + key}
              value={filter[key]}
              onChange={(e) =>
                setFilter((f) => ({ ...f, [key]: e.target.value }))
              }
            >
              {options.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Search questions
          <input
            type="search"
            value={filter.search}
            onChange={(e) =>
              setFilter((f) => ({ ...f, search: e.target.value }))
            }
          />
        </label>
      </div>
      <p role="status">
        {n(visible.length)} of {n(rows.length)} selected questions shown ·{" "}
        {n(failed.length)} incorrect or unscored.
      </p>
      <TableFrame label="Evaluation questions">
        <table aria-label="Evaluation questions">
          <thead>
            <tr>
              {[
                "ID",
                "Question",
                "Difficulty",
                "Type",
                "Outcome",
                "Recorded reason",
              ].map((h) => (
                <th scope="col" key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.case_id}
                onClick={(e) => {
                  opener.current = e.currentTarget.querySelector("button");
                  setRow(r);
                }}
              >
                <td>
                  <button
                    className="button button-ghost"
                    onClick={(e) => {
                      opener.current = e.currentTarget;
                      setRow(r);
                    }}
                    aria-label={"Inspect " + r.case_id}
                  >
                    {r.case_id}
                  </button>
                </td>
                <td title={r.question}>{r.question}</td>
                <td>{r.difficulty}</td>
                <td>{r.category}</td>
                <td>{outcome(r)}</td>
                <td>
                  {reasons(r).map((reason) => (
                    <span
                      className="evaluation-reason"
                      title={reason}
                      key={reason}
                    >
                      {reason}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      {!visible.length && <p>No questions match these filters.</p>}
      {row && (
        <div className="dialog-backdrop evaluation-drawer-backdrop">
          <div
            ref={dialog}
            className="evaluation-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-drawer-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setRow(null);
              }
              if (e.key === "Tab") {
                const items = Array.from(
                  dialog.current!.querySelectorAll<HTMLElement>(
                    'button,a,input,select,textarea,summary,[tabindex="0"]',
                  ),
                ).filter((el) => el.getClientRects().length);
                const first = items[0],
                  last = items.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              className="button button-outline"
              onClick={() => setRow(null)}
            >
              Close details
            </button>
            <h2 id="evaluation-drawer-title">
              {row.case_id} · {outcome(row)}
            </h2>
            <p>{scopeLabel(job, benchmark.case_count)}</p>
            <p>{row.question}</p>
            <p>
              Stored scorer reason:{" "}
              {row.run?.error ||
              row.status === "execution_failed" ||
              row.status === "reference_failed"
                ? "See the recorded execution error under Technical details."
                : row.comparison || "No reason recorded"}
            </p>
            <Output result={row.expected} label="Expected result" />
            <Output result={row.actual} label="Actual result" />
            <h3>Predicted SQL</h3>
            <pre>
              <SQLCode
                sql={
                  row.replayed_sql ||
                  row.run?.executed_sql ||
                  row.run?.sql ||
                  "No saved SQL prediction"
                }
              />
            </pre>
            <h3>Stored-output row diff</h3>
            {error ? (
              <ErrorState as="p" role="alert">Diff unavailable: {error}</ErrorState>
            ) : !meta ? (
              <LoadingState as="p" role="status">Loading stored row diagnostics…</LoadingState>
            ) : (
              <>
                <p>{diff?.notice || "Diff not recorded."}</p>
                {diff?.available && (
                  <>
                    <p>
                      Showing first {n(diff.shown_rows || 0)} of{" "}
                      {n(diff.total_rows || 0)} combined output rows. Matched
                      rows may be reordered only when the stored case allows
                      unordered matching.
                    </p>
                    <TableFrame label="Row differences">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Output</th>
                            <th scope="col">Row</th>
                            <th scope="col">Match</th>
                            <th scope="col">Stored values</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff.rows.map((r, i) => (
                            <tr key={i}>
                              <td>{r.side}</td>
                              <td>{n(r.row)}</td>
                              <td>{r.match}</td>
                              <td>{JSON.stringify(r.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableFrame>
                  </>
                )}
              </>
            )}
            <details>
              <summary>Technical details</summary>
              <p>
                {row.run?.error ||
                  (row.status === "execution_failed" ||
                  row.status === "reference_failed"
                    ? row.comparison
                    : "No execution error recorded.")}
              </p>
              <pre>
                {JSON.stringify(
                  {
                    status: row.status,
                    replay: row.replay_diagnostics,
                    comparison: row.comparison_details,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
