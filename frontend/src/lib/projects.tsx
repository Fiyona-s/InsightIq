import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Stage 2: Projects. The active project is remembered in this browser (localStorage) and sent to
 * the API as the `insightiq_project` cookie, so every request (including downloads, report links
 * and live progress streams) is scoped without changing each API call.
 */
export const DEFAULT_PROJECT = "default";
export const ACTIVE_PROJECT_KEY = "insightiq-active-project-v1";
const COOKIE = "insightiq_project";

export interface Project {
  id: string;
  name: string;
  is_default: boolean;
  archived_at: string | null;
  created_at: string | null;
}
export interface ProjectDependencies {
  project: Project;
  counts: Record<string, number>;
  on_delete: string;
}

export function activeProjectId(): string {
  try {
    const value = localStorage.getItem(ACTIVE_PROJECT_KEY);
    return value && /^(default|[0-9a-f-]{36})$/i.test(value) ? value : DEFAULT_PROJECT;
  } catch {
    return DEFAULT_PROJECT;
  }
}
export function syncProjectCookie(id = activeProjectId()) {
  document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; SameSite=Lax`;
}
function remember(id: string) {
  try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch { /* optional preference */ }
  syncProjectCookie(id);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/projects" + path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error((body && typeof body.detail === "string" && body.detail) || "Something went wrong. Please try again.");
  return body as T;
}
export const projectsApi = {
  list: () => call<Project[]>(""),
  create: (name: string) => call<Project>("", { method: "POST", body: JSON.stringify({ name }) }),
  rename: (id: string, name: string) => call<Project>(`/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  archive: (id: string) => call<Project>(`/${id}/archive`, { method: "POST" }),
  restore: (id: string) => call<Project>(`/${id}/restore`, { method: "POST" }),
  dependencies: (id: string) => call<ProjectDependencies>(`/${id}/dependencies`),
  remove: (id: string, confirm_name: string) => call<{ items_moved_to_default: number }>(`/${id}`, { method: "DELETE", body: JSON.stringify({ confirm_name }) }),
};

type Value = {
  projects: Project[];
  activeId: string;
  active: Project | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<Project[]>;
  /** Switch the whole app to another project (reloads so every page starts clean in that project). */
  switchTo: (id: string) => void;
};
const ProjectContext = createContext<Value | null>(null);

const reloadPage = () => window.location.reload();
export function ProjectProvider({ children, reload = reloadPage }: { children: ReactNode; reload?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const activeId = activeProjectId();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const switchTo = useCallback((id: string) => { remember(id); reloadRef.current(); }, []);
  const refresh = useCallback(async () => {
    try {
      const list = await projectsApi.list();
      setProjects(list);
      setError("");
      // A remembered project that was archived or deleted elsewhere falls back to Default.
      const current = list.find((p) => p.id === activeProjectId());
      if (activeProjectId() !== DEFAULT_PROJECT && (!current || current.archived_at)) switchTo(DEFAULT_PROJECT);
      return list;
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [switchTo]);
  useEffect(() => { syncProjectCookie(); void refresh(); }, [refresh]);
  const active = projects.find((p) => p.id === activeId) || null;
  return <ProjectContext.Provider value={{ projects, activeId, active, loading, error, refresh, switchTo }}>{children}</ProjectContext.Provider>;
}
export const useProjects = () => useContext(ProjectContext);
