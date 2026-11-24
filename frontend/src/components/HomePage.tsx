import { useAuth } from "../lib/auth";
import { asAnalytics, hostedRuns } from "../lib/runActivity";
import { Card } from "./ui/layout";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  LayoutDashboard,
  UploadCloud,
} from "lucide-react";
import { useActiveDataset } from "../lib/activeDataset";
import { formatDate, formatNumber } from "../lib/formatters";
import { displayName } from "../lib/datasetNames";
import { analystUXApi, type Suggestion } from "../analystUXApi";
import { phase4Api, type Analytics, type DashboardSummary } from "../phase4api";
import type { Dataset, AnalystRun } from "../api";
import DatasetName from "./DatasetName";
import ActiveDatasetSelector from "./ActiveDatasetSelector";
import SetupGuide from "./SetupGuide";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, LoadingState } from "./WorkspaceStates";

type Props = {
  datasets: Dataset[];
  onNavigate: (page: string) => void;
  onOpenRun?: (run: AnalystRun) => Promise<void>;
  onOpenDashboard?: (id: string) => void;
  /** Open Ask with this question typed in. Never runs it: types are confirmed on the Ask page first. */
  onAsk?: (question: string) => void;
  /** Empty workspace: open the import window (the owner lands on Ask when the file is in). */
  onUpload?: () => void;
  /** Empty workspace: add the built-in sample file, only when this is pressed. */
  onSample?: () => void;
  sampleBusy?: boolean;
};
export default function HomePage({
  datasets,
  onNavigate,
  onOpenRun,
  onOpenDashboard,
  onAsk,
  onUpload,
  onSample,
  sampleBusy,
}: Props) {
  const context = useActiveDataset(),
    active = context
      ? context.active
      : datasets.find((d) => !d.archived_at) || null;
  const [analytics, setAnalytics] = useState<Analytics | null>(null),
    [dashboards, setDashboards] = useState<DashboardSummary[] | null>(null),
    [errors, setErrors] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0),
    [opening, setOpening] = useState(""),
    [question, setQuestion] = useState(""),
    [suggestions, setSuggestions] = useState<Suggestion[]>([]),
    [suggestionsFor, setSuggestionsFor] = useState<string | null>(null);
  const hosted = useAuth().hosted;
  const activeId = active?.id;
  // True from the first paint of a new dataset until its suggestions arrive (reserves their space).
  const suggestionsLoading = !!activeId && suggestionsFor !== activeId;
  useEffect(() => {
    setSuggestions([]);
    if (!activeId) return;
    let current = true;
    void Promise.resolve(analystUXApi.suggestions(activeId)).then((items) => { if (current) setSuggestions(items); }).catch(() => {}).finally(() => { if (current) setSuggestionsFor(activeId); });
    return () => { current = false; };
  }, [activeId]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setErrors([]);
    Promise.allSettled([hosted ? hostedRuns().then(asAnalytics) : phase4Api.analytics({ limit: "30", compact: "true" }), phase4Api.dashboards()]).then(
      ([runs, boards]) => {
        if (!current) return;
        setAnalytics(runs.status === "fulfilled" ? runs.value : null);
        setDashboards(boards.status === "fulfilled" ? boards.value : null);
        setErrors(
          [runs, boards].flatMap((r) =>
            r.status === "rejected"
              ? [
                  r.reason instanceof Error
                    ? r.reason.message
                    : String(r.reason),
                ]
              : [],
          ),
        );
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [retry, hosted]);
  const benchmarkIds = new Set((context?.datasets || datasets).filter((d) => d.is_benchmark).map((d) => d.id));
  const available = datasets.filter((d) => !d.archived_at && !d.is_benchmark),
    demo = available.find(
      (d) => d.is_sample,
    ),
    completed = (analytics?.recent || [])
      .filter(
        (r) =>
          r.activity_kind !== "evaluation" &&
          !benchmarkIds.has(r.dataset_id) &&
          r.status === "succeeded",
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    // Identical questions on the same dataset are shown once, "asked 2x" (display only: every run stays in the history).
    recent = completed.reduce<{ run: AnalystRun; count: number; key: string }[]>((groups, run) => {
      const key = run.dataset_id + "|" + run.question.trim().replace(/\s+/g, " ").toLowerCase();
      const found = groups.find((g) => g.key === key);
      if (found) found.count += 1; else groups.push({ run, count: 1, key });
      return groups;
    }, []).slice(0, 3);
  // One source for every listed question (the active dataset): name it once in the box above, not on every line.
  const sameSource = recent.length > 0 && recent.every((r) => r.run.dataset_id === recent[0].run.dataset_id) && recent[0].run.dataset_id === active?.id;
  async function openRun(run: AnalystRun) {
    setOpening(run.id);
    try {
      if (onOpenRun) await onOpenRun(run);
      else onNavigate("AI Analyst");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setOpening("");
    }
  }
  return (
    <div className="home-page">
      <h1 className="sr-only">Home</h1>
      {errors.length > 0 && (
        <ErrorState details={errors.join("\n")}>
          Some workspace information could not load.{" "}
          <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>
            Try again
          </Button>
        </ErrorState>
      )}
      {context?.loading ? (
        <LoadingState>Loading your workspace…</LoadingState>
      ) : active ? (
        <Card className="home-ask" aria-label="Ask a question">
          <h2>What do you want to know?</h2>
          <form
            className="home-ask-box"
            onSubmit={(event) => {
              event.preventDefault();
              if (!question.trim()) return;
              if (onAsk) onAsk(question.trim());
              else onNavigate("AI Analyst");
            }}
          >
            <label htmlFor="home-question" className="sr-only">Your question</label>
            <input
              id="home-question"
              type="text"
              value={question}
              maxLength={2000}
              placeholder={`Ask a question about ${displayName(active)}`}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div className="home-ask-bar">
              {context?.datasets && <ActiveDatasetSelector />}
              <Button type="submit" disabled={!question.trim()}>Ask now <ArrowRight size={16} aria-hidden="true" /></Button>
            </div>
          </form>
          {suggestionsLoading && suggestions.length === 0 && (
            <div className="home-suggestions" aria-hidden="true">
              {[0, 1, 2].map((i) => <span key={i} className="home-suggestion-placeholder" />)}
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="home-suggestions" role="group" aria-label="Suggested questions">
              <span className="home-suggestions-label">Suggested</span>
              {suggestions.slice(0, 3).map((item) => (
                <Button key={item.question} variant="outline" title={item.question} onClick={() => setQuestion(item.question)}>{item.question}</Button>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card className="home-welcome" aria-label="Welcome">
          <UploadCloud size={32} aria-hidden="true" />
          <h2>Add your data to get started</h2>
          <p>Upload a CSV file, then ask a question in plain English.</p>
          <div className="home-welcome-actions">
            <Button onClick={() => (onUpload ? onUpload() : onNavigate("Data workspace"))}>
              Upload a dataset
            </Button>
            <Button
              variant="outline"
              disabled={sampleBusy}
              onClick={() => {
                if (demo) void context?.select(demo.id).then((selected) => { if (selected) onNavigate("AI Analyst"); });
                else if (onSample) onSample();
                else onNavigate("Data workspace");
              }}
            >
              {demo ? "Use sample data" : "Try sample data"}
            </Button>
          </div>
          <p className="home-sample-note">Sample data, not your business. It is only added if you press the button.</p>
          {context?.datasets?.some(dataset=>dataset.archived_at) && <p className="home-restore-hint">
            Restore archived data in Datasets, or upload a new dataset.
          </p>}
        </Card>
      )}
      {!context?.loading && (active || loading || errors.length > 0 || !!analytics?.recent.length || !!dashboards?.length) && <div className="home-content-grid">
        <Card className="home-section" aria-label="Saved dashboards">
          <div className="home-section-heading">
            <h2>Dashboards</h2>
          </div>
          {loading ? (
            <LoadingState>Loading dashboards…</LoadingState>
          ) : !dashboards ? (
            <EmptyState>Dashboards are unavailable.</EmptyState>
          ) : dashboards.length ? (
            <ul className="home-row-list">
              {[...dashboards]
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .slice(0, 3)
                .map((board) => (
                  <li key={board.id} className="home-row">
                    <LayoutDashboard size={18} aria-hidden="true" />
                    <span className="home-row-main">
                      <button
                        type="button"
                        className="home-row-hit"
                        aria-label={"Open dashboard " + board.title}
                        onClick={() =>
                          onOpenDashboard
                            ? onOpenDashboard(board.id)
                            : onNavigate("Dashboards")
                        }
                      >
                        {board.title}
                      </button>
                      <span className="home-row-meta">Updated {formatDate(board.updated_at, "date")}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </li>
                ))}
            </ul>
          ) : (
            <EmptyState>
              Pin an answer from Ask to build your first dashboard.
            </EmptyState>
          )}
        </Card>
        <Card className="home-section" aria-label="Recent questions">
          <div className="home-section-heading">
            <h2>Recent questions</h2>
          </div>
          {loading ? (
            <LoadingState>Loading recent questions…</LoadingState>
          ) : !analytics ? (
            <EmptyState>Recent questions are unavailable.</EmptyState>
          ) : recent.length ? (
            <ul className="home-row-list">
              {recent.map(({ run, count }) => {
                const sourceAvailable = available.some((d) => d.id === run.dataset_id);
                const meta = (
                  <span className="home-row-meta">
                    {!sameSource && (<><DatasetName datasetId={run.dataset_id} name={run.dataset_name} provenance />{" · "}</>)}
                    {formatDate(run.created_at)}
                    {count > 1 && <>{" · "}asked {count}x</>}
                  </span>
                );
                return (
                  <li key={run.id} className={sourceAvailable ? "home-row" : "home-row home-row-static"}>
                    <span className="home-row-main">
                      {sourceAvailable ? (
                        <button type="button" className="home-row-hit home-question" disabled={!!opening} aria-busy={opening === run.id} onClick={() => void openRun(run)}>
                          {run.question}
                        </button>
                      ) : (
                        <strong className="home-question">{run.question}</strong>
                      )}
                      {meta}
                      {!sourceAvailable && <small>Source unavailable · history retained</small>}
                    </span>
                    {sourceAvailable && <ChevronRight size={16} aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>
              {analytics.recent.length
                ? "No completed questions yet. Failed and stopped ones are listed in Ask under Recent questions."
                : "Your completed questions will appear here."}
            </EmptyState>
          )}
        </Card>
      </div>}
      {!!active && !loading && completed.length === 0 && <SetupGuide onNavigate={onNavigate} />}      {/* gone after the first answer */}
    </div>
  );
}
