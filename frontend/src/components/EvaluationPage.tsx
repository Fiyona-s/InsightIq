import {TableFrame} from "./ui/data";
import {PageHeader} from "./ui/layout";
import {pageLabel} from "../lib/navigation";
import {ErrorState,LoadingState,EmptyState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import EvaluationWorkspaceResults from "./EvaluationWorkspaceResults";
import EvaluationRunComparison from "./EvaluationRunComparison";
import { tally, scopeLabel } from "../lib/evaluationPresentation";
import { useActiveDataset } from "../lib/activeDataset";
import DatasetName from "./DatasetName";
import { useDatasetNames } from "../lib/datasetNames";
import { formatNumber } from "../lib/formatters";
import OfflineEvaluationResults from "./OfflineEvaluationResults";
import { useEffect, useState } from "react";
import { phase4Api, type Benchmark, type Evaluation } from "../phase4api";
import { Button } from "./ui/button";
import { AdminPurpose, WhyNothingScored } from "./AdminExtras";
import {
  useEvaluationRows,
  EvaluationResultFilter,
  EvaluationCaseDetails,
  EvaluationResearchSummary,
} from "./EvaluationDiagnostics";
const finished = new Set(["completed", "failed", "cancelled"]);
const pct = (value: number | null | undefined) =>
  value == null
    ? "Not measured"
    : formatNumber(value * 100, { decimals: 1 }) + "%";
export default function EvaluationPage({
  onDatasetChange,
}: {
  onDatasetChange: () => void;
}) {
  const names = useDatasetNames();
  const globalDataset = useActiveDataset();
  const [pageBenchmark, setPageBenchmark] = useState(false);
  useEffect(() => {
    setPageBenchmark(false);
  }, [globalDataset?.activeId]);
  const [mode, setMode] = useState<"offline" | "paid">("offline"),
    [sourceId, setSourceId] = useState("");
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null),
    [history, setHistory] = useState<Evaluation[]>([]),
    [job, setJob] = useState<Evaluation | null>(null),
    [selected, setSelected] = useState<string[]>(["q05", "q06"]),
    [pipeline, setPipeline] = useState("agentic"),
    [spend, setSpend] = useState("0.50"),
    [tokens, setTokens] = useState("100000"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [newRunOpen,setNewRunOpen]=useState(false);
  const [setupOpen, setSetupOpen] = useState(false),
    [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<Evaluation | null>(null);
  useEffect(() => {
    if (job?.status === "completed") setLastCompleted(job);
  }, [job]);
  const pollingJobId=job?.id;
  const active = !!job && !finished.has(job.status);
  const resultsView = useEvaluationRows(job, benchmark?.cases);
  async function load() {
    const [b, runs] = await Promise.all([
      phase4Api.benchmark(),
      phase4Api.evaluations(),
    ]);
    setBenchmark(b);
    setHistory(runs);
  }
  useEffect(() => {
    let current = true;
    Promise.all([phase4Api.benchmark(), phase4Api.evaluations()])
      .then(([b, j]) => {
        if (current) {
          setBenchmark(b);
          setHistory(j);
          setSelected(b.cases.map((c) => c.id));
          const latest =
            j.find((r) => !finished.has(r.status)) ||
            j.find((r) => r.status === "completed");
          setNewRunOpen(!latest);
          const completed = j.find((r) => r.status === "completed");
          if (completed && latest?.id !== completed.id)
            phase4Api
              .evaluation(completed.id)
              .then((detail) => {
                if (current) setLastCompleted(detail);
              })
              .catch((e) => {
                if (current) setError(e.message);
              });
          if (latest)
            phase4Api
              .evaluation(latest.id)
              .then((detail) => {
                if (current) setJob(detail);
              })
              .catch((e) => {
                if (current) setError(e.message);
              });
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!pollingJobId || !active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await phase4Api.evaluation(pollingJobId!);
        if (!current) return;
        setJob(next);
        if (finished.has(next.status)) void load();
        else timer = setTimeout(poll, 600);
      } catch (e) {
        if (current) {
          setError("Progress refresh failed: " + (e as Error).message);
          timer = setTimeout(poll, 2000);
        }
      }
    }
    timer = setTimeout(poll, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [pollingJobId, active]);
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const compatibleSources = history.filter(
    (j) =>
      j.mode !== "offline" &&
      j.pipeline !== "offline" &&
      j.dataset_id === benchmark?.dataset_id &&
      j.version === benchmark?.version &&
      j.dataset_fingerprint === benchmark?.fingerprint,
  );
  const compatible =
    !globalDataset ||
    (!!benchmark?.dataset_id &&
      globalDataset.activeId === benchmark.dataset_id);
  const needsBenchmark = !!globalDataset && !compatible && !pageBenchmark;
  const calls = selected.length * (pipeline === "agentic" ? 3 : 1);
  // "Set up a live check" only opens the existing Live mode of the existing setup. It never starts a run:
  // the spend limit and the confirmation checkbox stay, and nothing is posted from here.
  const openLive = () => {
    if (!benchmark) return;
    setMode("paid");
    setConfirmed(false);
    setSourceId("");
    setSelected(["q05", "q06"]);
    setNewRunOpen(true);
    if (!benchmark.dataset_id || benchmark.verified_count < benchmark.case_count) {
      setSetupOpen(true);
      setNotice("Install the controlled benchmark and verify its references before a live check.");
      return;
    }
    if (needsBenchmark) {
      setNotice("Choose Use benchmark for this page only before a live check.");
      return;
    }
    requestAnimationFrame(() => document.getElementById("evaluation-run-controls")?.scrollIntoView({ block: "start" }));
  };
  return (
    <div className="evaluation-page">
      <PageHeader title={pageLabel("Evaluation center")} description="Check saved answers against reference questions. For developers." />
      <AdminPurpose>to show how often the app's answers match questions whose correct answers are already known.</AdminPurpose>
      {benchmark&&<section className="evaluation-inventory" aria-label="Benchmark inventory"><strong>{formatNumber(benchmark.verified_count)} verified reference questions</strong><span>{formatNumber(benchmark.case_count)} total · {formatNumber(benchmark.pending_count)} pending</span><small>Benchmark inventory, not system accuracy.</small></section>}
      {job && (
        <p className="sr-only" aria-label="Current evaluation state">
          {job.status}
        </p>
      )}
      {job?.error && (
        <ErrorState as="p" className="alert" role="alert">
          {job.error}
        </ErrorState>
      )}
      {benchmark && job && (
        <EvaluationWorkspaceResults
          job={job.status === "completed" ? job : lastCompleted || job}
          benchmark={benchmark}
          onSetUpLive={openLive}
        />
      )}
      {benchmark && !job && (
        <section className="evaluation-empty">
          <h2>No evaluation results yet</h2>
          <WhyNothingScored
            total={benchmark.case_count}
            onLive={openLive}
            onOffline={() => {
              setMode("offline");
              setNewRunOpen(true);
              if (
                !benchmark.dataset_id ||
                benchmark.verified_count < benchmark.case_count
              ) {
                setSetupOpen(true);
                setNotice(
                  "Install the controlled benchmark and verify its references before replay.",
                );
                return;
              }
              if (needsBenchmark) {
                setNotice(
                  "Choose Use benchmark for this page only before starting a replay.",
                );
                return;
              }
              requestAnimationFrame(()=>{document.getElementById("evaluation-run-controls")?.scrollIntoView({block:"start"});document.getElementById("offline-run-button")?.focus()});
            }}
          />
        </section>
      )}
      {globalDataset && benchmark && (
        <section className="benchmark-context" aria-label="Evaluation dataset">
          <h2>Evaluation uses the controlled retail benchmark dataset</h2>
          {(needsBenchmark||!benchmark.dataset_id)&&<p>
            {benchmark.dataset_id ? (
              <DatasetName
                name="Controlled retail benchmark"
                datasetId={benchmark.dataset_id}
              />
            ) : (
              "The controlled benchmark has not been installed."
            )}
          </p>}
          {needsBenchmark &&
            benchmark.dataset_id &&
            !names.unavailable(benchmark.dataset_id) && (
              <Button variant="outline" onClick={() => setPageBenchmark(true)}>
                Use benchmark for this page only
              </Button>
            )}
          {!needsBenchmark && benchmark.dataset_id && (
            <p>
              Using{" "}
              <DatasetName
                name="Controlled retail benchmark"
                datasetId={benchmark.dataset_id}
              />{" "}
              {compatible
                ? "from the global selection."
                : "for this page only. Global selection is unchanged."}
            </p>
          )}
        </section>
      )}
      {benchmark?.dataset_id && (!globalDataset||names.unavailable(benchmark.dataset_id)) && (
        <p>
          <DatasetName
            name="Controlled benchmark"
            datasetId={benchmark.dataset_id}
            provenance
          />
          {names.unavailable(benchmark.dataset_id) &&
            " — Evaluation unavailable. Restore the benchmark in Datasets."}
        </p>
      )}
      {error && (
        <ErrorState as="div" className="alert" role="alert">
          {error}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void action(load)}
          >
            Retry loading
          </Button>
        </ErrorState>
      )}
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {!benchmark && !error && (
        <LoadingState as="div" className="skeleton-block" role="status">
          Loading benchmark registry…
        </LoadingState>
      )}
      {benchmark && (
        <>
          <details className="evaluation-new-run" open={newRunOpen} onToggle={event=>setNewRunOpen(event.currentTarget.open)}><summary>New evaluation</summary>
          <details
            open={setupOpen}
            onToggle={(e) => setSetupOpen(e.currentTarget.open)}
            className="evaluation-setup"
          >
            <summary>Setup and verification</summary>
            <section className="benchmark-overview">
              <div>
                <span className="eyebrow">
                  {benchmark.version.toUpperCase()}
                </span>
                <h2>{benchmark.title}</h2>

                <strong>
                  {formatNumber(benchmark.verified_count)} /{" "}
                  {formatNumber(benchmark.case_count)} verified ·{" "}
                  {formatNumber(benchmark.pending_count)} pending
                </strong>
                <details className="method-note">
                  <summary>About this benchmark</summary>
                  <p>
                    This benchmark uses authored fictional retail data. Its{" "}
                    {formatNumber(benchmark.case_count)} questions measure this
                    system on this benchmark, not general answer accuracy.
                  </p>
                  <p>{benchmark.scope}</p>
                  <p>
                    References are authored separately and never included in
                    retrieval. Verification runs reference SQL without model
                    calls.
                  </p>
                </details>
                <div className="toolbar">
                  <Button
                    variant={benchmark.dataset_id ? "outline" : "default"}
                    disabled={busy || active}
                    onClick={() =>
                      void action(async () => {
                        await phase4Api.installBenchmark();
                        onDatasetChange();
                        await load();
                        setNotice(
                          "Controlled benchmark explicitly installed. Uploaded datasets are not assumed compatible.",
                        );
                      })
                    }
                  >
                    {benchmark.dataset_id
                      ? "Check installation"
                      : "Install controlled benchmark"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      needsBenchmark ||
                      busy ||
                      active ||
                      !benchmark.dataset_id ||
                      names.unavailable(benchmark.dataset_id)
                    }
                    onClick={() =>
                      void action(async () => {
                        setBenchmark(
                          await phase4Api.verifyBenchmark(
                            benchmark.dataset_id!,
                          ),
                        );
                        setNotice(
                          "Reference verification completed. Inspect verified and pending counts.",
                        );
                      })
                    }
                  >
                    {busy ? "Working…" : "Verify benchmark references"}
                  </Button>
                </div>
              </div>
            </section>
          </details>
          <div className="evaluation-setup" id="evaluation-run-controls">
            <section className="evaluation-config">
              <h2>Choose evaluation mode</h2>
              <label>
                Evaluation mode
                <select
                  aria-label="Evaluation mode"
                  value={mode}
                  disabled={active || busy}
                  onChange={(e) => {
                    const next = e.target.value as "paid" | "offline";
                    setMode(next);
                    setConfirmed(false);
                    setSourceId("");
                    setSelected(
                      next === "offline"
                        ? benchmark.cases.map((c) => c.id)
                        : ["q05", "q06"],
                    );
                  }}
                >
                  <option value="offline">
                    Offline replay — 0 new LLM calls
                  </option>
                  <option value="paid">Live — uses API credits</option>
                </select>
              </label>
              {mode === "offline" && (
                <>
                  <div className="usage-preview">
                    <strong className="offline-call-indicator">
                      0 new LLM calls
                    </strong>
                    <p>
                      Replays saved answers. No AI calls. Questions without a
                      saved prediction stay unscored.
                    </p>
                    <details className="method-note">
                      <summary>Matching rules</summary>
                      <p>
                        Question, benchmark version, dataset fingerprint and
                        confirmed types must match. Reference SQL never replaces
                        a missing prediction.
                      </p>
                    </details>
                  </div>
                  <p>
                    Latest uses the newest compatible saved answer for each
                    question; selecting a run restricts replay to that run.
                    Missing answers are never replaced with references.
                  </p>
                  <label>
                    Saved prediction source
                    <select
                      value={sourceId}
                      disabled={active || busy}
                      onChange={(e) => setSourceId(e.target.value)}
                    >
                      <option value="">
                        Latest compatible prediction per question
                      </option>
                      {compatibleSources.map((source) => (
                        <option value={source.id} key={source.id}>
                          {source.model} · {source.pipeline} ·{" "}
                          {formatDate(source.created_at, "datetime")}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!compatibleSources.length && (
                    <p className="insight-note">
                      No compatible saved prediction runs. Offline scoring will
                      report missing predictions, not accuracy.
                    </p>
                  )}
                  <Button
                    id="offline-run-button"
                    disabled={
                      busy ||
                      active ||
                      needsBenchmark ||
                      !benchmark.dataset_id ||
                      names.unavailable(benchmark.dataset_id) ||
                      !selected.length ||
                      selected.some(
                        (id) =>
                          benchmark.cases.find((c) => c.id === id)
                            ?.verification !== "verified",
                      )
                    }
                    onClick={() =>
                      void action(async () => {
                        const next = await phase4Api.evaluateOffline({
                          dataset_id: benchmark.dataset_id!,
                          version: benchmark.version,
                          case_ids: selected,
                          source_evaluation_id: sourceId || null,
                        });
                        setJob(next);
                        setDiagnosticsOpen(false);
                        await load();
                      })
                    }
                  >
                    Start offline replay
                  </Button>
                </>
              )}
              {mode === "paid" && (
                <>
                  {" "}
                  <p>
                    Runs the AI on every selected question. Uses API credits.
                    Cost depends on your provider.
                  </p>
                  <label>
                    Pipeline configuration
                    <select
                      disabled={active || busy}
                      value={pipeline}
                      onChange={(e) => {
                        setPipeline(e.target.value);
                        setConfirmed(false);
                      }}
                    >
                      <option value="baseline">
                        Baseline · schema only · 1 attempt
                      </option>
                      <option value="rag">RAG · 1 attempt</option>
                      <option value="agentic">
                        RAG + agent repair · max 3 attempts
                      </option>
                    </select>
                  </label>
                  <div className="filter-fields">
                    <label>
                      Maximum spend (USD)
                      <input
                        type="number"
                        step="0.01"
                        min="0.000001"
                        max="5"
                        value={spend}
                        disabled={active || busy}
                        onChange={(e) => {
                          setSpend(e.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    <label>
                      Total token reservation limit
                      <input
                        type="number"
                        min="2000"
                        max="500000"
                        step="1000"
                        value={tokens}
                        disabled={active || busy}
                        onChange={(e) => {
                          setTokens(e.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                  </div>
                  <div className="usage-preview">
                    <strong>Up to {formatNumber(calls)} provider calls</strong>
                    <p>
                      {formatNumber(selected.length)} selected questions · at
                      most {formatNumber(calls * 1600)} output tokens ·
                      10-minute deadline · one case at a time.
                    </p>
                    <p>
                      Hard reservation limits: $
                      {formatNumber(Number(spend || 0), { decimals: 2 })} and{" "}
                      {formatNumber(Number(tokens || 0))} total tokens. Input
                      ceilings use a conservative serialized-byte bound before
                      each request. A job can stop early when its next request
                      would exceed either limit.
                    </p>
                    {benchmark.pricing ? (
                      <p>
                        Configured USD / million: input{" "}
                        {benchmark.pricing.input}, output{" "}
                        {benchmark.pricing.output}. Verify current provider
                        prices.
                      </p>
                    ) : (
                      <p className="filter-unavailable">
                        Pricing unknown. Configure LLM_INPUT_USD_PER_MILLION and
                        LLM_OUTPUT_USD_PER_MILLION before running paid
                        evaluations.
                      </p>
                    )}
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={active || busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I authorize paid provider calls within these displayed
                    limits.
                  </label>
                  <Button
                    disabled={
                      busy ||
                      active ||
                      !confirmed ||
                      needsBenchmark ||
                      !benchmark.dataset_id ||
                      names.unavailable(benchmark.dataset_id) ||
                      !benchmark.pricing ||
                      !selected.length ||
                      selected.some(
                        (id) =>
                          benchmark.cases.find((c) => c.id === id)
                            ?.verification !== "verified",
                      )
                    }
                    onClick={() =>
                      void action(async () => {
                        const next = await phase4Api.evaluate({
                          dataset_id: benchmark.dataset_id!,
                          version: benchmark.version,
                          case_ids: selected,
                          pipeline,
                          max_spend_usd: Number(spend),
                          max_total_tokens: Number(tokens),
                          confirm_paid_calls: true,
                        });
                        setJob(next);
                        setDiagnosticsOpen(false);
                        setConfirmed(false);
                        await load();
                      })
                    }
                  >
                    Run evaluation
                  </Button>
                </>
              )}
              <details className="method-note">
                <summary>Scoring methodology</summary>
                <p>{benchmark.comparison_policy}</p>
              </details>
            </section>
            <section className="benchmark-cases">
              <div className="insight-heading">
                <h2>Select questions</h2>
                <span>
                  {formatNumber(selected.length)} /{" "}
                  {mode === "offline" ? 45 : 10} selected
                </span>
              </div>
              <div className="toolbar">
                <Button
                  variant="outline"
                  disabled={active || busy}
                  onClick={() => {
                    setSelected(
                      benchmark.cases
                        .slice(0, mode === "offline" ? 45 : 10)
                        .map((c) => c.id),
                    );
                    setConfirmed(false);
                  }}
                >
                  Select all{mode === "paid" ? " allowed (10)" : ""}
                </Button>
                <Button
                  variant="ghost"
                  disabled={active || busy}
                  onClick={() => {
                    setSelected([]);
                    setConfirmed(false);
                  }}
                >
                  Clear selection
                </Button>
              </div>
              <p>
                {selected.length === benchmark.case_count
                  ? "Full selected question set"
                  : `Partial run: ${formatNumber(selected.length)} of ${formatNumber(benchmark.case_count)} questions`}
              </p>
              <div className="case-list">
                {benchmark.cases.map((c) => (
                  <div className="benchmark-case" key={c.id}>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        disabled={
                          active ||
                          busy ||
                          (!selected.includes(c.id) &&
                            selected.length >= (mode === "offline" ? 45 : 10))
                        }
                        onChange={(e) => {
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, c.id]
                              : s.filter((id) => id !== c.id),
                          );
                          setConfirmed(false);
                        }}
                      />
                      <span>
                        <strong>
                          {c.id} · {c.category}
                        </strong>
                        {c.question}
                        <small>
                          {c.difficulty} · {c.verification} · {c.expectation}
                        </small>
                      </span>
                    </label>
                    {c.verification_reason && c.verification === "pending" && (
                      <small className="filter-unavailable">
                        {c.verification_reason}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
          </details>
          {job && (
            <details
              className="evaluation-legacy"
              open={active || diagnosticsOpen}
              onToggle={(e) => {
                if (!active) setDiagnosticsOpen(e.currentTarget.open);
              }}
            >
              <summary>Detailed diagnostics and exports</summary>
              <p>{scopeLabel(job, benchmark.case_count)}</p>
              {job?.mode === "offline" && (
                <OfflineEvaluationResults
                  job={job}
                  cases={benchmark.cases}
                  onCancel={() =>
                    void action(async () => {
                      await phase4Api.cancelEvaluation(job.id);
                      setNotice(
                        "Offline cancellation requested. No model calls are made.",
                      );
                    })
                  }
                />
              )}
              {job && job.mode !== "offline" && (
                <section
                  className="evaluation-results"
                  aria-label="Evaluation results"
                >
                  <div className="insight-heading">
                    <div>
                      <span className="eyebrow">MEASURED RUN</span>
                      <h2>
                        {job.pipeline} · {job.model}
                      </h2>
                      <p role="status">
                        {job.status} · {formatNumber(job.metrics?.completed_cases || 0)} /{" "}
                        {formatNumber(job.case_ids.length)} completed ·{" "}
                        {formatNumber(job.provider_calls)} provider calls
                      </p>
                    </div>
                    {active && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void action(async () => {
                            await phase4Api.cancelEvaluation(job.id);
                            setNotice(
                              "Cancellation requested; the active operation will stop at its cancellation boundary.",
                            );
                          })
                        }
                      >
                        Cancel evaluation
                      </Button>
                    )}
                  </div>
                  <progress
                    aria-label="Evaluation progress"
                    max={job.case_ids.length}
                    value={job.metrics?.completed_cases || 0}
                  />
                  {job.error && (
                    <ErrorState as="p" className="alert" role="alert">
                      {job.error}
                    </ErrorState>
                  )}
                  <EvaluationResearchSummary job={job} />
                  <div className="metrics-grid">
                    <Metric
                      label="Average attempts"
                      value={`${job.metrics?.average_attempts == null ? "Unknown" : formatNumber(job.metrics.average_attempts, { decimals: 2 })} · n=${job.metrics?.completed_cases ?? 0}`}
                    />
                    <Metric
                      label="p50 / p95 latency"
                      value={`${job.metrics?.p50_latency_ms ?? "—"} / ${job.metrics?.p95_latency_ms ?? "—"} ms`}
                    />
                    <Metric
                      label="Reported tokens"
                      value={`${job.metrics?.total_tokens == null ? "Unknown" : formatNumber(job.metrics.total_tokens)} · ${job.metrics?.usage_sample_size ?? "unknown"} / ${job.metrics?.completed_cases ?? 0} measured`}
                    />
                    <Metric
                      label="Estimated model cost"
                      value={
                        job.metrics?.estimated_cost_usd == null
                          ? "Unknown"
                          : "$" +
                            formatNumber(job.metrics.estimated_cost_usd, {
                              decimals: 6,
                            })
                      }
                    />
                    <Metric
                      label="Reserved ceiling used"
                      value={
                        "$" +
                        formatNumber(job.reserved_cost_usd, { decimals: 6 }) +
                        " · " +
                        job.reserved_tokens +
                        " tokens"
                      }
                    />
                  </div>
                  {job.metrics && (
                    <>
                      <div className="category-bars">
                        {Object.entries(job.metrics.categories).map(
                          ([category, m]) => (
                            <div key={category}>
                              <span>{category}</span>
                              <meter
                                min={0}
                                max={m.total || 1}
                                value={m.correct}
                                aria-label={category + " correctness"}
                              />
                              <strong>
                                {formatNumber(m.correct)}/
                                {formatNumber(m.total)}
                              </strong>
                            </div>
                          ),
                        )}
                      </div>
                      <h3>Difficulty breakdown</h3>
                      <div className="category-bars">
                        {Object.entries(job.metrics.difficulties || {}).map(
                          ([difficulty, m]) => (
                            <div key={difficulty}>
                              <span>{difficulty}</span>
                              <meter
                                min={0}
                                max={m.total || 1}
                                value={m.correct}
                                aria-label={
                                  difficulty + " difficulty correctness"
                                }
                              />
                              <strong>
                                {formatNumber(m.correct)}/
                                {formatNumber(m.total)}
                              </strong>
                            </div>
                          ),
                        )}
                      </div>
                      <p className="insight-note">
                        {job.metrics.diagnostic_note}
                      </p>
                      <div
                        className="latency-chart"
                        aria-label="Latency percentiles"
                      >
                        {[
                          ["p50", job.metrics.p50_latency_ms],
                          ["p95", job.metrics.p95_latency_ms],
                        ].map(([name, v]) => (
                          <div key={name as string}>
                            <span>{name}</span>
                            <i
                              style={{
                                width:
                                  typeof v === "number" &&
                                  job.metrics!.p95_latency_ms
                                    ? `${(v / job.metrics!.p95_latency_ms) * 80}%`
                                    : "0%",
                              }}
                            />
                            <strong>{v ?? "Unknown"} ms</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="toolbar">
                    <a
                      className="button button-outline"
                      href={`/api/evaluations/${job.id}/report.json`}
                      download
                    >
                      Export JSON report
                    </a>
                    <a
                      className="button button-outline"
                      href={`/api/evaluations/${job.id}/report.csv`}
                      download
                    >
                      Export CSV report
                    </a>
                  </div>
                  <EvaluationResultFilter
                    value={resultsView.filter}
                    onChange={resultsView.setFilter}
                    shown={resultsView.rows.length}
                    total={resultsView.total}
                  />
                  {!resultsView.rows.length && (
                    <p className="insight-note">
                      No questions match this filter.
                    </p>
                  )}
                  {resultsView.rows.map((result) => (
                    <details
                      className="evaluation-case-result"
                      key={result.case_id}
                    >
                      <summary>
                        <strong>
                          {result.case_id} · {result.difficulty} ·{" "}
                          {result.correct == null
                            ? "Not evaluated"
                            : result.correct
                              ? "Correct"
                              : "Mismatch"}
                        </strong>{" "}
                        {result.question}
                      </summary>
                      <p>{result.comparison}</p>
                      <EvaluationCaseDetails row={result} job={job} />
                      {result.correct != null && (
                        <CauseReview
                          disabled={active || busy}
                          existing={result.review}
                          onSave={(labels, reason) =>
                            void action(async () =>
                              setJob(
                                await phase4Api.reviewCase(
                                  job.id,
                                  result.case_id,
                                  labels,
                                  reason,
                                ),
                              ),
                            )
                          }
                        />
                      )}
                    </details>
                  ))}
                </section>
              )}
            </details>
          )}
          <EvaluationRunComparison history={history} />
          <section className="evaluation-history">
            <h2>Run history</h2>
            <p className="insight-note">
              In the table, p50 is the typical (median) time and p95 the slow end: 95 of 100 questions were faster.
            </p>
            <p className="insight-note">
              Compare the same benchmark version and selected question IDs.
              Accuracy covers completed selected cases, not automatically all 45
              benchmark questions.
            </p>
            {!history.length ? (
              <EmptyState as="p" className="insight-note">
                No evaluation jobs yet. No accuracy is inferred from normal
                Analyst success.
              </EmptyState>
            ) : (
              <TableFrame label="Benchmark questions">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Pipeline / model</th>
                      <th scope="col">State</th>
                      <th scope="col">Accuracy</th>
                      <th scope="col">p50 / p95</th>
                      <th scope="col">Tokens / cost</th>
                      <th scope="col">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td>
                          {h.mode === "offline"
                            ? "Offline · 0 new LLM calls"
                            : "Live · " + h.pipeline}
                          <small>
                            <DatasetName
                              name="Controlled benchmark"
                              datasetId={h.dataset_id}
                              provenance
                            />{" "}
                            · {h.version} · selected {h.case_ids.join(", ")}
                          </small>
                          <small>
                            {h.model} ·{" "}
                            {formatDate(h.created_at, "datetime")}
                          </small>
                        </td>
                        <td>{h.status}</td>
                        <td>
                          {(() => {
                            const c = h.results ? tally(h) : null;
                            return c
                              ? c.scored
                                ? pct(c.correct / c.scored)
                                : "Not measured"
                              : pct(h.metrics?.accuracy);
                          })()}
                          <small>
                            {formatNumber(
                              h.metrics?.evaluated_count ??
                                (h.metrics?.correct_count != null &&
                                h.metrics?.incorrect_count != null
                                  ? h.metrics.correct_count +
                                    h.metrics.incorrect_count
                                  : 0),
                            )}{" "}
                            / {formatNumber(h.case_ids.length)} selected
                            questions scored
                            <br />
                            {scopeLabel(h, benchmark.case_count)}
                            <br />
                            Source:{" "}
                            {h.mode === "offline"
                              ? h.source_evaluation_id ||
                                "Latest compatible prediction per question"
                              : "Live generated answers"}
                          </small>
                        </td>
                        <td>
                          {h.metrics?.p50_latency_ms ?? "—"} /{" "}
                          {h.metrics?.p95_latency_ms ?? "—"} ms
                        </td>
                        <td>
                          {h.metrics?.total_tokens == null
                            ? "Unknown"
                            : formatNumber(h.metrics?.total_tokens)}{" "}
                          /{" "}
                          {h.metrics?.estimated_cost_usd == null
                            ? "Unknown"
                            : "$" +
                              formatNumber(h.metrics.estimated_cost_usd, {
                                decimals: 6,
                              })}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void action(async () =>
                                setJob(await phase4Api.evaluation(h.id)),
                              )
                            }
                          >
                            Inspect run
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!finished.has(h.status) || busy}
                            onClick={() =>
                              void action(async () => {
                                await phase4Api.deleteEvaluation(h.id);
                                if (job?.id === h.id) setJob(null);
                                await load();
                              })
                            }
                          >
                            Delete record
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <small>{label}</small>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}

function CauseReview({
  onSave,
  disabled,
  existing,
}: {
  onSave: (labels: string[], reason: string) => void;
  disabled: boolean;
  existing?: { labels: string[]; reason: string };
}) {
  const [labels, setLabels] = useState<string[]>(existing?.labels || []),
    [reason, setReason] = useState(existing?.reason || "");
  return (
    <details className="cause-review">
      <summary>Review error causes independently</summary>
      <p className="insight-note">
        Inspect the question, predicted SQL, gold contract and outputs first.
        These are human annotations, separate from automatic structural hints.
        Leave all labels unchecked if none apply.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(labels, reason);
        }}
      >
        {[
          "wrong_join",
          "wrong_filter",
          "wrong_aggregation",
          "hallucinated_column",
          "hallucinated_table",
          "other",
        ].map((label) => (
          <label className="inline-check" key={label}>
            <input
              type="checkbox"
              checked={labels.includes(label)}
              disabled={disabled}
              onChange={(e) =>
                setLabels((current) =>
                  e.target.checked
                    ? [...current, label]
                    : current.filter((l) => l !== label),
                )
              }
            />
            {label.replaceAll("_", " ")}
          </label>
        ))}
        <label>
          Review rationale
          <textarea
            required
            minLength={5}
            maxLength={800}
            disabled={disabled}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={disabled || reason.trim().length < 5}
        >
          Save independent review
        </Button>
      </form>
    </details>
  );
}
