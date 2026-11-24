import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { roleAtLeast, type Role } from "./access";
import SignInPage, { AcceptLinkPage, PasswordChangePage, SessionExpiredDialog, TwoStepEnrolPage, UnreachablePage } from "../components/SignIn";

/**
 * Accounts A3. With login off (AUTH_MODE=off) this renders the app exactly as before. With login on it shows the sign-in
 * screen until there is a session, asks for a new password when the account requires one, and keeps the app mounted
 * (so nothing typed is lost) while an ended session is renewed in a dialog.
 */
export type Me = { email: string; display_name: string; role: Role; company: string; must_change_password: boolean; must_enrol_two_step?: boolean };
type Value = {
  hosted: boolean;
  user: Me | null;
  role: Role | null;
  /** True when the role is at least `level`; always true in local mode. */
  can: (level: Role) => boolean;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Value>({ hosted: false, user: null, role: null, can: () => true, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

type Phase = "loading" | "local" | "unreachable" | "signed-out" | "signed-in";
const QUIET = ["/api/auth/login", "/api/auth/status", "/api/auth/me"];     // their own 401s mean something else

/** Wraps fetch so an ended session (401) or a required password change (403) anywhere in the app is noticed. */
export function installFetchGuard(handlers: { onUnauthorized: () => void; onPasswordChange: () => void; onTwoStep?: () => void }) {
  const original = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, window.location.origin).pathname;
      if (path.startsWith("/api/") && !QUIET.includes(path)) {
        if (response.status === 401) handlers.onUnauthorized();
        else if (response.status === 403) {
          const body = await response.clone().json().catch(() => null);
          if (body && body.code === "password_change_required") handlers.onPasswordChange();
          else if (body && body.code === "two_step_enrolment_required") handlers.onTwoStep?.();
        }
      }
    } catch { /* never let the guard break a request */ }
    return response;
  };
  return () => { window.fetch = original; };
}

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null; headers: Headers }> {
  const response = await fetch(path, init);
  return { status: response.status, body: (await response.json().catch(() => null)) as T | null, headers: response.headers };
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<Me | null>(null);
  const [expired, setExpired] = useState(false);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;
  const remove = useRef<(() => void) | null>(null);

  const [retrying, setRetrying] = useState(false);
  const [acceptToken, setAcceptToken] = useState<string | null>(() => {
    // A one-time link carries its token after the # so it is never sent to a server. Read it once, then take it out of the address bar.
    const match = /^#accept=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
    if (match) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return match ? match[1] : null;
  });
  const current = useRef(true);
  const ask = useCallback(async () => {
    let status: { mode?: string; user?: Me | null } | null = null;
    for (let attempt = 0; attempt < 2 && !status; attempt += 1) {
      try {
        const result = await json<{ mode: string; user: Me | null }>("/api/auth/status");
        if (result.status === 200) status = result.body;
      } catch { /* retry once */ }
    }
    if (!current.current) return;
    if (!status) { setPhase("unreachable"); return; }       // the server could not be asked: say so, never assume login is off
    if (status.mode !== "on") { setPhase("local"); return; }   // login off: the app as before
    remove.current?.();
    remove.current = installFetchGuard({
      onUnauthorized: () => { if (phaseRef.current === "signed-in") setExpired(true); },
      onPasswordChange: () => setUser((u) => (u ? { ...u, must_change_password: true } : u)),
      onTwoStep: () => setUser((u) => (u ? { ...u, must_enrol_two_step: true } : u)),
    });
    // The status answer already says who the request's session belongs to, so the page loads without a failing call.
    if (status.user) { setUser(status.user); setPhase("signed-in"); } else setPhase("signed-out");
  }, []);
  useEffect(() => {
    current.current = true;
    void ask();
    return () => { current.current = false; remove.current?.(); };
  }, [ask]);
  useEffect(() => {
    if (phase !== "unreachable") return;
    const timer = window.setInterval(() => { void ask(); }, 5000);   // quiet automatic retry
    return () => window.clearInterval(timer);
  }, [phase, ask]);
  const retry = useCallback(async () => { setRetrying(true); await ask(); setRetrying(false); }, [ask]);

  const signedIn = useCallback((me: Me) => {
    const sameUser = user !== null && user.email === me.email;
    if (phaseRef.current === "signed-in" && !sameUser) { window.location.reload(); return; }   // another person: start from a clean page, same address
    setUser(me); setExpired(false); setPhase("signed-in");
  }, [user]);
  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null); setExpired(false); setPhase("signed-out");
  }, []);

  const value = useMemo<Value>(() => ({
    hosted: phase === "signed-in", user, role: user?.role ?? null, can: (level) => roleAtLeast(user?.role ?? null, level), signOut,
  }), [phase, user, signOut]);

  if (phase === "loading") return null;
  if (phase === "unreachable") return <UnreachablePage onRetry={() => void retry()} retrying={retrying} />;
  if (acceptToken && phase !== "local") return <AcceptLinkPage token={acceptToken} onDone={() => { setAcceptToken(null); if (phase === "signed-in") void signOut(); }} />;
  if (phase === "local") return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  if (phase === "signed-out") return <SignInPage onSignedIn={signedIn} />;
  if (user && user.must_change_password) return <PasswordChangePage user={user} onChanged={signedIn} onSignOut={signOut} />;
  if (user && user.must_enrol_two_step) return <TwoStepEnrolPage user={user} onDone={() => setUser((u) => (u ? { ...u, must_enrol_two_step: false } : u))} onSignOut={signOut} />;
  return (
    <AuthContext.Provider value={value}>
      {children}
      {expired && user && <SessionExpiredDialog email={user.email} onSignedIn={signedIn} onSignOut={signOut} />}
    </AuthContext.Provider>
  );
}
