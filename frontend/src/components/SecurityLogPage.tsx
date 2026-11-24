import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader } from "./ui/layout";
import { Button } from "./ui/button";
import { TableFrame } from "./ui/data";
import { EmptyState } from "./ui/states";
import { ErrorState, LoadingState } from "./WorkspaceStates";
import { formatDate } from "../lib/formatters";
import { auditApi, type AuditEvent } from "../lib/peopleApi";

export const EVENT_LABELS: Record<string, string> = {
  sign_in_ok: "Signed in", sign_in_failed: "Failed sign-in", account_locked: "Account locked", sign_out: "Signed out", password_changed: "Changed own password",
  reset_link_created: "Created a link", reset_link_used: "Used a link to set a password", user_invited: "Invited", role_changed: "Changed role", user_deactivated: "Deactivated",
  user_reactivated: "Reactivated", user_unlocked: "Unlocked", two_step_enrolled: "Set up two-step sign-in", recovery_code_used: "Used a recovery code",
  two_step_reset: "Two-step sign-in reset", company_created: "Workspace created",
};

/** The owner's Security log (Accounts A4): what the app recorded about sign-ins and people, newest first. */
export default function SecurityLogPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null), [next, setNext] = useState<number | null>(null), [failedOnly, setFailedOnly] = useState(false), [error, setError] = useState("");
  const load = useCallback(async (more?: number) => {
    setError("");
    try {
      const page = await auditApi.list(failedOnly, more);
      setEvents((current) => (more && current ? [...current, ...page.events] : page.events));
      setNext(page.next_before);
    } catch (e) { setError((e as Error).message); }
  }, [failedOnly]);
  useEffect(() => { setEvents(null); void load(); }, [load]);
  return (
    <div className="security-log-page">
      <PageHeader title="Security log" description="A list of sign-ins and changes to people, newest first." />
      <p className="insight-note">This is what the app recorded. It cannot show anything done outside the app.</p>
      <label className="lifecycle-check"><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Show only failed sign-ins and locks</label>
      {error && <ErrorState role="alert">{error} <Button variant="ghost" onClick={() => void load()}>Try again</Button></ErrorState>}
      {!events && !error && <LoadingState>Loading the log…</LoadingState>}
      {events && (
        <Card title="Records" headingLevel={2}>
          {!events.length ? <EmptyState as="p">{failedOnly ? "No failed sign-ins are recorded." : "Nothing is recorded yet."}</EmptyState> : (
            <TableFrame label="Security log">
              <table className="ui-table">
                <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">About</th><th scope="col">Details</th><th scope="col">From</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.at, "datetime")}</td><td>{e.actor}</td><td>{EVENT_LABELS[e.event] || e.event}</td>
                      <td>{e.target || "—"}</td><td>{e.detail || "—"}</td><td>{e.client || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
          {next !== null && <Button variant="outline" onClick={() => void load(next)}>Show older records</Button>}
        </Card>
      )}
    </div>
  );
}
