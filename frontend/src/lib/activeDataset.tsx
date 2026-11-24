import { whenIdle } from "./defer";
import { useAuth } from "./auth";
import { activeProjectId, DEFAULT_PROJECT } from "./projects";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, analystApi, type Dataset } from "../api";
import { automlApi } from "../automlapi";
import { displayName,useDatasetNames } from "./datasetNames";
import { Button } from "../components/ui/button";
import { Modal } from "../components/ui/overlay";
export const ACTIVE_KEY = "insightiq-active-dataset-v1";
/** Stage 2: the active dataset is remembered per project (Default keeps the original key). */
export const activeKey = () => { const project = activeProjectId(); return project === DEFAULT_PROJECT ? ACTIVE_KEY : `${ACTIVE_KEY}:${project}`; };
export const readLocal = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional local preferences. */
  }
}
export function restoreDataset(datasets: Dataset[], saved: unknown) {
  const state =
    saved && typeof saved === "object"
      ? (saved as { id?: unknown; mru?: unknown })
      : {};
  const active = datasets.filter((d) => !d.archived_at && !d.is_benchmark);
  const id = typeof state.id === "string" ? state.id : "";
  const mru = Array.isArray(state.mru)
    ? state.mru.filter((v): v is string => typeof v === "string")
    : [];
  return {
    id:
      active.find((d) => d.id === id)?.id ||
      mru.find((v) => active.some((d) => d.id === v)) ||
      active.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        ?.id ||
      "",
    unavailable: !!id && !active.some((d) => d.id === id),
  };
}
export const selectorDatasets = (
  datasets: Dataset[],
  id: string,
  hide: boolean,
  search = "",
) =>
  datasets.filter(
    (d) =>
      !d.archived_at &&
      !d.is_benchmark &&
      (!hide || !d.is_sample || d.id === id) &&
      (displayName(d) + " " + d.name)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
export type SwitchGuard = {
  title: string;
  message: string;
  save?: () => Promise<boolean>;
  discard?: () => void;
  continueLabel?: string;
  blocked?: boolean;
};
type Job = {
  id: string;
  datasetId: string;
  name: string;
  kind: "Analyst" | "AutoML";
  status: string;
};
type Value = {
  datasets: Dataset[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  activeId: string;
  active: Dataset | null;
  select: (id: string) => Promise<boolean>;
  confirmEditorLeave: () => Promise<boolean>;
  notice: string;
  clearNotice: () => void;
  hideSamples: boolean;
  setHideSamples: (value: boolean) => void;
  register: (key: string, guard: () => SwitchGuard | null) => () => void;
  jobs: Job[];
  track: (job: Job) => void;
  profileViews: string[];
  viewProfile: (id: string) => void;
};
export const ActiveDatasetContext = createContext<Value | null>(null);
export const useActiveDataset = () => useContext(ActiveDatasetContext);
export function useDatasetGuard(key: string, guard: () => SwitchGuard | null) {
  const context = useActiveDataset(),
    latest = useRef(guard);
  latest.current = guard;
  const register = context?.register;
  useEffect(() => register?.(key, () => latest.current()), [register, key]);
}
export function ActiveDatasetProvider({ children }: { children: ReactNode }) {
  // Login on, Viewer role: a viewer has no datasets, questions or jobs to load, and must not call those routes at all.
  const viewerOnly = useAuth().role === "viewer";
  const names=useDatasetNames();
  const [datasets, setDatasets] = useState<Dataset[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [activeId, setActiveId] = useState(""),
    [notice, setNotice] = useState("");
  const [hideSamples, setHide] = useState(() => {
    try {
      return localStorage.getItem("insightiq-hide-samples") === "true";
    } catch {
      return false;
    }
  });
  const [profileViews, setViews] = useState<string[]>(() => {
    const v = readLocal("insightiq-profile-views-v1");
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  });
  const [jobs, setJobs] = useState<Job[]>([]),
    jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const guards = useRef(new Map<string, () => SwitchGuard | null>()),
    currentId = useRef(""),
    initialized = useRef(false),
    generation = useRef(0),
    switching = useRef(false);
  const [prompt, setPrompt] = useState<{
      guard: SwitchGuard;
      resolve: (v: boolean) => void;
    } | null>(null),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const persist = useCallback((id: string) => {
    const saved = readLocal(activeKey()) as { mru?: unknown } | null;
    const mru = Array.isArray(saved?.mru)
      ? saved.mru.filter((v): v is string => typeof v === "string")
      : [];
    writeLocal(activeKey(), {
      id,
      mru: [id, ...mru.filter((v) => v !== id)].filter(Boolean).slice(0, 50),
    });
    currentId.current = id;
    setActiveId(id);
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (viewerOnly) { setDatasets([]); setLoading(false); setError(""); return; }
    setLoading(true);
    setError("");
    try {
      const all = await api.list(true);
      if (request !== generation.current) return;
      setDatasets(all);
      const restored = restoreDataset(
        all,
        initialized.current
          ? {
              id: currentId.current,
              mru: (readLocal(activeKey()) as { mru?: unknown })?.mru,
            }
          : readLocal(activeKey()),
      );
      if (restored.unavailable)
        setNotice("Your previous dataset is no longer available");
      initialized.current = true;
      persist(restored.id);
      window.dispatchEvent(new Event("insightiq:datasets-changed"));
    } catch (e) {
      if (request === generation.current) setError((e as Error).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [persist, viewerOnly]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!jobs.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(
        jobs.map(async (job) => {
          try {
            const next =
              job.kind === "Analyst"
                ? await analystApi.run(job.id)
                : await automlApi.experiment(job.id);
            return { ...job, status: next.status };
          } catch {
            return job;
          }
        }),
      ).then((next) => {
        if (!cancelled)
          setJobs(
            next.filter(
              (j) =>
                ![
                  "succeeded",
                  "failed",
                  "cancelled",
                  "clarification",
                  "completed",
                ].includes(j.status),
            ),
          );
      });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobs]);
  const register = useCallback(
    (key: string, guard: () => SwitchGuard | null) => {
      guards.current.set(key, guard);
      return () => {
        guards.current.delete(key);
      };
    },
    [],
  );
  async function select(id: string) {
    if (id === currentId.current) return true;
    const focused = document.activeElement as HTMLElement | null;
    if (
      switching.current ||
      !datasets.some((d) => d.id === id && !d.archived_at)
    )
      return false;
    switching.current = true;
    try {
      const checks = [...guards.current.values()]
        .map((g) => g())
        .filter((g): g is SwitchGuard => !!g);
      const running = jobsRef.current.filter(
        (j) => j.datasetId === currentId.current,
      );
      if (running.length)
        checks.push({
          title: "A job is still running",
          message: running
            .map((j) => `${j.kind} continues using ${datasets.find(d=>d.id===j.datasetId)?displayName(datasets.find(d=>d.id===j.datasetId)!):names.label(j.datasetId,j.name)}.`)
            .join(" "),
          continueLabel: "Switch dataset",
        });
      for (const guard of checks) {
        setSaveError("");
        if (
          !(await new Promise<boolean>((resolve) =>
            setPrompt({ guard, resolve }),
          ))
        )
          return false;
      }
      persist(id);
      return true;
    } finally {
      switching.current = false;
      requestAnimationFrame(() => {
        if (focused?.isConnected) focused.focus();
        else
          document
            .querySelector<HTMLButtonElement>('[aria-label="Active dataset"]')
            ?.focus();
      });
    }
  }
  const track = useCallback((job: Job) => {
    if (
      [
        "succeeded",
        "failed",
        "cancelled",
        "clarification",
        "completed",
      ].includes(job.status)
    )
      return;
    setJobs((items) =>
      items.some((j) => j.id === job.id) ? items : [...items, job],
    );
  }, []);
  const viewProfile = useCallback(
    (id: string) =>
      setViews((items) => {
        if (items.includes(id)) return items;
        const next = [...items, id];
        writeLocal("insightiq-profile-views-v1", next);
        return next;
      }),
    [],
  );
  useEffect(() => {
    if (viewerOnly) return;
    let current = true;
    // Resuming progress tracking of jobs that were already running is not needed for the first screen: do it once idle.
    const cancel = whenIdle(() => void Promise.all([analystApi.history(), automlApi.experiments()])
      .then(([runs, experiments]) => {
        if (!current) return;
        for (const r of Array.isArray(runs) ? runs : [])
          if (["queued", "generating", "executing"].includes(r.status))
            track({
              id: r.id,
              datasetId: r.dataset_id,
              name: r.dataset_name,
              kind: "Analyst",
              status: r.status,
            });
        for (const j of Array.isArray(experiments) ? experiments : [])
          if (["queued", "running"].includes(j.status))
            track({
              id: j.id,
              datasetId: j.dataset_id,
              name: j.dataset_name,
              kind: "AutoML",
              status: j.status,
            });
      })
      .catch(() => {}));
    return () => {
      current = false;
      cancel();
    };
  }, [track, viewerOnly]);
  const confirmEditorLeave=useCallback(async()=>{const guard=guards.current.get('dataset-editor')?.()||guards.current.get('automl-config')?.()||guards.current.get('dashboard-details')?.();if(!guard)return true;const focused=document.activeElement as HTMLElement|null;setSaveError('');try{return await new Promise<boolean>(resolve=>setPrompt({guard,resolve}))}finally{requestAnimationFrame(()=>{if(focused?.isConnected)focused.focus()})}},[]);
  const value: Value = {
    datasets,
    loading,
    error,
    refresh,
    activeId,
    active: datasets.find((d) => d.id === activeId && !d.archived_at) || null,
    select,
    confirmEditorLeave,
    notice,
    clearNotice: () => setNotice(""),
    hideSamples,
    setHideSamples: (v) => {
      setHide(v);
      try {
        localStorage.setItem("insightiq-hide-samples", String(v));
      } catch {
        /* optional */
      }
    },
    register,
    jobs,
    track,
    profileViews,
    viewProfile,
  };
  return (
    <ActiveDatasetContext.Provider value={value}>
      {/* A native modal dialog makes everything behind it inert, so no inert wrapper is needed. */}
      <div>{children}</div>
      {prompt && (
        <Modal
          open
          title={prompt.guard.title}
          busy={saving}
          className="phase3-switch-dialog"
          onClose={() => {
            prompt.resolve(false);
            setPrompt(null);
          }}
          footer={
            <>
              <Button
                autoFocus
                disabled={saving}
                variant="outline"
                onClick={() => {
                  prompt.resolve(false);
                  setPrompt(null);
                }}
              >
                Cancel
              </Button>
              {prompt.guard.save && (
                <Button
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      if (await prompt.guard.save!()) {
                        prompt.resolve(true);
                        setPrompt(null);
                      } else
                        setSaveError(
                          "Changes were not saved. Review the editor and try again.",
                        );
                    } catch (e) {
                      setSaveError((e as Error).message);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save
                </Button>
              )}
              {!prompt.guard.blocked && (
                <Button
                  disabled={saving}
                  onClick={() => {
                    prompt.guard.discard?.();
                    prompt.resolve(true);
                    setPrompt(null);
                  }}
                >
                  {prompt.guard.continueLabel ||
                    (prompt.guard.save ? "Discard" : "Reset and switch")}
                </Button>
              )}
            </>
          }
        >
          <p>{prompt.guard.message}</p>
          {saveError && <p role="alert">{saveError}</p>}
        </Modal>
      )}
    </ActiveDatasetContext.Provider>
  );
}
