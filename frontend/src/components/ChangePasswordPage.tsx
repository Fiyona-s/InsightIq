import { useState, type FormEvent } from "react";
import { Card, PageHeader } from "./ui/layout";
import { Button } from "./ui/button";
import { ErrorState } from "./WorkspaceStates";
import { useToast } from "./ui/toast";

/** Voluntary password change for every role (Accounts A4), using the same route as the first-sign-in screen. */
export default function ChangePasswordPage() {
  const toast = useToast();
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && next !== again;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || mismatch) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: current, new_password: next }) });
      const body = await response.json().catch(() => null);
      if (response.ok) { setCurrent(""); setNext(""); setAgain(""); toast("Password changed. Your other sessions were ended."); }
      else setError(response.status === 429 ? "Too many attempts. Try again later." : (body && typeof body.detail === "string" && body.detail) || "Could not change the password. Try again.");
    } catch { setError("Could not reach the server. Try again."); } finally { setBusy(false); }
  }
  return (
    <div className="change-password-page">
      <PageHeader title="Change password" description="Choose a new password for your own account." />
      <Card className="auth-card-inline">
        <form className="auth-form" onSubmit={submit} noValidate>
          <label htmlFor="cp-current">Current password</label>
          <input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }} required />
          <label htmlFor="cp-new">New password</label>
          <input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} aria-describedby="cp-hint" required />
          <p id="cp-hint" className="insight-note">Use at least 12 characters. A short sentence works well. Your other sessions will be signed out.</p>
          <label htmlFor="cp-again">Repeat the new password</label>
          <input id="cp-again" type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(""); }} aria-invalid={mismatch} required />
          {mismatch && <p role="alert" className="auth-error">The two passwords differ.</p>}
          {error && <ErrorState as="p" role="alert" className="auth-error">{error}</ErrorState>}
          <div className="auth-actions"><Button type="submit" disabled={busy || !current || !next || !again || mismatch}>{busy ? "Saving…" : "Change password"}</Button></div>
        </form>
      </Card>
    </div>
  );
}
