import { PageHeader, StatusChip, statusTone } from "./ui/layout";
import { AdminPurpose } from "./AdminExtras";
import {pageLabel} from "../lib/navigation";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import {displayName} from "../lib/datasetNames";
import DatasetName from "./DatasetName";
import { middleEllipsis } from "../lib/filenames";
import { formatNumber } from "../lib/formatters";
import { useCallback, useEffect, useState, useMemo } from "react";
import {
  analystApi,
  type AnalystRun,
  type Dataset,
  type AgentEvent,
} from "../api";
import { Button } from "./ui/button";
import RunTraceDetails from "./RunTraceDetails";
import {runStatusLabel,moveListFocus} from "../lib/runPresentation";
import { useRunEvents } from "./useRunEvents";
const terminal = new Set(["succeeded", "failed", "clarification", "cancelled"]);
export default function ExecutionTracesPage({
  datasets,
}: {
  datasets: Dataset[];
}) {
  const [datasetId, setDatasetId] = useState(""),
    [runs, setRuns] = useState<AnalystRun[]>([]),
    [selected, setSelected] = useState<AnalystRun | null>(null),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setSelected(null);
    setRuns([]);
    analystApi
      .history(datasetId || undefined)
      .then((records) => {
        if (current) {
          setRuns(records);
          setMore(records.length === 30);
        }
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
  }, [datasetId, refresh]);
  async function earlier() {
    setLoading(true);
    try {
      const records = await analystApi.history(
        datasetId || undefined,
        runs.length,
      );
      setRuns((current) => [
        ...current,
        ...records.filter((r) => !current.some((old) => old.id === r.id)),
      ]);
      setMore(records.length === 30);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const runId = selected?.id,
    active = !!selected && !terminal.has(selected.status);
  const update = useCallback(() => {
    if (runId)
      void analystApi
        .run(runId)
        .then((run) => {
          setSelected((current) => (current?.id === run.id ? run : current));
          setRuns((current) => current.map((r) => (r.id === run.id ? run : r)));
        })
        .catch((e) => setError(e.message));
  }, [runId]);
  const onStep = useCallback(
    (event: AgentEvent) =>
      setSelected((current) => {
        if (!current || terminal.has(current.status)) return current;
        const events = current.events || [];
        return {
          ...current,
          current_step: event.step,
          attempts: event.attempt,
          events: events.some((e) => e.id === event.id)
            ? events
            : [...events, event],
        };
      }),
    [],
  );
  const connection = useRunEvents(runId, active, onStep, update);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [active, update]);
  const filtered = useMemo(()=>runs.filter(
    (run) =>
      (!status || run.status === status) &&
      run.question.toLowerCase().includes(search.toLowerCase()),
  ),[runs,status,search]);
  const displayed=selected&&filtered.some(r=>r.id===selected.id)?selected:filtered[0]||null;
  useEffect(()=>{setSelected(current=>current&&filtered.some(r=>r.id===current.id)?current:filtered[0]||null)},[filtered]);
  return (
    <div className="execution-traces-page">
      <PageHeader title={pageLabel("Execution traces")} description="A step-by-step record of each question. For developers." actions={<Button variant="outline" onClick={() => setRefresh((v) => v + 1)}>Refresh run history</Button>} />
      <AdminPurpose>to follow one question step by step, including the query it ran.</AdminPurpose>
      <div className="analytics-filters">
        <label>
          Trace dataset
          <select
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
          >
            <option value="">All datasets, including historical runs</option>
            {datasets.map((d) => (
              <option value={d.id} key={d.id} title={d.name}>
                {middleEllipsis(displayName(d))}{d.archived_at?" · Archived":""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search loaded runs
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          Trace status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {[
              "queued",
              "generating",
              "executing",
              "succeeded",
              "failed",
              "clarification",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>{runStatusLabel(s)}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <ErrorState as="p" className="alert" role="alert">
          {error}
        </ErrorState>
      )}
      {loading && (
        <LoadingState as="p" className="skeleton-block" role="status">
          Loading recorded runs…
        </LoadingState>
      )}
      <div className="traces-layout">
        <section className="trace-history" aria-label="Recorded runs" onKeyDown={e=>moveListFocus(e,'.trace-run')}>
          <h2>Run history</h2>
          <p className="insight-note">
            {formatNumber(runs.length)} loaded runs · Filters apply to this list.
          </p>
          {filtered.map((run) => (
            <button
              className={
                displayed?.id === run.id ? "trace-run chosen" : "trace-run"
              }
              key={run.id}
              aria-pressed={displayed?.id===run.id}
              onClick={()=>{setSelected(run);requestAnimationFrame(()=>{const heading=document.querySelector<HTMLElement>('.trace-inspection h2');heading?.scrollIntoView?.({block:'start'});heading?.focus()})}}
            >
              <strong>{run.question}</strong>
              <span>
                <DatasetName name={run.dataset_name} datasetId={run.dataset_id} provenance /> · {runStatusLabel(run.status)}
              </span>
              <small>
                {formatDate(run.created_at, "datetime")} ·{" "}
                {run.attempts == null ? "Unknown" : formatNumber(run.attempts)} attempts
              </small>
            </button>
          ))}
          {!loading && !filtered.length && (
            <p className="insight-note">
              {runs.length
                ? "No loaded runs match these filters."
                : "No recorded runs yet. Run an analysis in Ask a question to create a trace."}
            </p>
          )}
          {more && (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() => void earlier()}
            >
              Load earlier traces
            </Button>
          )}
        </section>
        <section className="trace-inspection" aria-label="Run trace details">
          {displayed ? (
            <>
              <div className="insight-heading">
                <div>
                  <span className="eyebrow"><DatasetName name={displayed.dataset_name} datasetId={displayed.dataset_id} provenance /></span>
                  <h2 tabIndex={-1}>{displayed.question}</h2>
                </div>
                <StatusChip tone={statusTone(displayed.status)} className={"run-status " + displayed.status}>
                  {runStatusLabel(displayed.status)}
                </StatusChip>
              </div>
              <Button variant="ghost" onClick={()=>{const item=document.querySelector<HTMLButtonElement>('.trace-run[aria-pressed="true"]');item?.scrollIntoView?.({block:'nearest'});item?.focus()}}>Back to run history</Button>
              <RunTraceDetails key={displayed.id} run={displayed} connection={active?connection:undefined}/>
            </>
          ) : (
            <div className="premium-empty">
              <h2>No run selected</h2>
              <p>Choose a run from history, or adjust the filters.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
