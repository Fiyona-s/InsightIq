import {Card,PageHeader} from "./ui/layout";
import {pageLabel,pageTitle} from "../lib/navigation";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import {useActiveDataset,useDatasetGuard} from "../lib/activeDataset";
import {errorReason} from "../lib/analystPresentation";
import {analystUXApi,type Suggestion} from "../analystUXApi";
import {useRef} from "react";
import DatasetName from "./DatasetName";
import ActiveDatasetSelector from "./ActiveDatasetSelector";
import { useStillWorking } from "../lib/stillWorking";
import {displayName} from "../lib/datasetNames";
import { middleEllipsis } from "../lib/filenames";
import { formatNumber } from "../lib/formatters";
import RunInsights, {
  RetrievalPanel,
  WorkflowInspector,
  SQLCode,
} from "./RunInsights";
import { useRunEvents } from "./useRunEvents";
import { useTechnicalDetails } from "../lib/technicalDetails";
import { insightApi, type AgentEvent, type KnowledgeSettings } from "../api";
import { readDefaultCurrency } from "../lib/defaultCurrency";
import { suggestUnit, type UnitChoice } from "../lib/unitSuggestions";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Database,
  Download,
  Loader2,
  Send,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import {
  analystApi,
  type AnalysisType,
  type AnalystRun,
  type AnalystResults,
  type Dataset,
  type TypeProfile, type ConfirmedTypes} from "../api";
import { Button } from "./ui/button";
import PanelLayout from "./PanelLayout";
import AskPanel from "./AskPanel";
import { ANALYSIS_TYPES, typeLabel } from "../lib/typeLabels";
const terminal = new Set(["succeeded", "failed", "cancelled", "clarification"]);
export default function Analyst({
  datasets,
  initialDataset,
  initialRunId,
  initialQuestion,
  onQuestionUsed,
  onWorkspace,
}: {
  datasets: Dataset[];
  initialDataset: string | undefined;
  initialRunId?: string;
  /** Typed in from Home. It is only placed in the box; the owner still confirms types and presses Analyze. */
  initialQuestion?: string;
  onQuestionUsed?: () => void;
  onWorkspace: () => void;
}) {
  const globalDataset=useActiveDataset();
  const [technical]=useTechnicalDetails();
  const globalId=globalDataset?.activeId,hasGlobal=!!globalDataset,viewProfile=globalDataset?.viewProfile;
  const resultRunId=useRef<string|undefined>(undefined);
  const thread=useRef<string>(crypto.randomUUID());
  const [turns,setTurns]=useState<AnalystRun[]>([]),[suggestions,setSuggestions]=useState<Suggestion[]>([]);
  const [datasetId, setDatasetId] = useState(
    globalId ?? initialDataset ?? datasets[0]?.id ?? "",
  );
  const [profile, setProfile] = useState<TypeProfile | null>(null),
    [profileLoading, setProfileLoading] = useState(false),
    [profileError, setProfileError] = useState("");
  const [mapping, setMapping] = useState<Record<string, AnalysisType>>({}),
    [confirmed, setConfirmed] = useState(false),
    // Approved fix 3a: when the remembered confirmation was made, or a notice that it no longer applies.
    [remembered, setRemembered] = useState<{ at: string | null; stale: boolean; error?: string } | null>(null),
    [question, setQuestion] = useState(""),
    // True once the "remembered types" lookup has answered, so the type card opens (or stays shut) without a jump.
    [typesChecked, setTypesChecked] = useState(false);
  // Owner-confirmed units (2026-11-20): what each number column is. Name hints only pre-select a suggestion.
  const [units, setUnits] = useState<Record<string, UnitChoice>>({}),
    [storedSettings, setStoredSettings] = useState<KnowledgeSettings | null>(null),
    [unitsDirty, setUnitsDirty] = useState(false),
    [unitsError, setUnitsError] = useState("");
  const unitsTouched = useRef<Set<string>>(new Set());   // columns the owner already changed by hand
  const [run, setRun] = useState<AnalystRun | null>(null),
    [history, setHistory] = useState<AnalystRun[]>([]),
    [historyError, setHistoryError] = useState("");
  const [historyMore, setHistoryMore] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(""),
    [cancelRequested, setCancelRequested] = useState(false);
  const [results, setResults] = useState<AnalystResults | null>(null),
    [offset, setOffset] = useState(0),
    [resultError, setResultError] = useState(""),
    [resultLoading, setResultLoading] = useState(false);
  useDatasetGuard("analyst-submitting",()=>submitting?{title:"Starting your question",message:"Wait for submission to finish before switching datasets.",blocked:true}:null);
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;
  const numericTypes = new Set(["BIGINT", "DOUBLE"]);
  const numericColumns = (profile?.columns || []).filter((c) => numericTypes.has(mapping[c.name] || "VARCHAR") || numericTypes.has(c.storage_type));
  const offered = readDefaultCurrency();
  const unitsStored = !!storedSettings?.units_confirmed;
  async function saveUnits() {
    if (!datasetId || !storedSettings || !numericColumns.length) return;
    const money = { ...(storedSettings.monetary_columns || {}) };
    const percents = new Set(storedSettings.percent_columns || []);
    for (const c of numericColumns) {
      const choice = units[c.name] || "neither";
      percents.delete(c.name);
      if (choice === "money") { if (!money[c.name]?.currency && offered) money[c.name] = { currency: offered, mixed: false }; }
      else delete money[c.name];
      if (choice === "percent") percents.add(c.name);
    }
    const next: KnowledgeSettings = { ...storedSettings, monetary_columns: money, percent_columns: Array.from(percents), units_confirmed: true };
    try {
      const saved = await insightApi.saveKnowledge(datasetId, next);
      setStoredSettings(saved?.settings ?? next);
      setUnitsDirty(false); setUnitsError("");
    } catch { setUnitsError("Your number choices could not be saved. Try again, or set them in Business definitions."); }
  }
  function confirmTypes(checked: boolean) {
    setConfirmed(checked);
    if (!datasetId || !profile) return;
    if (checked) {
      if (!unitsStored || unitsDirty) void saveUnits();
      const full = Object.fromEntries(profile.columns.map((c) => [c.name, mapping[c.name] || "VARCHAR"])) as Record<string, AnalysisType>;
      Promise.resolve().then(() => analystApi.confirmTypes(datasetId, full))
        .then((saved) => setRemembered({ at: saved?.confirmed_at ?? null, stale: false }))
        .catch(() => setRemembered({ at: null, stale: false, error: "These types are confirmed for now but could not be remembered for next time." }));
    } else {
      setRemembered(null);
      Promise.resolve().then(() => analystApi.forgetTypes(datasetId)).catch(() => {});
    }
  }
  const active = !!run && !terminal.has(run.status),
    converting = Object.values(mapping).some((t) => t !== "VARCHAR");
  const dataset = datasets.find((d) => d.id === datasetId);
  // First visit: some column looks like a number or date but the owner has not confirmed anything yet.
  const needsTypeCheck = !!profile && !confirmed && !remembered && profile.columns.some((c) => c.suggested_type !== "VARCHAR");
  const onStep = useCallback(
    (event: AgentEvent) =>
      setRun((current) => {
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
  const runId = run?.id;
  const onComplete = useCallback(() => {
    if (runId)
      void analystApi
        .run(runId)
        .then((next) => {
          setRun((current) => (current?.id === next.id ? next : current));
          setCancelRequested(false);
          void refreshHistory(next.dataset_id);
        })
        .catch(() => {});
  }, [runId]);
  const connection = useRunEvents(runId, active, onStep, onComplete);

  useEffect(()=>{if(globalId!==undefined&&globalId!==datasetId){setDatasetId(globalId);setOffset(0);setResults(null);setError("")}},[globalId,datasetId]);
  const pollingRunId=run?.id,resultStatus=run?.status,resultAvailable=run?.results_available;
  useEffect(() => {
    if (!hasGlobal && !datasetId && datasets.length)
      setDatasetId(initialDataset || datasets[0].id);
  }, [datasets, datasetId, initialDataset,hasGlobal]);
  const historyDataset=useRef(datasetId);historyDataset.current=datasetId;
  async function refreshHistory(id: string) {
    try {
      const records = await analystApi.history(id);
      if(historyDataset.current!==id)return;
      setHistory(records);
      setHistoryMore(records.length === 30);
      setHistoryError("");
    } catch (e) {
      setHistoryError((e as Error).message);
    }
  }
  async function earlierRuns() {
    setHistoryLoading(true);
    try {
      const records = await analystApi.history(datasetId, history.length);
      setHistory((h) => [
        ...h,
        ...records.filter((r) => !h.some((old) => old.id === r.id)),
      ]);
      setHistoryMore(records.length === 30);
      setHistoryError("");
    } catch (e) {
      setHistoryError((e as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }
  useEffect(() => {
    let current = true;
    setRun(null);
    setTurns([]);thread.current=crypto.randomUUID();setQuestion("");
    setSuggestions([]);
    if(datasetId)void analystUXApi.suggestions(datasetId).then(items=>{if(current)setSuggestions(items)}).catch(()=>{});
    setProfile(null);
    setMapping({});
    setConfirmed(false);
    setRemembered(null);
    setProfileError("");
    setHistory([]);
    setHistoryMore(false);
    if (!datasetId) return;
    setTypesChecked(false);
    unitsTouched.current = new Set();
    // A slow "remembered types" lookup must never hide the type card for long.
    const safety = window.setTimeout(() => { if (current) setTypesChecked(true); }, 5000);
    setProfileLoading(true);
    analystApi
      .profile(datasetId)
      .then((p) => {
        if (current) {setProfile(p);viewProfile?.(datasetId)}
        // The owner's confirmed units for this dataset (money / percentage), or name hints as suggestions.
        let knowledgeRequest: Promise<unknown> | null = null;
        try { knowledgeRequest = Promise.resolve(insightApi.knowledge(datasetId)); } catch { knowledgeRequest = null; }
        void knowledgeRequest?.then((k) => {
          if (!current || !k || typeof k !== "object" || !(k as { settings?: KnowledgeSettings }).settings) return;
          const s = (k as { settings: KnowledgeSettings }).settings;
          setStoredSettings(s);
          // A choice the owner already made (confirmed, or a currency set by hand earlier) wins over a name hint.
          const stored = (n: string): UnitChoice | null => s.percent_columns?.includes(n) ? "percent" : s.monetary_columns?.[n]?.currency && !s.monetary_columns[n].mixed ? "money" : null;
          // Name hints never offer Money when no currency is offered (Settings: None).
          const hint = (n: string): UnitChoice => { const g = suggestUnit(n); return g === "money" && !readDefaultCurrency() ? "neither" : g; };
          // Settings that arrive late must not overwrite a choice the owner has already made.
          setUnits((current) => Object.fromEntries(p.columns.map((c) => [c.name, unitsTouched.current.has(c.name) && current[c.name] ? current[c.name] : stored(c.name) ?? (s.units_confirmed ? "neither" : hint(c.name))])) as Record<string, UnitChoice>);
          setUnitsDirty(false);
        }).catch(() => { /* units stay unconfirmed: bare numbers */ });
        // Pre-fill types the owner explicitly confirmed earlier for this dataset (3a). Never
        // overrides a mapping that is already set (e.g. an opened saved question).
        let request: Promise<ConfirmedTypes>;
        try { request = analystApi.confirmedTypes(datasetId); } catch { if (current) setTypesChecked(true); return; }
        void Promise.resolve(request).then((saved) => {
          if (!current || !saved || typeof saved !== "object") return;
          const names = p.columns.map((c) => c.name);
          const map = saved.type_mapping;
          const matches = !!map && saved.current === true && names.length === Object.keys(map).length && names.every((n) => n in map);
          if (matches && Object.keys(mappingRef.current).length === 0) {
            setMapping(map!);
            setConfirmed(true);
            setRemembered({ at: saved.confirmed_at, stale: false });
          } else if (saved.current === false && saved.confirmed_at) {
            setRemembered({ at: saved.confirmed_at, stale: true });
          }
        }).catch(() => { /* Optional memory: fall back to confirming by hand. */ }).finally(() => { if (current) setTypesChecked(true); });
      })
      .catch((e) => {
        if (current) setProfileError(e.message);
      })
      .finally(() => {
        if (current) setProfileLoading(false);
      });
    analystApi
      .history(datasetId)
      .then((h) => {
        if (current) {
          setHistory(h);
          setHistoryMore(h.length === 30);
          setHistoryError("");
        }
      })
      .catch((e) => {
        if (current) setHistoryError(e.message);
      });
    return () => {
      current = false;
      window.clearTimeout(safety);
    };
  }, [datasetId,viewProfile]);
  useEffect(()=>{if(!initialQuestion)return;setQuestion(initialQuestion);onQuestionUsed?.();document.getElementById("analyst-question")?.focus()},[initialQuestion]);// eslint-disable-line react-hooks/exhaustive-deps
  // Open an existing record from Home; never submit or replay its query automatically.
  useEffect(()=>{if(!initialRunId||!datasetId)return;let current=true;analystApi.run(initialRunId).then(saved=>{if(!current)return;if(saved.dataset_id!==datasetId)throw Error("This question belongs to a different dataset.");thread.current=saved.thread_id||crypto.randomUUID();setRun(saved);setMapping(saved.type_mapping);setConfirmed(false);setOffset(0);setQuestion("");
    // The owner already confirmed exactly these types for this dataset: keep that confirmation instead of asking again.
    let remembered: Promise<ConfirmedTypes> | null = null;
    try { remembered = Promise.resolve(analystApi.confirmedTypes(datasetId)); } catch { remembered = null; }
    void remembered?.then(c => {
      if (!current || !c || typeof c !== "object" || c.current !== true || !c.type_mapping) return;
      const a = c.type_mapping as Record<string, string>, b = (saved.type_mapping || {}) as Record<string, string>;
      if ([...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => (a[k] ?? "VARCHAR") === (b[k] ?? "VARCHAR"))) { setConfirmed(true); setRemembered({ at: c.confirmed_at, stale: false }); }
    }).catch(() => undefined)}).catch(error=>{if(current)setError((error as Error).message)});return()=>{current=false}},[initialRunId,datasetId]);
  useEffect(() => {
    if (!pollingRunId || !active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await analystApi.run(pollingRunId!);
        if (!current) return;
        setRun(next);
        setError("");
        if (terminal.has(next.status)) {
          setCancelRequested(false);
          void refreshHistory(next.dataset_id);
        } else {
          timer = setTimeout(poll, 500);
        }
      } catch (e) {
        if (current) {
          setError("Could not refresh run status: " + (e as Error).message);
          timer = setTimeout(poll, 2000);
        }
      }
    }
    timer = setTimeout(poll, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [pollingRunId, active]);
  useEffect(() => {
    let current = true;
    if(resultRunId.current!==pollingRunId){setResults(null);resultRunId.current=pollingRunId;}
    setResultError("");
    setResultLoading(false);
    if (!pollingRunId || resultStatus !== "succeeded" || !resultAvailable) return;
    setResultLoading(true);
    analystApi
      .results(pollingRunId, offset)
      .then((r) => {
        if (current) setResults(r);
      })
      .catch((e) => {
        if (current) setResultError(e.message);
      })
      .finally(() => {
        if (current) setResultLoading(false);
      });
    return () => {
      current = false;
    };
  }, [pollingRunId, resultStatus, resultAvailable, offset]);
  async function ask(text=question,choice?:{kind:"column"|"metric";name:string}) {
    if (!text.trim() || !datasetId) return;
    setSubmitting(true);
    setError("");
    setOffset(0);
    setCancelRequested(false);
    try {
      const next = await analystApi.ask(datasetId, text, mapping,{thread_id:thread.current,clarification_choice:choice});
      globalDataset?.track({id:next.id,datasetId:next.dataset_id,name:next.dataset_name,kind:"Analyst",status:next.status});
      if(run&&terminal.has(run.status))setTurns(previous=>previous.some(t=>t.id===run.id)?previous:[...previous,run]);
      setRun(next);setQuestion("");
      void refreshHistory(datasetId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  async function rerun(old: AnalystRun) {
    setSubmitting(true);
    setError("");
    setOffset(0);
    try {
      const next = await analystApi.rerun(old.id);
      setTurns((previous) => previous.some((t) => t.id === old.id) ? previous : [...previous, old]);
      setRun(next);
      setQuestion("");
      void refreshHistory(datasetId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel() {
    if (!run) return;
    setCancelRequested(true);
    try {
      await analystApi.cancel(run.id);
    } catch (e) {
      setError((e as Error).message);
      setCancelRequested(false);
    }
  }
  const suggestionPanel = (question.trim()===''||run)&&suggestions.length>0&&<section key="suggest" className="analyst-suggestions" aria-label="Suggested questions"><div className="analyst-chips"><span className="home-suggestions-label">Suggested</span>{suggestions.slice(0,4).map(item=><Button key={item.question} variant="outline" disabled={active} onClick={()=>{setQuestion(item.question);document.getElementById('analyst-question')?.focus()}}>{item.question}</Button>)}</div></section>;
  const runPanel = (run&&<section key="run" className="run-conversation" aria-label="Analysis run">
              <h2 className="question-heading">{run.question}</h2>
              {active&&<LoadingState as="div" className="analyst-skeleton" role="status" aria-live="polite"><p>{cancelRequested?'Waiting for the current operation to stop…':({retrieve_context:'Understanding your question…',plan:'Understanding your question…',generate_sql:'Writing your query…',repair:'Checking the query again…',validate:'Validating your query…',execute:'Running your query…',chart:'Preparing your result…',explain:'Preparing your result…',finish:'Preparing your result…'}[run.current_step||'']||'Working on your question…')}</p><div/><div/><div/></LoadingState>}
              {run.error&&<ErrorState as="section" className="analyst-error" role="alert"><h2>We couldn’t finish this question</h2><p>{errorReason(run.error_code)}</p><Button onClick={()=>void ask(run.question)}>Retry</Button><Button variant="outline" onClick={()=>{setQuestion(run.question);document.getElementById('analyst-question')?.focus()}}>Edit question</Button><details><summary>View details</summary><p>{run.error}</p><small>{run.error_code}</small></details></ErrorState>}
              {run.status==='clarification'&&<Card className="analyst-clarification"><h2>A little more context will help</h2><p>{run.clarification_options?.length?'Choose the column or confirmed metric you meant.':'No safe clarification choices are available. Try a suggested question or rephrase your request.'}</p><div className="analyst-chips">{run.clarification_options?.map(c=><Button key={c.kind+c.name} variant="outline" onClick={()=>void ask(run.question,c)}>{c.name}</Button>)}</div><Button variant="ghost" onClick={()=>{setQuestion(run.question);document.getElementById('analyst-question')?.focus()}}>Rephrase question</Button><details><summary>Clarification details</summary><p>{run.clarification}</p></details></Card>}
              {resultLoading&&<LoadingState as="p" role="status">Loading result rows…</LoadingState>}{resultError&&<ErrorState as="p" role="alert">{resultError}</ErrorState>}
              {run.status==='succeeded'&&!run.results_available&&<section><p>This question was asked before answers were kept, so its values are not available. Run it again on your current data (no AI needed), or ask it again.</p><Button onClick={()=>void rerun(run)}>Run again on current data</Button><Button variant="outline" onClick={()=>void ask(run.question)}>Ask it again</Button>{technical&&<details className="sql-viewer"><summary>Generated SQL</summary><pre><SQLCode sql={run.executed_sql||run.sql||''}/></pre></details>}</section>}
              {run.status==='succeeded'&&run.results_available&&results&&<RunInsights key={run.id} run={run} results={results} offset={results.offset} onOffset={setOffset} onRerun={()=>void rerun(run)}/>}
              {run.status==='cancelled'&&<p role="status">Question stopped. You can edit it or start a new question.</p>}
            </section>);
  const slowChecking = useStillWorking(profileLoading || (!!profile && !typesChecked && !profileError), 6000);
  const composer = (
            <Card key="composer" as="form"
              className={run?"question-composer follow-up-composer":"question-composer"}
              aria-busy={active||submitting||resultLoading}
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              {error && (
                <ErrorState as="div" role="alert" className="alert">
                  {error}
                </ErrorState>
              )}
              <label htmlFor="analyst-question" className="sr-only">Your question</label>
              <textarea
                id="analyst-question"
                placeholder={run?"Ask a follow-up about this result":dataset?`Ask a question about ${displayName(dataset)}`:"Ask a question about your data"}
                rows={run?2:3}
                maxLength={2000}
                value={question}
                disabled={active || submitting}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends the question; Shift+Enter adds a new line. The same rules as the Analyze button apply.
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (!active && !submitting && question.trim() && profile && !profileError && confirmed) e.currentTarget.form?.requestSubmit();
                }}
              />
              <div className="composer-actions">
                {globalDataset&&<ActiveDatasetSelector />}
                {active ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={cancelRequested}
                    onClick={() => void cancel()}
                  >
                    <X size={14} />
                    {cancelRequested ? "Cancelling…" : "Cancel run"}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={
                      submitting ||
                      !question.trim() ||
                      !profile ||
                      !!profileError ||
                      !confirmed
                    }
                  >
                    {submitting ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Analyze
                  </Button>
                )}
              </div>
              <p className="composer-note"><Check size={12} aria-hidden="true" /> Your file is never changed</p>
              <details className="sharing-notice"><summary>What is sent to the AI?</summary><p>Your question, column names, confirmed definitions, bounded conversation summaries and computed results are sent to your configured AI provider.</p><p>Sensitive values in questions, definitions, approved examples, SQL/error context or computed results can reach the provider. No automatic masking is applied.</p></details>
              {!confirmed && !!profile && !profileError && (
                <div className="confirm-hint">
                  <p>Confirm column types to continue.</p>
                  <Button type="button" variant="outline" disabled={active} onClick={() => confirmTypes(true)}>
                    These types look right
                  </Button>
                </div>
              )}
            </Card>
  );
  const typesSection = (
          <aside key="types" className="analyst-context" aria-label="Column types">
            {!globalDataset&&<div className="context-title"><Database size={16}/><h2>Dataset context</h2></div>}
            {globalDataset?null:<>
            <label htmlFor="analyst-dataset">Analyze dataset</label>
            <select
              id="analyst-dataset"
              title={dataset?.name}
              value={datasetId}
              disabled={active || submitting}
              onChange={(e) => {
                setDatasetId(e.target.value);
                setOffset(0);
              }}
            >
              {datasets.map((d) => (
                <option value={d.id} key={d.id} title={d.name}>
                  {middleEllipsis(displayName(d))}
                </option>
              ))}
            </select>
</>}
            {!globalDataset&&<div className="context-facts"><span>{formatNumber(dataset?.rows)} rows</span><span>{formatNumber(dataset?.columns.length)} columns</span></div>}
            {profileLoading || (!!profile && !typesChecked && !profileError) ? (
              <div role="status" className="loading types-checking">
                <Loader2 className="spin" />
                {slowChecking ? "Still checking your columns. Large files take longer." : "Checking column types…"}
              </div>
            ) : profileError ? (
              <ErrorState as="div" role="alert" className="alert">
                {profileError}
              </ErrorState>
            ) : (
              profile && (<>
                  {remembered?.stale && <p className="types-remembered" role="status">Your columns changed since you last confirmed types. Please check them again.</p>}
                  {remembered?.error && <p className="types-remembered" role="status">{remembered.error}</p>}
                <details className="type-settings" open={needsTypeCheck}>
                  <summary>Check column types</summary>
                  {remembered && !remembered.stale && confirmed && !remembered.error && <p className="types-remembered" role="status">Using the column types you confirmed{remembered.at ? " on " + formatDate(remembered.at) : ""}.</p>}
                  <p>
                    {needsTypeCheck
                      ? "Before your first question, check what kind of value each column holds. Press “Use suggested types”, then confirm. Your file is not changed."
                      : "Choose types for this analysis. Your file is not changed."}
                  </p>
                  <Button
                    variant="outline"
                    disabled={active}
                    onClick={() => {
                      setMapping(
                        Object.fromEntries(
                          profile.columns.map((c) => [
                            c.name,
                            c.suggested_type,
                          ]),
                        ),
                      );
                      setConfirmed(false);
                    }}
                  >
                    Use suggested types
                  </Button>
                  <div className="type-column-list">
                    {profile.columns.map((c) => {
                      const type = mapping[c.name] || "VARCHAR";
                      const failed =
                        type === "VARCHAR" ? 0 : c.conversions[type].failed;
                      return (
                        <div className="type-column" key={c.name}>
                          <label htmlFor={"type-" + c.name} title={c.name}>
                            {c.name}
                          </label>
                          <select
                            id={"type-" + c.name}
                            aria-label={`Analysis type for ${c.name}`}
                            disabled={active}
                            value={type}
                            onChange={(e) => {
                              setMapping((m) => ({
                                ...m,
                                [c.name]: e.target.value as AnalysisType,
                              }));
                              setConfirmed(false);
                            }}
                          >
                            {ANALYSIS_TYPES.map((t) => (
                              <option key={t} value={t}>{typeLabel(t)}</option>
                            ))}
                          </select>
                          <small className={failed ? "conversion-warning" : ""}>
                            {formatNumber(c.missing)} missing · {formatNumber(failed)} failed conversions
                            {c.suggested_type !== "VARCHAR" &&
                            type === "VARCHAR"
                              ? ` · Suggested: ${typeLabel(c.suggested_type)}`
                              : ""}
                          </small>
                        </div>
                      );
                    })}
                  </div>
                  {numericColumns.length > 0 && (
                    <fieldset className="unit-choices">
                      <legend>What are these numbers?</legend>
                      <p>Numbers are shown with $ or % only after you confirm them here. Anything else stays a plain number.</p>
                      {numericColumns.map((c) => {
                        const choice = units[c.name] || "neither";
                        return (
                          <div className="unit-row" key={c.name}>
                            <label htmlFor={"unit-" + c.name} title={c.name}>{c.name}</label>
                            <select id={"unit-" + c.name} aria-label={`What ${c.name} is`} disabled={active} value={choice}
                              onChange={(e) => { unitsTouched.current.add(c.name); setUnits((u) => ({ ...u, [c.name]: e.target.value as UnitChoice })); setUnitsDirty(true); }}>
                              {offered && <option value="money">Money ({offered})</option>}
                              <option value="percent">Percentage</option>
                              <option value="neither">Neither</option>
                            </select>
                            {!unitsStored && !unitsDirty && suggestUnit(c.name) !== "neither" && suggestUnit(c.name) === choice && !storedSettings?.monetary_columns?.[c.name] && !storedSettings?.percent_columns?.includes(c.name) && <small>Suggested</small>}
                          </div>
                        );
                      })}
                      {unitsError && <small role="alert" className="conversion-warning">{unitsError}</small>}
                      {confirmed && (!unitsStored || unitsDirty) && (
                        <Button type="button" variant="outline" disabled={active} onClick={() => void saveUnits()}>Save number choices</Button>
                      )}
                    </fieldset>
                  )}
                  {converting && (
                    <label className="confirm-types">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={active}
                        onChange={(e) => confirmTypes(e.target.checked)}
                      />
                      <span>
                        I confirm these types. Values that cannot be converted are
                        left out of totals and averages.
                      </span>
                    </label>
                  )}
                </details>
              </>)
            )}
          </aside>
  );
  const startNew=()=>{thread.current=crypto.randomUUID();setTurns([]);setRun(null);setResults(null);setQuestion('')};
  const openSaved=(h:AnalystRun)=>{thread.current=h.activity_kind==="evaluation"?crypto.randomUUID():(h.thread_id||crypto.randomUUID());setTurns(history.filter(t=>t.thread_id===h.thread_id&&t.created_at<h.created_at));setRun(h);setQuestion("");setMapping(h.type_mapping);setConfirmed(false);setOffset(0);setError("")};
  const turnsPanel = (!!turns.length&&<section key="turns" aria-label="Earlier turns">{turns.map(t=><details key={t.id} className="earlier-turn"><summary>{t.question}</summary><p>{{succeeded:'Saved answer',clarification:'Needs clarification',failed:'Question could not finish',cancelled:'Question stopped',queued:'Waiting',generating:'Working',executing:'Working'}[t.status]}</p>{t.thread_result_summary&&<pre>{JSON.stringify(t.thread_result_summary,null,2)}</pre>}{t.executed_sql&&<pre><SQLCode sql={t.executed_sql}/></pre>}</details>)}</section>);
  // One keyed list in both states, so the question box is the SAME element before and after the first answer (what you typed is never lost).
  const conversationItems = run
    ? [runPanel, turnsPanel, composer, typesSection, suggestionPanel]
    : needsTypeCheck
      ? [composer, typesSection, suggestionPanel]      // first run: the quick column check comes before the suggestions
      : [composer, suggestionPanel, typesSection];
  return (
    <div className="analyst-workspace">
      <PageHeader title={pageTitle("AI Analyst")} />
      {!datasets.length && globalDataset?.loading ? null : !datasets.length ? (
        <Card className="analyst-empty">
          <Database size={35} />
          <h2>Start with your data</h2>
          <p>Upload a dataset, then ask a question here.</p>
          <Button onClick={onWorkspace}>
            Upload a dataset
            <ArrowRight size={15} />
          </Button>
        </Card>
      ) : (
        <PanelLayout title="Question history" label="Questions" panel={close=><AskPanel history={history} currentId={run?.id} error={historyError} more={historyMore} loadingMore={historyLoading} disabled={active||submitting} onNew={startNew} onOpen={openSaved} onMore={()=>void earlierRuns()} close={close}/>}>
        <div className="analyst-layout">
          <div className="analyst-conversation">
            {conversationItems}
            <p className="analyst-footnote">
              AI can make mistakes. Review important results before using them.
            </p>
          </div>
        </div>
        </PanelLayout>
      )}
    </div>
  );
}
