import {TableFrame} from "./ui/data";
import { PageHeader, StatusChip, statusTone } from "./ui/layout";
import {pageLabel} from "../lib/navigation";
import {ErrorState,EmptyState,LoadingState} from "./WorkspaceStates";
import UnitConfirmation from "./UnitConfirmation";
import {formatDate} from "../lib/formatters";
import {
  mlSteps, mlTasks as tasks, mlTaskLabel, splitPolicy, plainTerms, METRIC_LABELS,
  taskSupport,
  taskSuggestions,
} from "../lib/automlPresentation";
import { predictionMeaning, PREDICTION_HELP, forecastHelp } from "../lib/automlMeaning";
import { useActiveDataset, useDatasetGuard } from "../lib/activeDataset";
import ActiveDatasetSelector from "./ActiveDatasetSelector";
import { displayName } from "../lib/datasetNames";
import DatasetName from "./DatasetName";
import { middleEllipsis } from "../lib/filenames";
import { formatNumber } from "../lib/formatters";
import { useEffect, useRef, useState } from "react";
import { Beaker, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type Dataset } from "../api";
import {
  automlApi,
  type MLTask, type LeakageFinding,
  type MLFeature,
  type MLProfile,
  type MLExperiment,
  type MLModel,
  type MLPrediction,
  type MLConfiguration,
  type MLInputSchema,
  type MLInputValidation,
} from "../automlapi";
import { Button } from "./ui/button";
import { Card } from "./ui/layout";
import AutoMLResults, { MLTable, mlValue } from "./AutoMLResults";
const terminal = new Set(["completed", "failed", "cancelled"]);
export default function AutoMLStudio({
  datasets,
  onUpload,
}: {
  datasets: Dataset[];
  onUpload?: () => void;
}) {
  const [step, setStep] = useState(1),
    [furthest, setFurthest] = useState(1),
    [taskChosen, setTaskChosen] = useState(false),
    [search, setSearch] = useState("");
  const [inputSchema, setInputSchema] = useState<MLInputSchema | null>(null),
    [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<{
    ready: boolean;
    reasons: string[];
  } | null>(null);
  const [uploadedBatch, setUploadedBatch] = useState<Dataset | null>(null);
  const [inputValidation, setInputValidation] =
    useState<MLInputValidation | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const globalDataset = useActiveDataset();
  const globalId = globalDataset?.activeId,
    trackJob = globalDataset?.track,
    hasGlobal = !!globalDataset;
  useDatasetGuard("automl-config", () =>
    busy
      ? {
          title: "AutoML operation in progress",
          message:
            "Wait for this operation to finish before switching datasets.",
          blocked: true,
        }
      : configDirty || (!job?.result && (target || confirmed || title))
        ? {
            title: "Reset AutoML configuration?",
            message:
              "Leaving this configuration resets target, feature and other unsaved training choices.",
            continueLabel: "Reset and switch",
          }
        : null,
  );
  const [configDirty, setConfigDirty] = useState(false);
  const [datasetId, setDatasetId] = useState(
      globalDataset?.activeId || datasets[0]?.id || "",
    ),
    [task, setTask] = useState<MLTask>("regression"),
    [target, setTarget] = useState(""),
    [title, setTitle] = useState(""),
    [unit, setUnit] = useState("");
  const [profile, setProfile] = useState<MLProfile | null>(null),
    [profiling, setProfiling] = useState(false),
    [features, setFeatures] = useState<MLFeature[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [scaler, setScaler] = useState<"standard" | "robust" | "none">("standard"),
    [seed, setSeed] = useState(42),
    [clusters, setClusters] = useState(3),
    [contamination, setContamination] = useState(5);
  const [rfmMode, setRfmMode] = useState(false),
    [customer, setCustomer] = useState(""),
    [dateColumn, setDateColumn] = useState(""),
    [measure, setMeasure] = useState(""),
    [order, setOrder] = useState(""),
    [reference, setReference] = useState("");
  const [frequency, setFrequency] = useState<"day" | "week" | "month">("day"),
    [missingPolicy, setMissingPolicy] = useState<
      "error" | "zero" | "forward_fill"
    >("error"),
    [horizon, setHorizon] = useState(7),
    [season, setSeason] = useState(7);
  const [history, setHistory] = useState<MLExperiment[]>([]),
    [models, setModels] = useState<MLModel[]>([]),
    [savedPredictions, setSavedPredictions] = useState<MLPrediction[]>([]),
    [job, setJob] = useState<MLExperiment | null>(null),
    [modelId, setModelId] = useState(""),
    [prediction, setPrediction] = useState<MLPrediction | null>(null);
  const [predictionMode, setPredictionMode] = useState<"single" | "batch">(
      "single",
    ),
    [batchId, setBatchId] = useState(datasetId),
    [record, setRecord] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [profileRevision, setProfileRevision] = useState(0);
  const active = !!job && !terminal.has(job.status),
    supervised = task === "regression" || task === "classification",
    rawFeatures = task !== "forecasting" && !(task === "clustering" && rfmMode);
  const model = models.find((m) => m.id === modelId);
  const pollingJobId=job?.id;
  useEffect(() => {
    if (globalId === undefined || datasetId === globalId) return;
    setDatasetId(globalId);
    setTarget("");
    setFeatures([]);
    setTitle("");
    setUnit("");
    setCustomer("");
    setDateColumn("");
    setMeasure("");
    setOrder("");
    setReference("");
    setConfirmed(false);
    setConfigDirty(false);
    setPrediction(null);
    setModelId("");
    setBatchId(globalId);
    setError("");
    setStep(active ? 2 : 1);
    setFurthest(active ? 2 : 1);
    setTaskChosen(false);
    if (!active) setJob(null);
    setScaler("standard");
    setSeed(42);
    setClusters(3);
    setContamination(5);
    setFrequency("day");
    setMissingPolicy("error");
    setHorizon(7);
    setSeason(7);
  }, [globalId, datasetId, active]);
  useEffect(() => {
    if (active && job)
      trackJob?.({
        id: job.id,
        datasetId: job.dataset_id,
        name: job.dataset_name,
        kind: "AutoML",
        status: job.status,
      });
  }, [job, active, trackJob]);

  async function reload() {
    const [h, m, p] = await Promise.all([
      automlApi.experiments(),
      automlApi.models(),
      automlApi.predictions(),
    ]);
    setHistory(h);
    setModels(m);
    setSavedPredictions(p);
  }
  useEffect(() => {
    let current = true;
    Promise.all([
      automlApi.experiments(),
      automlApi.models(),
      automlApi.predictions(),
    ])
      .then(([h, m, p]) => {
        if (current) {
          setHistory(h);
          setModels(m);
          setSavedPredictions(p);
          const running = h.find((item) => !terminal.has(item.status));
          if (running) {
            setJob(running);
            setStep(2);
            setFurthest(2);
          }
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
    if (!hasGlobal && !datasetId && datasets.length)
      setDatasetId(datasets[0].id);
    if (!datasetId) return;
    let current = true;
    setProfiling(true);
    setProfile(null);
    setConfirmed(false);
    automlApi
      .profile(datasetId, task, target || undefined)
      .then((p) => {
        if (!current) return;
        setProfile(p);
        setFeatures(
          p.columns
            .filter(
              (c) =>
                c.name !== target &&
                !c.constant &&
                !c.potential_identifier &&
                !c.potential_leakage &&
                !c.high_cardinality &&
                (task !== "anomaly" || c.kind === "numeric"),
            )
            .slice(0, 24)
            .map((c) => ({ name: c.name, kind: c.kind })),
        );
        setCustomer((c) => (p.columns.some((v) => v.name === c) ? c : ""));
        setDateColumn((c) => (p.columns.some((v) => v.name === c) ? c : ""));
        setMeasure((c) => (p.columns.some((v) => v.name === c) ? c : ""));
        setOrder((c) => (p.columns.some((v) => v.name === c) ? c : ""));
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setProfiling(false);
      });
    return () => {
      current = false;
    };
  }, [datasetId, task, target, datasets, profileRevision, hasGlobal]);
  useEffect(() => {
    if (!pollingJobId || !active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await automlApi.experiment(pollingJobId);
        if (!current) return;
        if (terminal.has(next.status)) {
          await reload();
          if (current && next.result) {
            setModelId(next.result.selected_model_id);
            setFurthest(4);
            setStep(4);
            setConfigDirty(false);
            setNotice(
              "Experiment completed. Models and measured results are saved locally.",
            );
          }
        } else timer = setTimeout(poll, 700);
        if (current) setJob(next);
      } catch (e) {
        if (current) {
          setError("Progress refresh failed: " + (e as Error).message);
          timer = setTimeout(poll, 2000);
        }
      }
    };
    timer = setTimeout(poll, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [pollingJobId, active]);
  useEffect(() => {
    setRecord({});
    setPrediction(null);
  }, [modelId]);
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
  function switchTask(next: MLTask) {
    setTaskChosen(true);
    setFurthest((v) => Math.min(v, 2));
    setConfigDirty(true);
    setTask(next);
    setTarget("");
    setFeatures([]);
    setConfirmed(false);
    setRfmMode(false);
    setJob(null);
    setUnit("");
    setError("");
  }
  function configuration(): MLConfiguration {
    return {
      dataset_id: datasetId,
      title:
        title.trim() || tasks.find((t) => t.id === task)!.name + " experiment",
      task,
      target: supervised ? target : null,
      target_unit:
        task === "regression" || task === "forecasting" ? unit || null : null,
      features: rawFeatures ? features : [],
      scaler,
      seed,
      clusters,
      contamination: contamination / 100,
      rfm:
        task === "clustering" && rfmMode
          ? {
              customer,
              date: dateColumn,
              amount: measure,
              order: order || null,
              reference_date: reference || null,
            }
          : null,
      forecast:
        task === "forecasting"
          ? {
              date_column: dateColumn,
              measure,
              frequency,
              missing_periods: missingPolicy,
              horizon,
              seasonal_period: season,
            }
          : null,
      confirm_feature_availability: true,
    };
  }
  useEffect(() => {
    requestAnimationFrame(() => heading.current?.focus());
  }, [step]);
  useEffect(() => {
    setInputSchema(null);
    setInputErrors({});
    if (!modelId) return;
    let current = true;
    automlApi
      .inputSchema(modelId)
      .then((value) => {
        if (current) setInputSchema(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [modelId]);
  // Read-only leakage warning for the ticked predictors (docs/LEAKAGE_WARNING.md). It never blocks or changes training.
  const [leaks, setLeaks] = useState<LeakageFinding[]>([]);
  const leakKey = [datasetId, task, target, features.map((f) => f.name).join("|")].join("::");
  useEffect(() => {
    setLeaks([]);
    if (step !== 2 || !datasetId || !supervised || !target || !features.length) return;
    let current = true;
    const timer = setTimeout(() => {
      Promise.resolve(automlApi.leakage(datasetId, task, target, features.map((f) => f.name)))
        .then((r) => { if (current && r?.findings) setLeaks(r.findings); })
        .catch(() => { /* a warning only: failing quietly never blocks training */ });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leakKey, step]);
  const validationKey = JSON.stringify(configuration());
  useEffect(() => {
    if (step !== 2) return;
    setCheck(null);
    if (
      !profile?.readiness.ready ||
      !confirmed ||
      (!features.length && rawFeatures) ||
      (!rawFeatures && (!dateColumn || !measure || (rfmMode && !customer)))
    )
      return;
    let current = true;
    const timer = setTimeout(() => {
      automlApi
        .validate(JSON.parse(validationKey) as MLConfiguration)
        .then((value) => {
          if (current) setCheck(value);
        })
        .catch((e) => {
          if (current) setCheck({ ready: false, reasons: [e.message] });
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    validationKey,
    step,
    profile,
    confirmed,
    rawFeatures,
    dateColumn,
    measure,
    rfmMode,
    customer,
    features.length,
  ]);
  const archived = !!datasets.find((d) => d.id === datasetId)?.archived_at;
  const configureReason = archived
    ? "Dataset is archived"
    : profiling
      ? "Waiting for the dataset profile."
      : supervised && !target
        ? "Choose a target column to continue"
        : profile?.readiness.reasons[0] ||
          (!profile
            ? "Wait for the dataset profile."
            : rawFeatures && !features.length
              ? "Select at least one feature."
              : !rawFeatures && !dateColumn
                ? "Choose a date column."
                : !rawFeatures && !measure
                  ? "Choose a numeric measure."
                  : rfmMode && !customer
                    ? "Choose a customer identifier."
                    : !confirmed
                      ? "Confirm feature availability to continue."
                      : !check
                        ? "Checking the existing training rules…"
                        : check.reasons[0] || "");
  const stepReason =
    step === 1
      ? archived
        ? "Dataset is archived"
        : profiling || !profile
          ? "Wait for the dataset profile."
          : !datasetId
            ? "Choose a dataset."
            : !taskChosen
              ? "Choose what you want to predict to continue"
              : taskSupport(profile, task) ||
                (supervised && !target
                  ? "Choose a target column to continue"
                  : profile?.readiness.reasons[0] || "")
      : step === 2
        ? active
          ? "Training is running."
          : ""
        : step === 4 && !job?.result && !models.length
          ? "No measured results are available."
          : "";
  function go(next: number) {
    setStep(next);
    if (next < 4) setFurthest((v) => Math.max(v, next));
  }
  const canTrain =
    !!check?.ready &&
    !archived &&
    !!profile?.readiness.ready &&
    !!datasetId &&
    confirmed &&
    !profiling &&
    !active &&
    !busy &&
    (rawFeatures
      ? features.length > 0
      : !!dateColumn && !!measure && (task !== "clustering" || !!customer));
  return (
    <div className="automl-page" onChange={(e) => { if (!(e.target as HTMLElement).closest(".global-dataset-selector")) setConfigDirty(true); }}>
      <PageHeader title={pageLabel("AutoML Studio")} description="Predict a number or a category from your data. Results are measured on data the model has not seen." actions={globalDataset ? <ActiveDatasetSelector /> : undefined} />
      {error && (
        <ErrorState as="div" className="alert" role="alert">
          {error}
          <Button
            variant="ghost"
            onClick={() =>
              void action(async () => {
                await reload();
                setProfileRevision((v) => v + 1);
              })
            }
          >
            Retry loading
          </Button>
        </ErrorState>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {!datasets.length ? (
        <section className="ml-empty">
          <Beaker size={32} />
          <h2>Your next model starts with data</h2>
          <EmptyState as="p">Add a dataset to build your first prediction.</EmptyState>
          <Button onClick={onUpload}>Upload a dataset</Button>
        </section>
      ) : (
        <>
          <nav className="ml-stepper ml-stages" aria-label="Model workflow">
            {mlSteps.map((label, index) => {
              const target = [1, 2, 4][index];
              return (
                <button
                  key={label}
                  disabled={
                    (active && target !== 2) ||
                    !(
                      step === target ||
                      (target === 1 && !!profile) ||
                      (target === 2 && (furthest >= 2 || (step === 1 && !stepReason))) ||
                      (target === 4 && (!!job?.result || !!models.length))
                    )
                  }
                  aria-current={step === target ? "step" : undefined}
                  onClick={() => go(target)}
                >
                  <span>{formatNumber(index + 1)}</span>
                  <span className="ml-step-label">{label}</span>
                </button>
              );
            })}
          </nav>
          <h2 ref={heading} tabIndex={-1} className="ml-step-heading">
            {mlSteps[step === 1 ? 0 : step === 2 ? 1 : 2]}
          </h2>
          {step === 1 && (
            <Card className="ml-workspace-selection" id="ml-dataset" aria-label="Your data">
              <p className="active-dataset-label">
                Your data:{" "}
                <DatasetName
                  name={
                    datasets.find((d) => d.id === datasetId)
                      ? displayName(datasets.find((d) => d.id === datasetId)!)
                      : "None"
                  }
                />{" "}
                · {formatNumber(datasets.find((d) => d.id === datasetId)?.rows || 0)} rows
              </p>
              <p className="ml-data-status" role="status">
                {profiling || !profile ? "Checking…" : !taskChosen ? "Data checked" : profile.readiness.ready ? "Ready" : "Not ready yet"}
              </p>
              {/* Reasons belong to the chosen task: nothing is said (and nothing moves) before a task is picked. */}
              {!!profile && taskChosen && !profile.readiness.ready && profile.readiness.reasons.map((r) => (
                <p className="ml-warning" key={r}>{plainTerms(r)}</p>
              ))}
              <Button
                variant="outline"
                disabled={profiling || active || busy}
                onClick={() => setProfileRevision((v) => v + 1)}
              >
                <RefreshCw size={14} />
                Refresh profile
              </Button>
            </Card>
          )}
          {step === 1 && (
            <>
              <div
                id="ml-task"
                className="ml-task-grid"
                role="group"
                aria-label="ML task"
              >
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    className={taskChosen && task === t.id ? "ml-task selected" : "ml-task"}
                    aria-pressed={taskChosen && task === t.id}
                    disabled={active || busy || !!taskSupport(profile, t.id)}
                    title={taskSupport(profile, t.id) || undefined}
                    onClick={() => switchTask(t.id)}
                  >
                    <strong>{t.name}</strong>
                    <span className="ml-task-technical">{t.technical}</span>
                    <small>{t.description}</small>
                    {!!profile && !profiling && taskSupport(profile, t.id) && (
                      <small>{taskSupport(profile, t.id)}</small>
                    )}
                  </button>
                ))}
              </div>
              {supervised && (
                <>
                <label>
                  Target column
                  <select
                    value={target}
                    disabled={active || busy}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setConfirmed(false);
                      setUnit("");
                    }}
                  >
                    <option value="">Choose a target explicitly</option>
                    {profile?.columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} · {c.kind}
                      </option>
                    ))}
                  </select>
                </label>
                {!!target && profile?.target_distribution && (
                  <section className="ml-target-distribution" aria-label="Target values">
                    <p className="insight-note">
                      {formatNumber(profile.target_distribution.observed)} rows have a value for {target} ·{" "}
                      {formatNumber(profile.target_distribution.missing)} are empty ·{" "}
                      {formatNumber(profile.target_distribution.unique)} different values. The most common are shown.
                    </p>
                    <MLTable rows={profile.target_distribution.top_values} />
                  </section>
                )}
                </>
              )}
              {!!taskSuggestions(profile).length&&<details className="ml-profile-suggestions"><summary>Profile-based suggestions · {formatNumber(taskSuggestions(profile).length)}</summary><p>Optional starting points from column types and counts. Choose Use suggestion to apply one.</p>
              {taskSuggestions(profile).map((suggestion) => (
                <div className="ml-suggestion" key={suggestion.task}>
                  <strong>
                    Suggestion ·{" "}
                    {tasks.find((t) => t.id === suggestion.task)?.name}
                  </strong>
                  <p>{suggestion.reason}</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      switchTask(suggestion.task);
                      if (suggestion.task === "forecasting") {
                        setDateColumn(suggestion.date || "");
                        setMeasure(suggestion.target || "");
                      } else setTarget(suggestion.target || "");
                    }}
                  >
                    Use suggestion
                  </Button>
                </div>
              ))}</details>}
            </>
          )}
          {profiling && (
            <LoadingState as="p" role="status" className="skeleton-block">
              Checking your data…
            </LoadingState>
          )}
          {step === 2 && (
            <div className="ml-setup-grid ml-single">
              {step === 2 && (
                <Card className="ml-config" id="ml-config">
                  <div className="insight-heading">
                    <h2>
                      {task === "clustering" && rfmMode ? "Configure customer RFM groups" : mlTaskLabel(task)}
                    </h2>
                    <Beaker size={20} />
                  </div>
                  {supervised&&<p className="ml-target-summary">Target: <strong>{target}</strong> · Change it in step 1</p>}
                  {task === "clustering" && (
                    <label>
                      Clustering features
                      <select
                        value={rfmMode ? "rfm" : "rows"}
                        disabled={active || busy}
                        onChange={(e) => {
                          setRfmMode(e.target.value === "rfm");
                          setConfirmed(false);
                        }}
                      >
                        <option value="rows">Selected row features</option>
                        <option value="rfm">Customer RFM aggregation</option>
                      </select>
                    </label>
                  )}
                  {(task === "forecasting" ||
                    (task === "clustering" && rfmMode)) && (
                    <div className="ml-field-grid">
                      {rfmMode && task === "clustering" && (
                        <label>
                          Customer identifier
                          <select
                            value={customer}
                            onChange={(e) => {
                              setCustomer(e.target.value);
                              setConfirmed(false);
                            }}
                            disabled={active || busy}
                          >
                            <option value="">Select customer column</option>
                            {profile?.columns.map((c) => (
                              <option key={c.name}>{c.name}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label>
                        {task === "forecasting"
                          ? "Time column"
                          : "Transaction date"}
                        <select
                          value={dateColumn}
                          onChange={(e) => {
                            setDateColumn(e.target.value);
                            setConfirmed(false);
                          }}
                          disabled={active || busy}
                        >
                          <option value="">Select date column</option>
                          {profile?.columns.map((c) => (
                            <option key={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {task === "forecasting"
                          ? "Forecast measure"
                          : "Monetary value"}
                        <select
                          value={measure}
                          onChange={(e) => {
                            setMeasure(e.target.value);
                            setUnit("");
                            setConfirmed(false);
                          }}
                          disabled={active || busy}
                        >
                          <option value="">Select numeric measure</option>
                          {profile?.columns.map((c) => (
                            <option key={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                      {rfmMode && task === "clustering" && (
                        <>
                          <label>
                            Order identifier (optional)
                            <select
                              value={order}
                              onChange={(e) => {
                                setOrder(e.target.value);
                                setConfirmed(false);
                              }}
                              disabled={active || busy}
                            >
                              <option value="">
                                Count transaction rows per customer
                              </option>
                              {profile?.columns.map((c) => (
                                <option key={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            RFM reference date (optional)
                            <input
                              type="date"
                              value={reference}
                              onChange={(e) => {
                                setReference(e.target.value);
                                setConfirmed(false);
                              }}
                              disabled={active || busy}
                            />
                            <small>
                              Blank uses one day after the latest transaction.
                              IDs group customers and never become model
                              predictors.
                            </small>
                          </label>
                        </>
                      )}
                    </div>
                  )}
                  {task === "forecasting" && (
                    <>
                      <div className="ml-field-grid">
                        <label>
                          Aggregation frequency
                          <select
                            value={frequency}
                            disabled={active || busy}
                            onChange={(e) => {
                              const v = e.target.value as typeof frequency;
                              setFrequency(v);
                              setSeason(
                                v === "month" ? 12 : v === "week" ? 4 : 7,
                              );
                              setHorizon(
                                v === "month" ? 1 : v === "week" ? 2 : 7,
                              );
                              setConfirmed(false);
                            }}
                          >
                            <option value="day">Daily</option>
                            <option value="week">Weekly (Monday start)</option>
                            <option value="month">Monthly</option>
                          </select>
                        </label>
                        <label>
                          Missing periods
                          <select
                            value={missingPolicy}
                            disabled={active || busy}
                            onChange={(e) => {
                              setMissingPolicy(
                                e.target.value as typeof missingPolicy,
                              );
                              setConfirmed(false);
                            }}
                          >
                            <option value="error">Stop and explain gaps</option>
                            <option value="zero">Explicit zero revenue</option>
                            <option value="forward_fill">
                              Past-only forward fill
                            </option>
                          </select>
                        </label>
                        <label>
                          Forecast horizon
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={horizon}
                            onChange={(e) => setHorizon(Number(e.target.value))}
                            disabled={active || busy}
                          />
                        </label>
                        <label>
                          Seasonal period
                          <input
                            type="number"
                            min={2}
                            max={12}
                            value={season}
                            onChange={(e) => setSeason(Number(e.target.value))}
                            disabled={active || busy}
                          />
                        </label>
                      </div>
                      <p className="insight-note">
                        No random split: two earlier backtests select a
                        baseline; the final window tests it. Coverage/horizon
                        checks run before fitting. Missing periods require your
                        explicit policy. Point forecasts only; intervals are not
                        estimated.
                      </p>
                    </>
                  )}
                  {rawFeatures && (
                    <>
                      <h3>Features · {formatNumber(features.length)} / 24</h3>
                      <p className="insight-note">
                        Confirm feature types and prediction-time availability.
                        IDs and suspected leakage are excluded.
                      </p>
                      {!leaks.length && <p className="ml-warning" role="note" aria-label="Leakage warning">
                        <strong>Check for leakage before you train.</strong> Only tick columns you would already know when you make a prediction. A column that is worked out from the answer, or only known afterwards, makes the results look better than they really are.
                        {(() => {
                          const flagged = (profile?.columns || []).filter((c) => c.potential_leakage).map((c) => c.name);
                          return flagged.length ? ` Left out automatically as possible leakage: ${flagged.join(", ")}.` : "";
                        })()}
                      </p>}
                      {!!leaks.length && (
                        <div className="ml-warning" role="alert" aria-label="Columns that may give away the answer">
                          <strong>These columns may give away the answer:</strong>
                          <ul>
                            {leaks.map((l) => <li key={l.column}><strong>{l.column}</strong>: {l.sentence}</li>)}
                          </ul>
                          <small>This is only a warning, not a finding: a strong column can be perfectly legitimate. Consider unticking it; nothing is blocked.</small>
                        </div>
                      )}
                      <label>
                        Search features
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <div
                        className="ml-features"
                        onChange={() => setConfigDirty(true)}
                      >
                        {profile?.columns
                          .filter(
                            (c) =>
                              c.name !== target &&
                              c.name
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          )
                          .map((c) => {
                            const selected = features.some(
                                (f) => f.name === c.name,
                              ),
                              blocked =
                                c.constant ||
                                c.potential_identifier ||
                                c.potential_leakage ||
                                c.high_cardinality;
                            return (
                              <div className="ml-feature" key={c.name}>
                                <label>
                                  <input
                                    type="checkbox"
                                    aria-label={"Use feature " + c.name}
                                    checked={selected}
                                    disabled={
                                      blocked ||
                                      active ||
                                      busy ||
                                      (!selected && features.length >= 24)
                                    }
                                    onChange={(e) => {
                                      setFeatures((f) =>
                                        e.target.checked
                                          ? [
                                              ...f,
                                              { name: c.name, kind: c.kind },
                                            ]
                                          : f.filter((v) => v.name !== c.name),
                                      );
                                      setConfirmed(false);
                                    }}
                                  />
                                  <span>
                                    <strong>{c.name}</strong>
                                    <small>
                                      {formatNumber(c.missing)} missing ·{" "}
                                      {formatNumber(c.cardinality)} unique
                                      {blocked
                                        ? " · excluded: " +
                                          [
                                            c.constant && "constant",
                                            c.potential_identifier &&
                                              "identifier",
                                            c.potential_leakage &&
                                              "potential leakage",
                                            c.high_cardinality &&
                                              "high cardinality",
                                          ]
                                            .filter(Boolean)
                                            .join(", ")
                                        : ""}
                                    </small>
                                  </span>
                                </label>
                                <small>
                                  {features.find((f) => f.name === c.name)
                                    ?.kind || c.kind}
                                </small>
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}
                  {(scaler !== "standard" ||
                    seed !== 42 ||
                    clusters !== 3 ||
                    contamination !== 5 ||
                    frequency !== "day" ||
                    missingPolicy !== "error" ||
                    horizon !== 7 ||
                    season !== 7 ||
                    features.some(
                      (f) =>
                        profile?.columns.find((c) => c.name === f.name)
                          ?.kind !== f.kind,
                    )) && (
                    <p role="status">Advanced settings differ from defaults.</p>
                  )}
                  <details className="advanced-options">
                    <summary>Advanced settings</summary>
                    <label>
                      Experiment title
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                        placeholder="Untitled local experiment"
                        disabled={active || busy}
                      />
                    </label>
                    <p>
                      Reset restores training defaults and feature-type overrides, then requires confirmation again.
                    </p>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setScaler("standard");
                        setSeed(42);
                        setClusters(3);
                        setContamination(5);
                        setFrequency("day");
                        setMissingPolicy("error");
                        setHorizon(7);
                        setSeason(7);
                        setUnit("");
                        setFeatures((f) =>
                          f.map((value) => ({
                            ...value,
                            kind:
                              profile?.columns.find(
                                (c) => c.name === value.name,
                              )?.kind || value.kind,
                          })),
                        );
                        setConfirmed(false);
                      }}
                    >
                      Reset to defaults
                    </Button>
                    {rawFeatures &&
                      features.map((f) => (
                        <label key={f.name}>
                          Feature type · {f.name}
                          <select
                            aria-label={"ML type for " + f.name}
                            value={f.kind}
                            onChange={(e) => {
                              setFeatures((values) =>
                                values.map((v) =>
                                  v.name === f.name
                                    ? {
                                        ...v,
                                        kind: e.target
                                          .value as MLFeature["kind"],
                                      }
                                    : v,
                                ),
                              );
                              setConfirmed(false);
                            }}
                          >
                            {(task === "anomaly"
                              ? ["numeric"]
                              : ["numeric", "categorical", "datetime"]
                            ).map((kind) => (
                              <option key={kind}>{kind}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    <div className="ml-field-grid">
                      {task !== "forecasting" && (
                        <label>
                          Numerical scaling
                          <select
                            value={scaler}
                            onChange={(e) =>
                              setScaler(e.target.value as typeof scaler)
                            }
                            disabled={active || busy}
                          >
                            <option value="standard">Standard</option>
                            <option value="robust">Robust</option>
                            <option value="none">None</option>
                          </select>
                        </label>
                      )}
                      {task !== "forecasting" && (
                        <label>
                          Random seed
                          <input
                            type="number"
                            min={0}
                            max={2147483647}
                            value={seed}
                            onChange={(e) => setSeed(Number(e.target.value))}
                            disabled={active || busy}
                          />
                        </label>
                      )}
                      {task === "clustering" && (
                        <label>
                          Number of clusters
                          <input
                            type="number"
                            min={2}
                            max={8}
                            value={clusters}
                            onChange={(e) =>
                              setClusters(Number(e.target.value))
                            }
                            disabled={active || busy}
                          />
                        </label>
                      )}
                      {task === "anomaly" && (
                        <label>
                          Expected flagged fraction (%)
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={contamination}
                            onChange={(e) =>
                              setContamination(Number(e.target.value))
                            }
                            disabled={active || busy}
                          />
                        </label>
                      )}
                      {(task === "regression" || task === "forecasting") && (
                        <label>
                          Target / measure units (optional)
                          <input
                            value={unit}
                            onChange={(e) => setUnit(e.target.value)}
                            maxLength={32}
                            placeholder="e.g. INR, units"
                            disabled={active || busy}
                          />
                        </label>
                      )}
                    </div>
                  </details>
                  <p className="ml-split-policy">{splitPolicy(task)}</p>
                  <label className="ml-consent">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={active || busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>
                      {task === "forecasting"
                        ? "I confirm the date, measure, aggregation and missing-period policy."
                        : "I confirm selected predictors are available at prediction time and exclude IDs, target-derived values and future outcomes."}
                    </span>
                  </label>
                  <details className="method-note">
                    <summary>Training limits</summary>
                    <p>
                      Up to 5,000 rows, 24 features and 120 seconds. Fixed model
                      candidates run locally with a 512 MiB memory limit.
                    </p>
                  </details>
                </Card>
              )}
              <details className="ml-readiness ml-about ui-card">
                <summary>About your data</summary>
                {profile ? (
                  <>
                    <span
                      className={
                        profile.readiness.ready
                          ? "ml-readiness-state ready"
                          : "ml-readiness-state"
                      }
                    >
                      {profile.readiness.ready ? "Ready to train" : "Not ready yet"}
                    </span>
                    <div className="ml-readiness-counts">
                      <div>
                        <strong>
                          {formatNumber(
                            profile.columns.filter(
                              (c) => c.kind === "categorical",
                            ).length,
                          )}
                        </strong>
                        <small>categorical columns</small>
                      </div>
                      <div>
                        <strong>
                          {formatNumber(
                            profile.columns.reduce(
                              (sum, c) => sum + c.missing,
                              0,
                            ),
                          )}
                        </strong>
                        <small>missing sampled cells</small>
                      </div>
                      <div>
                        <strong>{formatNumber(profile.total_rows)}</strong>
                        <small>rows in your file</small>
                      </div>
                      <div>
                        <strong>{formatNumber(profile.duplicate_rows)}</strong>
                        <small>duplicate sampled rows</small>
                      </div>
                      <div>
                        <strong>
                          {formatNumber(
                            profile.columns.filter((c) => c.kind === "numeric")
                              .length,
                          )}
                        </strong>
                        <small>numerical columns</small>
                      </div>
                      <div>
                        <strong>
                          {formatNumber(
                            profile.columns.filter((c) => c.kind === "datetime")
                              .length,
                          )}
                        </strong>
                        <small>date/time columns</small>
                      </div>
                    </div>
                    <p className="insight-note">
                      {profile.sampled
                        ? `Profile sample: ${formatNumber(profile.sampled_rows)} / ${formatNumber(profile.total_rows)} rows. Training larger datasets is blocked.`
                        : `Profile covers all ${formatNumber(profile.sampled_rows)} rows.`}{" "}
                      {plainTerms(profile.policy)}
                    </p>
                    {profile.readiness.reasons.map((r) => (
                      <p className="ml-warning" key={r}>
                        {plainTerms(r)}
                      </p>
                    ))}
                    {profile.readiness.warnings.map((w) => (
                      <p className="ml-warning" key={w}>
                        {w}
                      </p>
                    ))}
                    <details>
                      <summary>Column quality &amp; file check</summary>
                      <MLTable
                        rows={profile.columns.map((c) => ({
                          column: c.name,
                          suggested_type: c.kind,
                          missing: c.missing,
                          unique: c.cardinality,
                          numeric_valid: c.numeric_valid,
                          date_valid: c.date_valid,
                          date_start: c.date_start,
                          date_end: c.date_end,
                        }))}
                      />
                      <small className="fingerprint">
                        {profile.fingerprint}
                      </small>
                    </details>
                  </>
                ) : (
                  <p className="insight-note">
                    Choose a registered dataset to inspect readiness.
                  </p>
                )}
                <details className="ml-principles">
                  <summary>How models are evaluated</summary>
                  <ShieldCheck size={20} />

                  <p>
                    Train, validation and test stay separate. Duplicate feature
                    rows are grouped. Transformations learn from training rows
                    only. Models and actual metrics persist locally.
                  </p>
                </details>
              </details>
            </div>
          )}
          {step === 2 && (
            <>
              <p>
                Training uses your confirmed configuration on{" "}
                <DatasetName
                  name={
                    datasets.find((d) => d.id === datasetId)?.name || datasetId
                  }
                />
                . Local training · 0 LLM calls.
              </p>{" "}
              <Button
                id="ml-train"
                disabled={!canTrain}
                onClick={() =>
                  void action(async () => {
                    const next = await automlApi.train(configuration());
                    setJob(next);
                    setPrediction(null);
                    setNotice(
                      "Local experiment queued. No provider calls are made.",
                    );
                    await reload();
                  })
                }
              >
                <Play size={15} />
                Train local models
              </Button>
              {job && (
                <Card className="ml-job" aria-label="ML training progress">
                  <div>
                    <h2>{job.title}</h2>
                    <p role="status">
                      {job.status} ·{" "}
                      <DatasetName
                        name={job.dataset_name}
                        datasetId={job.dataset_id}
                        provenance
                      />
                      {job.duration_seconds != null
                        ? " · " + job.duration_seconds + "s"
                        : ""}
                    </p>
                  </div>
                  {active ? (
                    <>
                      <progress aria-label="Local training active" />
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await automlApi.cancel(job.id);
                            setNotice(
                              "Cancellation requested; the local worker will be stopped.",
                            );
                          })
                        }
                      >
                        Cancel training
                      </Button>
                    </>
                  ) : (
                    <StatusChip tone={statusTone(job.status)} className="ml-badge">{job.status}</StatusChip>
                  )}
                  {job.error && (
                    <ErrorState as="p" role="alert" className="alert">
                      {job.error}
                    </ErrorState>
                  )}
                </Card>
              )}
            </>
          )}
          {step === 4 && (
            <div id="ml-review">
              {job?.result && <AutoMLResults job={job} />}
            </div>
          )}
          {step === 4 && (
            <>
              <Card
                className="ml-registry"
                id="ml-predict"
                aria-label="Local model registry"
              >
                <div className="insight-heading">
                  <div>
                    <h2>Predict with a saved model</h2>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void action(reload)}
                  >
                    Refresh saved models
                  </Button>
                </div>
                <p className="insight-note">
                  Predictions are estimates from the saved model. The saved data
                  check still applies: if the source file has changed, been
                  archived or been deleted, new predictions can be blocked.
                </p>
                {!!models.length && (
                  <TableFrame label="Saved model library">
                    <table aria-label="Saved model library">
                      <thead>
                        <tr>
                          {[
                            "Model",
                            "Task",
                            "Target",
                            "Recorded metric",
                            "Trained",
                            "Source",
                          ].map((label) => (
                            <th scope="col" key={label}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {models.map((m) => {
                          const metrics =
                            m.metrics.test ||
                            m.metrics.validation ||
                            m.metrics.validation_backtests ||
                            m.metrics.descriptive;
                          const key = Object.keys(metrics || {}).find((k) =>
                            m.selection_metric
                              .toLowerCase()
                              .endsWith(k.toLowerCase()),
                          );
                          return (
                            <tr key={m.id}>
                              <td>
                                {m.configuration.title || m.algorithm} ·{" "}
                                {m.algorithm}
                              </td>
                              <td>{mlTaskLabel(m.task)}</td>
                              <td>
                                {m.configuration.target ||
                                  m.configuration.forecast?.measure ||
                                  "Not applicable"}
                              </td>
                              <td>
                                {key
                                  ? (METRIC_LABELS[key] || key) + ": " + mlValue(metrics?.[key])
                                  : m.selection_metric +
                                    " · " +
                                    Object.entries(metrics || {})
                                      .map(
                                        ([key, value]) =>
                                          key + ": " + mlValue(value),
                                      )
                                      .join(", ")}
                              </td>
                              <td>{formatDate(m.created_at, "datetime")}</td>
                              <td>
                                <DatasetName
                                  name={
                                    history.find(
                                      (h) => h.id === m.experiment_id,
                                    )?.dataset_name || m.dataset_id
                                  }
                                  datasetId={m.dataset_id}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableFrame>
                )}
                {!models.length ? (
                  <EmptyState as="p" className="ml-empty-note">
                    No saved models yet. Train one and it will appear here.
                  </EmptyState>
                ) : (
                  <>
                    <label>
                      Saved model
                      <select
                        value={modelId}
                        disabled={busy || active}
                        onChange={(e) => {
                          setModelId(e.target.value);
                          const experiment = history.find(
                            (j) =>
                              j.id ===
                              models.find((m) => m.id === e.target.value)
                                ?.experiment_id,
                          );
                          if (experiment) setJob(experiment);
                        }}
                      >
                        <option value="">Choose a saved model</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.algorithm} · {mlTaskLabel(m.task)} ·{" "}
                            {m.selected
                              ? "selected on " + m.selection_metric
                              : "candidate"}{" "}
                            · {m.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {model && (
                      <>
                        <p>
                          Model: {model.algorithm} · version{" "}
                          {model.versions.automl || "not recorded"} · trained{" "}
                          {formatDate(model.created_at, "datetime")} · target{" "}
                          {model.configuration.target ||
                            model.configuration.forecast?.measure ||
                            "Not applicable"}
                        </p>
                        <p>
                          Stored source:{" "}
                          <DatasetName
                            name={
                              inputSchema?.dataset_name ||
                              history.find((h) => h.id === model.experiment_id)
                                ?.dataset_name ||
                              model.dataset_id
                            }
                            datasetId={model.dataset_id}
                            provenance
                          />{" "}
                          ·{" "}
                          {plainTerms(inputSchema?.source_status) ||
                            "Checking stored source…"}
                        </p>
                        <small>
                          The saved data check, not a version number,
                          decides whether this model still matches its source.
                        </small>
                        {inputSchema && <p>{plainTerms(inputSchema.scope)}</p>}
                        <UnitConfirmation id={model.id} stored={model.configuration.target_unit}/>
                    <h3>Generate a prediction</h3>
                        {model.task === "forecasting" ? (
                          <>
                          <details className="ml-howto">
                            <summary>What do these options mean?</summary>
                            <dl>
                              {forecastHelp(model.configuration.forecast?.horizon, model.configuration.forecast?.frequency).map((h) => (
                                <div key={h.term}>
                                  <dt>{h.term}</dt>
                                  <dd>{h.text}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                          <p className="insight-note">
                            Forecast the saved evaluated horizon of{" "}
                            {model.configuration.forecast?.horizon}{" "}
                            {model.configuration.forecast?.frequency} periods
                            using the full-history deployment fit. No intervals.
                          </p>
                          </>
                        ) : (
                          <>
                            <details className="ml-howto">
                              <summary>What do these options mean?</summary>
                              <dl>
                                {PREDICTION_HELP.map((h) => (
                                  <div key={h.term}>
                                    <dt>{h.term}</dt>
                                    <dd>{h.text}</dd>
                                  </div>
                                ))}
                              </dl>
                              <p>The result is an <strong>estimate</strong> calculated by the model for the values given. It is not a value copied from your file.</p>
                            </details>
                            <label>
                              Prediction input
                              <select
                                value={predictionMode}
                                disabled={busy || active}
                                onChange={(e) =>
                                  setPredictionMode(
                                    e.target.value as typeof predictionMode,
                                  )
                                }
                              >
                                <option value="single">Single record</option>
                                <option value="batch">
                                  Existing registered dataset
                                </option>
                              </select>
                            </label>
                            {predictionMode === "batch" ? (
                              <>
                                <label>
                                  Batch prediction dataset
                                  <select
                                    value={batchId}
                                    title={
                                      datasets.find((d) => d.id === batchId)
                                        ? displayName(
                                            datasets.find(
                                              (d) => d.id === batchId,
                                            )!,
                                          )
                                        : undefined
                                    }
                                    disabled={busy || active}
                                    onChange={(e) => setBatchId(e.target.value)}
                                  >
                                    {(uploadedBatch &&
                                    !datasets.some(
                                      (d) => d.id === uploadedBatch.id,
                                    )
                                      ? [...datasets, uploadedBatch]
                                      : datasets
                                    )
                                      .filter((d) => !d.archived_at)
                                      .map((d) => (
                                        <option
                                          key={d.id}
                                          value={d.id}
                                          title={d.name}
                                        >
                                          {middleEllipsis(displayName(d))} ·{" "}
                                          {formatNumber(d.rows)} rows
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                {globalDataset &&
                                  batchId !== globalDataset.activeId && (
                                    <p className="dataset-override">
                                      Using a different dataset from the global
                                      selection.{" "}
                                      <Button
                                        variant="ghost"
                                        disabled={busy || active}
                                        onClick={() =>
                                          setBatchId(globalDataset.activeId)
                                        }
                                      >
                                        Use global
                                      </Button>
                                    </p>
                                  )}
                                <label>
                                  Upload batch CSV
                                  <input
                                    type="file"
                                    accept=".csv,text/csv"
                                    disabled={busy || active}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file)
                                        void action(async () => {
                                          const dataset =
                                            await api.upload(file);
                                          await globalDataset?.refresh();
                                          setUploadedBatch(dataset);
                                          setBatchId(dataset.id);
                                          setInputValidation(null);
                                          setNotice(
                                            "CSV registered for batch prediction. Global dataset unchanged.",
                                          );
                                        });
                                    }}
                                  />
                                </label>
                                <p className="insight-note">
                                  Required feature names/types must match. Extra
                                  columns are ignored. RFM models aggregate
                                  customers with the saved reference date.
                                  Predictions on training data are labeled as
                                  replay, not held-out evaluation.
                                </p>
                              </>
                            ) : (
                              <>
                                <div className="ml-field-grid">
                                  {model.feature_schema.map((f) => (
                                    <label key={f.name}>
                                      {f.name} ({f.kind})
                                      {inputSchema?.features.find(
                                        (v) => v.name === f.name,
                                      )?.categories.length ? (
                                        <select
                                          aria-label={
                                            "Prediction feature " + f.name
                                          }
                                          value={record[f.name] || ""}
                                          onChange={(e) =>
                                            setRecord((r) => ({
                                              ...r,
                                              [f.name]: e.target.value,
                                            }))
                                          }
                                        >
                                          <option value="">
                                            Use the typical value from training
                                          </option>
                                          {inputSchema.features
                                            .find((v) => v.name === f.name)!
                                            .categories.map((v) => (
                                              <option key={v}>{v}</option>
                                            ))}
                                        </select>
                                      ) : (
                                        <input
                                          type={
                                            f.kind === "numeric"
                                              ? "number"
                                              : f.kind === "datetime"
                                                ? "date"
                                                : "text"
                                          }
                                          step={
                                            f.kind === "numeric"
                                              ? "any"
                                              : undefined
                                          }
                                          aria-label={
                                            "Prediction feature " + f.name
                                          }
                                          value={record[f.name] || ""}
                                          disabled={busy || active}
                                          onChange={(e) =>
                                            setRecord((r) => ({
                                              ...r,
                                              [f.name]: e.target.value,
                                            }))
                                          }
                                          placeholder={
                                            f.kind === "datetime"
                                              ? "YYYY-MM-DD or ISO timestamp"
                                              : f.kind === "numeric"
                                                ? "Finite number"
                                                : "Category label"
                                          }
                                        />
                                      )}
                                      {inputSchema?.features.find(
                                        (v) => v.name === f.name,
                                      )?.minimum != null ? (
                                        <small>
                                          Recorded training range:{" "}
                                          {formatNumber(
                                            inputSchema.features.find(
                                              (v) => v.name === f.name,
                                            )!.minimum!,
                                          )}{" "}
                                          to{" "}
                                          {formatNumber(
                                            inputSchema.features.find(
                                              (v) => v.name === f.name,
                                            )!.maximum!,
                                          )}{" "}
                                          · hint only
                                        </small>
                                      ) : (
                                        f.kind === "numeric" && (
                                          <small>
                                            Training range not recorded or
                                            unavailable.
                                          </small>
                                        )
                                      )}
                                      {inputErrors[f.name] && (
                                        <ErrorState as="span" role="alert">
                                          {inputErrors[f.name]}
                                        </ErrorState>
                                      )}
                                    </label>
                                  ))}
                                </div>
                                <p className="insight-note">
                                  Blank inputs use the typical value found in the
                                  training data. Unknown categories are handled by
                                  the saved encoder. RFM single records
                                  use recency_days, frequency and monetary
                                  features, not raw customer IDs.
                                </p>
                              </>
                            )}
                          </>
                        )}
                        {inputValidation && (
                          <section aria-label="Input validation results">
                            <p>
                              {formatNumber(inputValidation.rows)} rows checked ·{" "}
                              {formatNumber(inputValidation.rejected_row_count)} rejected
                              rows.{" "}
                              {inputValidation.valid
                                ? "Ready to predict."
                                : "The entire batch is withheld; no partial predictions are created."}
                            </p>
                            {inputValidation.rejected_rows.map((row, i) => (
                              <ErrorState as="p" key={i} role="alert">
                                Row {formatNumber(row.row)}
                                {row.field ? " · " + row.field : ""}:{" "}
                                {row.reason}
                              </ErrorState>
                            ))}
                          </section>
                        )}
                        <Button
                          disabled={
                            busy ||
                            active ||
                            (model.task !== "forecasting" &&
                              predictionMode === "batch" &&
                              !batchId)
                          }
                          onClick={() =>
                            void action(async () => {
                              const input =
                                model.task === "forecasting"
                                  ? {
                                      horizon:
                                        model.configuration.forecast!.horizon,
                                    }
                                  : predictionMode === "batch"
                                    ? { dataset_id: batchId }
                                    : {
                                        records: [
                                          Object.fromEntries(
                                            model.feature_schema.map((f) => [
                                              f.name,
                                              record[f.name] || null,
                                            ]),
                                          ),
                                        ],
                                      };
                              const checked = await automlApi.validateInput(
                                model.id,
                                input,
                              );
                              setInputValidation(checked);
                              setInputErrors(
                                Object.fromEntries(
                                  checked.rejected_rows
                                    .filter((r) => r.field)
                                    .map((r) => [r.field!, r.reason]),
                                ),
                              );
                              if (!checked.valid) {
                                setNotice(
                                  "Input rejected. No prediction was created.",
                                );
                                return;
                              }
                              setPrediction(
                                await automlApi.predict(model.id, input),
                              );
                              await reload();
                              setNotice(
                                "Prediction computed using the saved local model.",
                              );
                            })
                          }
                        >
                          {busy
                            ? "Computing locally…"
                            : "Predict with saved model"}
                        </Button>
                        {model.task === "regression" && (
                          <small>
                            Prediction units: not inferred; values use the
                            recorded target scale.
                          </small>
                        )}
                      </>
                    )}
                  </>
                )}
                {prediction && (
                  <section
                    className="ml-prediction"
                    aria-label="ML prediction results"
                  >
                    <h3>Prediction results</h3>
                    <p>{prediction.scope}</p>
                    <div className="ml-prediction-meaning" aria-label="What this prediction means">
                      <h4>What this prediction means</h4>
                      {(() => {
                        const made = models.find((m) => m.id === prediction.model_id) || model;
                        if (!made) return null;
                        return predictionMeaning({
                          task: made.task,
                          target: made.task === "forecasting" ? made.configuration.forecast?.measure : made.configuration.target,
                          rows: prediction.rows,
                          rowCount: prediction.row_count,
                          heldOutMae: made.metrics.test?.mae ?? null,
                          batch: !!prediction.dataset_id && made.task !== "forecasting",
                        }).map((line, i) => <p key={i}>{line}</p>);
                      })()}
                    </div>
                    <p className="insight-note">
                      Showing {formatNumber(prediction.offset + 1)}–
                      {formatNumber(prediction.offset + prediction.rows.length)} /{" "}
                      {formatNumber(prediction.row_count)} rows. All accepted
                      rows are in the CSV export. Classification probabilities
                      are model estimates; anomaly flags are not fraud labels.
                    </p>
                    <MLTable
                      rows={prediction.rows}
                      columns={prediction.columns}
                    />
                    <div className="toolbar">
                      <a
                        className="button button-outline"
                        href={`/api/automl/predictions/${prediction.id}/export.csv`}
                      >
                        Export prediction CSV
                      </a>
                      <Button
                        variant="outline"
                        disabled={busy || prediction.offset === 0}
                        onClick={() =>
                          void action(async () =>
                            setPrediction(
                              await automlApi.prediction(
                                prediction.id,
                                Math.max(0, prediction.offset - 50),
                              ),
                            ),
                          )
                        }
                      >
                        Previous prediction rows
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          prediction.offset + prediction.rows.length >=
                            prediction.row_count
                        }
                        onClick={() =>
                          void action(async () =>
                            setPrediction(
                              await automlApi.prediction(
                                prediction.id,
                                prediction.offset + 50,
                              ),
                            ),
                          )
                        }
                      >
                        Next prediction rows
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await automlApi.deletePrediction(prediction.id);
                            setPrediction(null);
                            await reload();
                          })
                        }
                      >
                        Delete prediction record
                      </Button>
                    </div>
                  </section>
                )}
                {savedPredictions.length > 0 && (
                  <details className="insight-panel">
                    <summary>
                      Saved prediction exports ·{" "}
                      {formatNumber(savedPredictions.length)}
                    </summary>
                    {savedPredictions.map((p) => (
                      <div className="ml-history-item" key={p.id}>
                        <span>
                          {formatDate(p.created_at, "datetime")} ·{" "}
                          {formatNumber(p.row_count)} rows · {p.scope}
                        </span>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void action(async () =>
                              setPrediction(await automlApi.prediction(p.id)),
                            )
                          }
                        >
                          Open prediction
                        </Button>
                      </div>
                    ))}
                  </details>
                )}
              </Card>
            </>
          )}
          {step === 1 && (
            <details className="ml-history ui-card">
              <summary>Earlier experiments ({formatNumber(history.length)})</summary>
              <p className="insight-note">
                Reopen an experiment to review its models and measured results.
              </p>
              {!history.length ? (
                <EmptyState as="p" className="ml-empty-note">
                  No training runs yet. Nothing trains until you press Train local models.
                </EmptyState>
              ) : (
                history.map((h) => (
                  <div key={h.id} className="ml-history-item">
                    <div>
                      <strong>{h.title}</strong>
                      <small>
                        {mlTaskLabel(h.task)} ·{" "}
                        <DatasetName
                          name={h.dataset_name}
                          datasetId={h.dataset_id}
                          provenance
                        />{" "}
                        · {h.status} ·{" "}
                        {h.duration_seconds == null
                          ? "—"
                          : formatNumber(h.duration_seconds)}
                        s
                      </small>
                    </div>
                    <div className="toolbar">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            const selected = await automlApi.experiment(h.id);
                            setJob(selected);
                            setStep(selected.result ? 4 : 2);
                            setFurthest(selected.result ? 1 : 2);
                            if (selected.result)
                              setModelId(selected.result.selected_model_id);
                          })
                        }
                      >
                        Inspect experiment
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || active || !terminal.has(h.status)}
                        onClick={() =>
                          void action(async () => {
                            await automlApi.deleteExperiment(h.id);
                            if (job?.id === h.id) setJob(null);
                            await reload();
                            setNotice(
                              "Experiment, its models and linked prediction artifacts deleted.",
                            );
                          })
                        }
                      >
                        Delete experiment &amp; models
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </details>
          )}
          <div className="ml-wizard-actions">
            {step > 1 && (
              <Button
                variant="outline"
                disabled={active || busy}
                onClick={() => go(step === 4 && !job?.result ? 1 : step === 4 ? 2 : 1)}
              >
                Back
              </Button>
            )}
            {step === 1 && (
              <Button
                disabled={!!stepReason || busy}
                aria-describedby="ml-step-reason"
                onClick={() => go(2)}
              >
                Next: check and train
              </Button>
            )}
            <span id="ml-step-reason" role="status">
              {stepReason}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
