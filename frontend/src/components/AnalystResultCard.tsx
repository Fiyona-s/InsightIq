import { displayAmount, displayExact } from "../lib/displayNumber";
import { formatNumber } from "../lib/formatters";
import { ErrorState, LoadingState } from "./WorkspaceStates";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  insightApi,
  type AnalystRun,
  type AnalystResults,
  type Analysis,
  type ChartData,
} from "../api";
import { CurrencyControls, useCurrency, displayMoney } from "../lib/currency";
import {
  answerSentence,
  leadSentence,
  findings,
  calculationSteps,
  humanLabel,
} from "../lib/analystPresentation";
import { SQLCode, WorkflowInspector, RetrievalPanel } from "./RunInsights";
import { useAdminTools } from "../lib/adminTools";
import { useTechnicalDetails } from "../lib/technicalDetails";
import ResultDataTable from "./ResultDataTable";
import SaveChartDialog from "./SaveChartDialog";
import { Menu } from "./ui/menu";
import { openCurrencySettings } from "./DatasetCurrency";
import { Tabs } from "./ui/tabs";
import { reviewApi } from "../knowledgeReviewApi";
import AnalystFeedback from "./AnalystFeedback";
import { Button } from "./ui/button";
import { Card } from "./ui/layout";
const ResultChart = lazy(() => import("./ResultChart"));
export default function AnalystResultCard({
  run,
  results,
  offset = 0,
  onOffset = () => {},
  onRerun,
}: {
  run: AnalystRun;
  results?: AnalystResults | null;
  offset?: number;
  onOffset?: (n: number) => void;
  /** Run this question again on the current data (no AI call). */
  onRerun?: (run: AnalystRun) => void;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [chart, setChart] = useState<ChartData | null>(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(""),
    [attempt, setAttempt] = useState(0),
    [dialog, setDialog] = useState<"pin" | "library" | null>(null),
    [detailsOpen, setDetailsOpen] = useState(false),
    [tab, setTab] = useState<"data" | "sql" | "how" | "admin">("data");
  const currency = useCurrency(run.id);
  const adminTools = useAdminTools();
  const [technical] = useTechnicalDetails();
  useEffect(() => {
    let current = true;
    setAnalysis(null);
    setChart(null);
    setError("");
    insightApi
      .analysis(run.id)
      .then((a) => {
        if (current) {
          setAnalysis(a);
          setChart(a.charts.recommended);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [run.id, attempt]);
  if (!analysis || !chart)
    return error ? (
      <ErrorState details={error}>
        Could not prepare this saved result.{" "}
        <Button
          variant="outline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry result display
        </Button>
      </ErrorState>
    ) : (
      <LoadingState as="p">Preparing your result…</LoadingState>
    );
  const data = results || {
    columns: run.result_metadata?.columns || [],
    rows: [],
    row_count: run.result_metadata?.row_count || 0,
    offset: 0,
    expires_in_seconds: 0,
  };
  const summaryData = offset
    ? {
        ...data,
        rows:
          chart.spec.kind === "kpi"
            ? [[chart.points[0]?.value ?? null]]
            : data.rows,
      }
    : data;
  const baseAnswer = answerSentence(summaryData, currency, run.executed_sql || run.sql || undefined),
    notes = findings(data, chart, analysis.evidence.facts, currency),
    answer = leadSentence(baseAnswer, notes, summaryData, currency);      // one lead sentence: the top finding completes it instead of repeating below
  const scalar =
    chart.spec.kind === "kpi" &&
    summaryData.row_count === 1 &&
    summaryData.columns.length === 1 &&
    summaryData.rows.length > 0 &&
    summaryData.rows[0][0] != null;
  const value = scalar
    ? displayAmount(
        summaryData.rows[0][0],
        data.columns[0].money,
        currency,
        data.columns[0].type,
        data.columns[0].percent,
      )
    : "";
  const valueAt = scalar ? answer.lastIndexOf(value) : -1;
  // Checkable facts instead of a blanket claim: which file, how many rows, and whether the owner's
  // confirmed column types were applied (Stage 3, D4).
  const sourceNote = [
    run.dataset_name ? `From ${run.dataset_name}` : "",
    `${formatNumber(data.row_count)} result ${data.row_count === 1 ? "row" : "rows"}`,
    (run.conversions || []).length > 0 ? "using the column types you confirmed" : "",
  ].filter(Boolean).join(" · ");
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("Copy unavailable; select the text to copy.");
    }
  }
  return (
    <Card className="analyst-result-card" aria-label="Result insights">
      <div className="insight-heading">
        <div className={scalar ? "result-kpi" : "result-answer"}>
          <h2 className="answer-sentence" aria-label={answer}>
            {scalar && valueAt >= 0 ? (
              <>
                {answer.slice(0, valueAt)}
                <strong title={`Original value: ${summaryData.rows[0][0]}`}>
                  {value}
                </strong>
                {answer.slice(valueAt + value.length)}
              </>
            ) : (
              answer
            )}
          </h2>
          <p className="result-source-note">{sourceNote}</p>
        </div>
      </div>
      {error && <ErrorState as="p">{error}</ErrorState>}
      {data.row_count > 0 && chart.spec.kind !== "table" && !scalar && !(data.row_count === 1 && data.columns.length > 1) && (
        <Suspense
          fallback={<LoadingState as="p">Loading visualization…</LoadingState>}
        >
          <ResultChart
            data={{
              ...chart,
              spec: { ...chart.spec, title: humanLabel(chart.spec.title) },
            }}
            displayId={run.id}
          />
        </Suspense>
      )}
      {!!notes.length && !answer.includes(notes[0].text) && !/tied for highest|are tied|all \d+ are/.test(answer) && (
        <section className="analyst-findings" aria-label="Findings">
          {notes.slice(0, 3).map((n) => (
            <p key={n.id} data-fact-id={n.id}>
              {n.text}
            </p>
          ))}
        </section>
      )}
      <div className="analyst-result-actions">
        <Button onClick={() => setDialog("pin")}>Pin to dashboard</Button>
        <Button variant="ghost" onClick={() => void copy(answer, "Answer copied")}>Copy answer</Button>
        <Menu
          label="More result actions"
          items={[
            { label: "Download CSV", href: `/api/analyst/runs/${run.id}/results.csv`, download: true, title: "Exports original source values" },
            ...(onRerun ? [{ label: "Run again on current data", onSelect: () => onRerun(run) }] : []),
            ...(run.activity_kind !== "evaluation" ? [{
              label: "Propose as verified example",
              onSelect: () => void reviewApi.propose(run.dataset_id, run.id)
                .then(() => setCopied("Candidate proposed. Review it in Business definitions with an independent reference."))
                .catch((e) => setError(e.message)),
            }] : []),
          ]}
        />
        <AnalystFeedback runId={run.id} />
        <label className="viz-picker">
          Visualization
          <select
            aria-label="Visualization type"
            value={chart.spec.kind}
            onChange={(e) => {
              const spec = analysis.charts.options.find(
                (s) => s.kind === e.target.value,
              );
              if (e.target.value === "table") { setTab("data"); setDetailsOpen(true); }
              if (spec)
                void insightApi
                  .chart(run.id, spec)
                  .then(setChart)
                  .catch((e) => setError(e.message));
            }}
          >
            {analysis.charts.options.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.kind === "kpi" ? "KPI" : humanLabel(s.kind)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(() => {
        const codes = Array.from(new Set(data.columns.filter((c) => c.money?.currency && !c.money.mixed).map((c) => c.money!.currency)));
        return codes.length ? (
          <p className="currency-note">
            Amounts are in {codes.join(", ")}.{" "}
            <Button variant="ghost" onClick={() => { openCurrencySettings(); window.location.hash = "#knowledge"; }}>Change currency</Button>
          </p>
        ) : null;
      })()}
      <CurrencyControls
        id={run.id}
        columns={data.columns}
        exportUrl={`/api/analyst/runs/${run.id}/results.csv`}
      />
      <details className="result-details" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
        <summary>Show details</summary>
        <Tabs
          label="Result details"
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          panelId="result-details-panel"
          items={[
            { value: "data", label: "Data", id: "result-tab-data" },
            ...(technical ? [{ value: "sql", label: "SQL", id: "result-tab-sql" }] : []),
            { value: "how", label: "How this was calculated", id: "result-tab-how" },
            ...(adminTools.enabled ? [{ value: "admin", label: "Execution (admin)", id: "result-tab-admin" }] : []),
          ]}
        />
        <div role="tabpanel" id="result-details-panel" aria-labelledby={`result-tab-${tab}`} className="result-detail-panel">
          {tab === "data" && (
            <ResultDataTable result={data} runId={run.id} offset={offset} onOffset={onOffset} />
          )}
          {tab === "sql" && technical && (
            <div className="sql-viewer">
              <Button variant="ghost" onClick={() => void copy(run.executed_sql || run.sql || "", "SQL copied")}>Copy SQL</Button>
              <pre><SQLCode sql={run.executed_sql || run.sql || ""} /></pre>
            </div>
          )}
          {tab === "how" && (
            <div className="calculation-details">
              <ol>
                {calculationSteps(data.row_count, run.executed_sql || "", (run.conversions || []).length > 0).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {analysis.evidence.facts
                .filter((f) => ["total", "average", "minimum", "maximum"].includes(f.method))
                .slice(0, data.row_count === 1 ? 1 : 4) /* one row: total, average, minimum and maximum are the same number */
                .map((f) => (
                  <p key={f.id} data-fact-id={f.id}>
                    {humanLabel(data.columns[f.source.columns[0]]?.name || "Result")}
                    : {data.row_count === 1 ? "the value" : (f.method === "total" ? "total" : f.method) + " of returned values"} is{" "}
                    {displayExact(f.value, data.columns[f.source.columns[0]]?.money, currency, data.columns[f.source.columns[0]]?.type, data.columns[f.source.columns[0]]?.percent)}.
                  </p>
                ))}
            </div>
          )}
          {tab === "admin" && adminTools.enabled && (
            <div className="execution-details">
              {analysis.evidence.facts.map((f) => (
                <article className="evidence-fact" key={f.id}>
                  <p>{f.statement}</p>
                  <pre>{JSON.stringify(f.source, null, 2)}</pre>
                </article>
              ))}
              <WorkflowInspector run={run} />
              {run.retrieval && <RetrievalPanel retrieval={run.retrieval} />}
            </div>
          )}
        </div>
      </details>
      <SaveChartDialog
        key={run.id + (dialog ?? "closed")}
        run={run}
        spec={chart.spec}
        mode={dialog ?? "pin"}
        open={dialog !== null}
        onClose={() => setDialog(null)}
        onDone={setCopied}
        titleHint={humanLabel(chart.spec.title)}
      />
      {copied && <p role="status">{copied}</p>}
    </Card>
  );
}
