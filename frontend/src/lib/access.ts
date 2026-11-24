/**
 * Accounts A3: which pages each role sees when login is on (hosted mode). With login off (local mode) the role is null and
 * every page is allowed, exactly as before. This only decides what the interface shows; the API checks the role on every
 * route itself (ROUTE_ACCESS on the server).
 */
export type Role = "viewer" | "analyst" | "owner";
export const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", analyst: "Analyst", owner: "Owner" };

const VIEWER = ["Overview", "Dashboards", "Change password"];
const ANALYST = [...VIEWER, "AI Analyst", "Data workspace", "AutoML Studio", "Knowledge base", "Settings", "Projects", "Design"];
// The accuracy check ("Evaluation center") is not served at all in hosted mode, so no role lists it.
const OWNER = [...ANALYST, "Run analytics", "Execution traces", "Change history", "Backup info", "People", "Security log"];
// Pages that only exist when sign-in is on (A4). With sign-in off they are not offered at all.
const SIGN_IN_ONLY = ["People", "Security log", "Change password"];
const PAGES: Record<Role, string[]> = { viewer: VIEWER, analyst: ANALYST, owner: OWNER };

export type PageAccess = { allowed: true } | { allowed: false; reason: "role" | "hosted" | "signin" };

export function pageAccess(page: string, role: Role | null): PageAccess {
  if (role === null) return SIGN_IN_ONLY.includes(page) ? { allowed: false, reason: "signin" } : { allowed: true };
  if (page === "Evaluation center") return { allowed: false, reason: "hosted" };
  return PAGES[role].includes(page) ? { allowed: true } : { allowed: false, reason: "role" };
}

const RANK: Record<Role, number> = { viewer: 0, analyst: 1, owner: 2 };
/** True when the role is at least `level`. Local mode (no role) may do everything, as today. */
export function roleAtLeast(role: Role | null, level: Role): boolean {
  return role === null || RANK[role] >= RANK[level];
}
