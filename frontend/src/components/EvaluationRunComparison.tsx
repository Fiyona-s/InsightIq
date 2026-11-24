import {TableFrame} from "./ui/data";
import {LoadingState,ErrorState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import { useEffect, useState } from "react";
import { phase4Api, type Evaluation } from "../phase4api";
import { request } from "../api";
import {
  compareRuns,
  scopeLabel,
  type EvaluationPresentation,
} from "../lib/evaluationPresentation";
import { formatNumber } from "../lib/formatters";
export default function EvaluationRunComparison({
  history,
}: {
  history: Evaluation[];
}) {
  const runs = history.filter((r) => r.status === "completed"),
    [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [overlap, setOverlap] = useState(false),
    [data, setData] = useState<{
      a: Evaluation;
      b: Evaluation;
      ma: EvaluationPresentation;
      mb: EvaluationPresentation;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    if (!left || !right) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      phase4Api.evaluation(left),
      phase4Api.evaluation(right),
      request<EvaluationPresentation>("/evaluations/" + left + "/presentation"),
      request<EvaluationPresentation>(
        "/evaluations/" + right + "/presentation",
      ),
    ])
      .then(([a, b, ma, mb]) => {
        if (current) setData({ a, b, ma, mb });
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [left, right]);
  const result = data
    ? compareRuns(data.a, data.b, data.ma, data.mb, overlap)
    : null;
  return (
    <section className="evaluation-comparison" aria-label="Run comparison">
      <h2>Compare stored runs</h2>
      <p>
        Same benchmark, recorded scoring version, dataset fingerprint and
        question set required. No scores are recalculated.
      </p>
      <p className="insight-note">
        A dataset fingerprint is a code that changes whenever the data changes, so only runs on identical data can be compared.
      </p>
      {!runs.length ? (
        <p>No completed runs to compare.</p>
      ) : (
        <>
          <div className="filter-fields">
            {(
              [
                ["Earlier run", left, setLeft],
                ["Later run", right, setRight],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label}>
                {label}
                <select
                  aria-label={label}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                >
                  <option value="">Choose a run</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {formatDate(r.created_at, "datetime")} ·{" "}
                      {r.mode === "offline" ? "Offline replay" : "Live"} ·{" "}
                      {scopeLabel(r)} · {r.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={overlap}
              onChange={(e) => setOverlap(e.target.checked)}
            />
            Compare overlapping questions only
          </label>
        </>
      )}
      {loading && <LoadingState as="p" role="status">Loading stored comparison…</LoadingState>}
      {error && <ErrorState as="p" role="alert">Comparison unavailable: {error}</ErrorState>}
      {result?.reason ? (
        <p role="status">Not comparable: {result.reason}</p>
      ) : (
        result && (
          <>
            <p>{result.scope}</p>
            <p>
              {[
                "Fixed",
                "Regressed",
                "Unchanged",
                "Unscored in one or both runs",
              ]
                .map(
                  (key) =>
                    key +
                    ": " +
                    formatNumber(
                      result.changes.filter((c) => c.change === key).length,
                    ),
                )
                .join(" · ")}
            </p>
            <TableFrame label="Per-question changes">
              <table aria-label="Per-question changes">
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Earlier</th>
                    <th scope="col">Later</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {result.changes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{c.before}</td>
                      <td>{c.after}</td>
                      <td>{c.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </>
        )
      )}
    </section>
  );
}
