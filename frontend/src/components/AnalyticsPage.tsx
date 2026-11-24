import { CHART } from "../lib/chartTheme";
import {TableFrame} from "./ui/data";
import {PageHeader} from "./ui/layout";
import {AdminPurpose} from "./AdminExtras";
import {pageLabel} from "../lib/navigation";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import {displayName} from "../lib/datasetNames";
import DatasetName from "./DatasetName";
import { middleEllipsis } from "../lib/filenames";
import { formatNumber } from "../lib/formatters";
import { useEffect, useState, useRef } from "react";
import { phase4Api, type Analytics } from "../phase4api";
import type { AnalystRun, Dataset } from "../api";
import RunTraceDetails from "./RunTraceDetails";
import {runStatusLabel,estimatedCost} from "../lib/runPresentation";
import { Button } from "./ui/button";
const percent = (v: number | null) =>
  v === null ? "Not measured" : formatNumber(v * 100, { decimals: 1 }) + "%";
export default function AnalyticsPage({ datasets }: { datasets: Dataset[] }) {
  const [data, setData] = useState<Analytics | null>(null),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<AnalystRun | null>(null);
  const traceHeading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{if(selected){traceHeading.current?.scrollIntoView?.({block:'start'});traceHeading.current?.focus()}},[selected]);
  useEffect(() => {
    let current = true;
    setSelected(null);
    setLoading(true);
    setError("");
    phase4Api
      .analytics(filters)
      .then((a) => {
        if (current) setData(a);
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
  }, [filters]);
  return (
    <div className="analytics-page">
      <PageHeader title={pageLabel("Run analytics")} description="How questions ran: speed, failures and retries. For developers." />
      <AdminPurpose>to show how long your questions took, which ones failed and why.</AdminPurpose>
      <form
        className="analytics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setFilters(
            Object.fromEntries(
              [...form.entries()].map(([k, v]) => [k, String(v)]),
            ),
          );
        }}
      >
        <label>
          Dataset
          <select name="dataset_id">
            <option value="">All datasets</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id} title={d.name}>
                {middleEllipsis(displayName(d))}{d.archived_at?" · Archived":""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status">
            <option value="">All statuses</option>
            {[
              "succeeded",
              "failed",
              "cancelled",
              "clarification",
              "generating",
              "executing",
              "queued",
            ].map((s) => (
              <option key={s} value={s}>{runStatusLabel(s)}</option>
            ))}
          </select>
        </label>
        <label>
          Search questions
          <input
            name="search"
            maxLength={200}
            placeholder="Search persisted history"
          />
        </label>
        <details className="analytics-more-filters"><summary>More filters</summary>        <label>
          Model
          <input
            name="model"
            list="analytics-models"
            placeholder="Any recorded model"
          />
          <datalist id="analytics-models">
            {data?.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          From
          <input type="date" name="start" />
        </label>
        <label>
          Through
          <input type="date" name="end" />
        </label>
</details>
        <Button>Apply analytics filters</Button>
        <Button type="reset" variant="ghost" onClick={() => setFilters({})}>
          Reset
        </Button>
      </form>
      {error && (
        <ErrorState as="p" className="alert" role="alert">
          {error}
        </ErrorState>
      )}
      {loading && (
        <LoadingState as="p" className="skeleton-block" role="status">
          Aggregating recorded runs…
        </LoadingState>
      )}
      {data && (
        <>
          <div className="metrics-grid">
            <Card label="Normal user questions" value={data.total_questions} />
            <Card label="Failed runs" value={data.failed} />
            <Card
              label="Average latency"
              value={
                data.latency_ms.average == null
                  ? "Unknown"
                  : formatNumber(data.latency_ms.average,{decimals:0}) + " ms"
              }
            />
            <Card label="Runs with recorded retries" value={Object.entries(data.attempts).filter(([attempt])=>Number.isFinite(Number(attempt))&&Number(attempt)>1).reduce((sum,[,count])=>sum+count,0)}/>
            <Card
              label="Known token sum"
              value={
                data.tokens.known_records ? data.tokens.known_sum : "Unknown"
              }
            />
            <Card
              label="Known estimated cost"
              value={
                data.cost_usd.known_records
                  ? estimatedCost(data.cost_usd.known_sum)
                  : "Unknown"
              }
            />
          </div>
          <p className="analytics-scope">
            Execution success is not answer accuracy. {data.correctness}
          </p>
          <p className="insight-note">
            “Known” means only values that were actually recorded are counted; nothing is estimated for runs that did not record them.
          </p>
          <section className="run-history-table">
            <h2>Recent matching runs</h2>
            <TableFrame label="Recent runs">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Question / dataset</th>
                    <th scope="col">Status</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Latency</th>
                    <th scope="col">Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.question}
                        <small>
                          <DatasetName name={r.dataset_name} datasetId={r.dataset_id} provenance /> ·{" "}
                          {formatDate(r.created_at, "datetime")}
                        </small>
                      </td>
                      <td>{runStatusLabel(r.status)}</td>
                      <td>{r.attempts == null ? "Unknown" : formatNumber(r.attempts)}</td>
                      <td>{r.metrics.total_latency_ms == null ? "Unknown" : formatNumber(r.metrics.total_latency_ms)} ms</td>
                      <td>
                        <Button variant="ghost" onClick={event=>{opener.current=event.currentTarget;setSelected(r)}}>
                          Inspect trace
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
            {!data.recent.length&&<p>No recent runs match the applied filters.</p>}
          </section>
          {selected && (
            <section className="analytics-trace">
              <div className="insight-heading">
                <h2 ref={traceHeading} tabIndex={-1}>{selected.question}</h2>
                <Button variant="ghost" onClick={()=>{setSelected(null);opener.current?.focus()}}>
                  Close trace
                </Button>
              </div>
              <p><DatasetName name={selected.dataset_name} datasetId={selected.dataset_id} provenance/> · {runStatusLabel(selected.status)}</p>
              <RunTraceDetails key={selected.id} run={selected}/>
            </section>
          )}
          <details className="method-note">
            <summary>More metrics &amp; coverage</summary>
            <div className="metrics-grid">
            <Card
              label="Execution success"
              value={percent(data.execution_success_rate)}
            />

              <Card
                label="Runs with rejected SQL"
                value={data.validation_failures}
              />
              <Card
                label="p50 / p95 latency"
                value={`${data.latency_ms.p50 == null ? "Unknown" : formatNumber(data.latency_ms.p50,{decimals:0})} / ${data.latency_ms.p95 == null ? "Unknown" : formatNumber(data.latency_ms.p95,{decimals:0})} ms`}
              />
              <Card
                label="Retrieval latency"
                value={
                  data.retrieval_latency_ms.average == null
                    ? "Not recorded"
                    : formatNumber(data.retrieval_latency_ms.average,{decimals:0}) + " ms"
                }
              />
            </div>
            <p>
              {data.coverage} Unknown usage: {formatNumber(data.tokens.unknown_records)}{" "}
              records. Unknown cost: {formatNumber(data.cost_usd.unknown_records)} records.
              Retrieval measured for{" "}
              {formatNumber(data.retrieval_latency_ms.measured_records)} runs.
            </p>
          <p className="feedback-counts">Helpful: {formatNumber(data.feedback_counts?.helpful??0)} · Not helpful: {formatNumber(data.feedback_counts?.not_helpful??0)}</p>
          <LatencyTrend runs={data.recent} />
          <div className="analytics-breakdowns">
            <section>
              <h2>Attempt distribution</h2>
              {Object.entries(data.attempts).map(([attempt, count]) => (
                <div className="distribution-row" key={attempt}>
                  <span>{attempt} attempts</span>
                  <meter
                    min={0}
                    max={data.total_questions || 1}
                    value={count}
                  />
                  <strong>{formatNumber(count)}</strong>
                </div>
              ))}
              {!data.total_questions && (
                <p>No recorded questions match these filters.</p>
              )}
            </section>
            <section>
              <h2>Error categories</h2>
              {Object.entries(data.error_categories).map(
                ([category, count]) => (
                  <div className="distribution-row" key={category}>
                    <span>{category}</span>
                    <strong>{formatNumber(count)}</strong>
                  </div>
                ),
              )}
              {!Object.keys(data.error_categories).length && (
                <p>No non-success outcomes in this selection.</p>
              )}
            </section>
          </div>
<p className="insight-note">Retry counts use recorded attempt buckets above one. Missing attempts are not treated as retries.</p>
          </details>
        </>
      )}
    </div>
  );
}
function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <small>{label}</small>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}
export {default as Overview} from "./HomePage";

function LatencyTrend({ runs }: { runs: AnalystRun[] }) {
  const samples = runs
    .filter(
      (r) =>
        r.metrics.total_latency_ms != null &&
        Number.isFinite(r.metrics.total_latency_ms) &&
        Number.isFinite(Date.parse(r.created_at)),
    )
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (!samples.length) return null;
  const first = Date.parse(samples[0].created_at),
    last = Date.parse(samples[samples.length - 1].created_at);
  const max = Math.max(1, ...samples.map((r) => r.metrics.total_latency_ms!));
  const points = samples.map((r) => ({
    x:
      40 +
      ((Date.parse(r.created_at) - first) / Math.max(1, last - first)) * 700,
    y: 130 - (r.metrics.total_latency_ms! / max) * 100,
    run: r,
  }));
  return (
    <section className="latency-trend">
      <div className="insight-heading">
        <h2>Recent run latency</h2>
        <small>{formatNumber(samples.length)} recorded runs · milliseconds</small>
      </div>
      <svg
        viewBox="0 0 780 160"
        role="img"
        aria-label="Recent run latency in chronological order"
      >
        <line x1="40" y1="130" x2="740" y2="130" stroke={CHART.grid} />
        <text x="4" y="34">
          {formatNumber(max,{decimals:0})}
        </text>
        <text x="16" y="134">
          0
        </text>
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke={CHART.primary}
            strokeWidth="2"
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        )}
        {points.map((p) => (
          <circle key={p.run.id} cx={p.x} cy={p.y} r="3" fill={CHART.primary}>
            <title>
              {p.run.question}: {formatNumber(p.run.metrics.total_latency_ms)} ms
            </title>
          </circle>
        ))}
        <text x="40" y="153">
          {formatDate(first, "date")}
        </text>
        <text x="740" y="153" textAnchor="end">
          {formatDate(last, "date")}
        </text>
      </svg>
    </section>
  );
}
