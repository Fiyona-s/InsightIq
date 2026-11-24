import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, PageHeader } from "./ui/layout";
import Logo from "./Logo";
import { Button } from "./ui/button";
import { Modal } from "./ui/overlay";
import { ErrorState } from "./WorkspaceStates";
import type { Me } from "../lib/auth";

/** Plain sign-in copy (Accounts A3). No claims about protection: the claim ladder in docs/ACCOUNTS_PLAN.md governs wording. */
async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T | null; retryAfter: number }> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json().catch(() => null)) as T | null, retryAfter: Number(response.headers.get("Retry-After") || 0) };
}

export const SIGN_IN_ERROR = "Email or password incorrect.";
export const CODE_ERROR = "That code did not work. Try the next code, or use a recovery code.";
function lockedMessage(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

function SignInForm({ onSignedIn, initialEmail = "", idPrefix }: { onSignedIn: (me: Me) => void; initialEmail?: string; idPrefix: string }) {
  const [email, setEmail] = useState(initialEmail), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false), [code, setCode] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await post<Me & { two_step_required?: boolean; detail?: string }>("/api/auth/login", needCode ? { email, password, code } : { email, password });
      if (result.status === 200 && result.body && result.body.two_step_required) { setNeedCode(true); return; }
      if (result.status === 200 && result.body) { onSignedIn(result.body); return; }
      if (result.status === 503 && result.body?.detail) { setError(result.body.detail); return; }
      setError(result.status === 429 ? lockedMessage(result.retryAfter) : result.status === 401 ? (needCode ? CODE_ERROR : SIGN_IN_ERROR) : "Could not sign in. Try again.");
      if (needCode) setCode(""); else setPassword("");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label htmlFor={`${idPrefix}-email`}>Email</label>
      <input id={`${idPrefix}-email`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!initialEmail} autoFocus={!initialEmail} required />
      <label htmlFor={`${idPrefix}-password`}>Password</label>
      <input id={`${idPrefix}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!initialEmail} required />
      {needCode && (
        <>
          <label htmlFor={`${idPrefix}-code`}>Code from your authenticator app</label>
          <input id={`${idPrefix}-code`} inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={`${idPrefix}-code-hint`} autoFocus required />
          <p id={`${idPrefix}-code-hint`} className="insight-note">Enter the 6-digit code, or one of your recovery codes if you cannot use the app.</p>
        </>
      )}
      {error && <ErrorState as="p" role="alert" className="auth-error">{error}</ErrorState>}
      <Button type="submit" disabled={busy || !email.trim() || !password || (needCode && !code.trim())}>{busy ? "Signing in…" : needCode ? "Continue" : "Sign in"}</Button>
    </form>
  );
}

export default function SignInPage({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  return (
    <main className="auth-page" id="main-content">
      <Card className="auth-card">
        <p className="auth-brand"><Logo size={24} /> InsightIQ</p>
        <PageHeader title="Sign in" description="Use the email and password for your InsightIQ account." />
        <SignInForm onSignedIn={onSignedIn} idPrefix="signin" />
      </Card>
    </main>
  );
}

/** Shown when the session ended while the app was open. The app stays behind it, so nothing typed is lost. */
export function SessionExpiredDialog({ email, onSignedIn, onSignOut }: { email: string; onSignedIn: (me: Me) => void; onSignOut: () => void }) {
  return (
    <Modal open title="Sign in again" busy onClose={() => undefined} label="Sign in again" className="auth-expired"
      footer={<Button variant="ghost" onClick={onSignOut}>Sign out</Button>}>
      <p>Your session ended. Sign in to continue where you were. Your last action may not have been saved, so check it and try it again.</p>
      <SignInForm onSignedIn={onSignedIn} initialEmail={email} idPrefix="expired" />
    </Modal>
  );
}

export function PasswordChangePage({ user, onChanged, onSignOut }: { user: Me; onChanged: (me: Me) => void; onSignOut: () => void }) {
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && next !== again;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || mismatch) return;
    setBusy(true); setError("");
    try {
      const result = await post<Me & { detail?: string }>("/api/auth/change-password", { current_password: current, new_password: next });
      if (result.status === 200 && result.body) { onChanged(result.body); return; }
      setError(result.status === 429 ? lockedMessage(result.retryAfter) : (result.body && typeof result.body.detail === "string" && result.body.detail) || "Could not change the password. Try again.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page" id="main-content">
      <Card className="auth-card">
        <p className="auth-brand"><Logo size={24} /> InsightIQ</p>
        <PageHeader title="Choose a new password" description={`Signed in as ${user.email}. Your first password was set by someone else. Choose your own to continue.`} />
        <form className="auth-form" onSubmit={submit} noValidate>
          <label htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }} autoFocus required />
          <label htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} aria-describedby="pw-hint" required />
          <p id="pw-hint" className="insight-note">Use at least 12 characters. A short sentence works well.</p>
          <label htmlFor="pw-again">Repeat the new password</label>
          <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(""); }} aria-invalid={mismatch} required />
          {mismatch && <p role="alert" className="auth-error">The two passwords differ.</p>}
          {error && <ErrorState as="p" role="alert" className="auth-error">{error}</ErrorState>}
          <div className="auth-actions">
            <Button type="submit" disabled={busy || !current || !next || mismatch || !again}>{busy ? "Saving…" : "Change password"}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onSignOut}>Sign out</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

/** The page a person lands on from a one-time link. The token came in the address fragment and is already removed from the address bar. */
export function AcceptLinkPage({ token, onDone }: { token: string; onDone: () => void }) {
  const [next, setNext] = useState(""), [again, setAgain] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const mismatch = again.length > 0 && next !== again;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || mismatch) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ detail?: string }>("/api/auth/redeem", { token, new_password: next });
      if (result.status === 200) { setDone(true); return; }
      setError(result.status === 429 ? lockedMessage(result.retryAfter) : (result.body && typeof result.body.detail === "string" && result.body.detail) || "This link did not work. Ask for a new one.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page" id="main-content">
      <Card className="auth-card">
        <p className="auth-brand"><Logo size={24} /> InsightIQ</p>
        {done ? (
          <>
            <PageHeader title="Password saved" description="You can now sign in with your new password." />
            <Button onClick={onDone}>Go to sign in</Button>
          </>
        ) : (
          <>
            <PageHeader title="Choose your password" description="Choose a password for your InsightIQ account. Only you will know it." />
            <form className="auth-form" onSubmit={submit} noValidate>
              <label htmlFor="accept-new">New password</label>
              <input id="accept-new" type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} aria-describedby="accept-hint" autoFocus required />
              <p id="accept-hint" className="insight-note">Use at least 12 characters. A short sentence works well.</p>
              <label htmlFor="accept-again">Repeat the new password</label>
              <input id="accept-again" type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(""); }} aria-invalid={mismatch} required />
              {mismatch && <p role="alert" className="auth-error">The two passwords differ.</p>}
              {error && <ErrorState as="p" role="alert" className="auth-error">{error}</ErrorState>}
              <Button type="submit" disabled={busy || !next || !again || mismatch}>{busy ? "Saving…" : "Save password"}</Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}

/** Owners must set up two-step sign-in before anything else (hosted mode). Recovery codes are shown once. */
export function TwoStepEnrolPage({ user, onDone, onSignOut }: { user: Me; onDone: () => void; onSignOut: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null), [error, setError] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null), [copied, setCopied] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const result = await post<{ secret: string; uri: string; detail?: string }>("/api/auth/two-step/start", {});
        if (result.status === 200 && result.body) setSetup(result.body);
        else setError((result.body && result.body.detail) || "Could not start the setup. Try again.");
      } catch { setError("Could not reach the server. Try again."); }
    })();
  }, []);
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ recovery_codes?: string[]; detail?: string }>("/api/auth/two-step/confirm", { code });
      if (result.status === 200 && result.body?.recovery_codes) setCodes(result.body.recovery_codes);
      else setError(result.status === 429 ? lockedMessage(result.retryAfter) : (result.body && result.body.detail) || "That code is not right. Try the next code.");
    } catch { setError("Could not reach the server. Try again."); } finally { setBusy(false); }
  }
  return (
    <main className="auth-page" id="main-content">
      <Card className="auth-card">
        <p className="auth-brand"><Logo size={24} /> InsightIQ</p>
        {codes ? (
          <>
            <PageHeader title="Save your recovery codes" description="Each code works once if you lose your authenticator app. They are shown only now." />
            <ul className="auth-codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="auth-actions">
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy codes"}</Button>
              <Button onClick={onDone}>I have saved these codes</Button>
            </div>
          </>
        ) : (
          <>
            <PageHeader title="Set up two-step sign-in" description={`Signed in as ${user.email}. Owners need a code from an authenticator app each time they sign in.`} />
            {setup && (
              <form className="auth-form" onSubmit={confirm} noValidate>
                <p>1. In your authenticator app, add an account using this key:</p>
                <code className="auth-secret" aria-label="Setup key">{setup.secret}</code>
                <label htmlFor="enrol-code">2. Enter the 6-digit code the app shows</label>
                <input id="enrol-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => { setCode(e.target.value); setError(""); }} autoFocus required />
                {error && <ErrorState as="p" role="alert" className="auth-error">{error}</ErrorState>}
                <div className="auth-actions">
                  <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Turn on"}</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={onSignOut}>Sign out</Button>
                </div>
              </form>
            )}
            {!setup && error && (
              <>
                <ErrorState as="p" role="alert" className="auth-error">{error}</ErrorState>
                <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
              </>
            )}
          </>
        )}
      </Card>
    </main>
  );
}

/** First load with the server unreachable: say so plainly, retry quietly, and offer a button. */
export function UnreachablePage({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <main className="auth-page" id="main-content">
      <Card className="auth-card">
        <p className="auth-brand"><Logo size={24} /> InsightIQ</p>
        <PageHeader title="Cannot reach the server" description="The app could not connect. Check that the server is running and your connection works. This page keeps trying." />
        <Button onClick={onRetry} disabled={retrying}>{retrying ? "Trying…" : "Retry"}</Button>
      </Card>
    </main>
  );
}
