import { request } from "../api";

/** Accounts A4: people and the security log (owner only on the server). Nothing here ever carries a password or a hash. */
export type Person = {
  id: string; email: string; display_name: string; role: "viewer" | "analyst" | "owner"; active: boolean;
  status: "Active" | "Invited" | "Locked" | "Deactivated"; last_sign_in: string | null; locked_seconds: number; two_step: "Set up" | "Not set up" | null;
};
export type LinkResult = { user: Person; token: string; expires_hours: number };
export type AuditEvent = { id: number; at: string; event: string; actor: string; target: string | null; detail: string | null; client: string | null };
const body = (value: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

export const peopleApi = {
  list: () => request<Person[]>("/users"),
  invite: (email: string, display_name: string, role: string) => request<LinkResult>("/users", body({ email, display_name, role })),
  change: (id: string, patch: { role?: string; active?: boolean }) => request<Person>(`/users/${id}`, body(patch, "PATCH")),
  unlock: (id: string) => request<Person>(`/users/${id}/unlock`, body({})),
  resetLink: (id: string) => request<LinkResult>(`/users/${id}/reset-link`, body({})),
};
export const auditApi = {
  list: (failedOnly: boolean, before?: number) =>
    request<{ events: AuditEvent[]; next_before: number | null }>(`/audit-events?limit=50${failedOnly ? "&failed_only=true" : ""}${before ? `&before=${before}` : ""}`),
};
/** The address a person opens. The token sits after the # so a browser never sends it to a server. */
export const linkUrl = (token: string) => `${window.location.origin}/#accept=${token}`;
