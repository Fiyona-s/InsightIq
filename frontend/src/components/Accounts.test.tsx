import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthGate, installFetchGuard, useAuth } from "../lib/auth";
import { pageAccess, roleAtLeast } from "../lib/access";
import SignInPage, { PasswordChangePage, SIGN_IN_ERROR } from "./SignIn";
import ViewerHome from "./ViewerHome";
import TopMenu from "./TopMenu";
import { AdminToolsProvider, useAdminNotice, useAdminTools } from "../lib/adminTools";
import { ToastProvider } from "./ui/toast";

/** Accounts A3 (frontend). Login off must behave as before; login on shows what each role may see. Plain copy, no claims. */
const ME = { email: "a@example.com", display_name: "A", role: "analyst", company: "Acme", must_change_password: false };
let routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
beforeEach(() => {
  localStorage.clear();
  routes = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString(), "http://localhost").pathname;
    const handler = routes[`${(init?.method || "GET").toUpperCase()} ${path}`];
    return handler ? handler(init) : reply(404, { detail: "no route" });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1]?.method || "GET").toUpperCase()} ${new URL(String(c[0]), "http://localhost").pathname}`);

function Probe() { const a = useAuth(); return <p>{a.hosted ? `hosted:${a.role}` : "local"}</p>; }

it("pageAccess: login off allows every page; login on lists exactly what each role may open", () => {
  for (const page of ["AI Analyst", "Run analytics", "Evaluation center", "Projects"]) expect(pageAccess(page, null)).toEqual({ allowed: true });
  expect(["Overview", "Dashboards"].every((p) => pageAccess(p, "viewer").allowed)).toBe(true);
  for (const page of ["AI Analyst", "Data workspace", "AutoML Studio", "Knowledge base", "Settings", "Projects", "Run analytics", "Backup info"])
    expect(pageAccess(page, "viewer")).toEqual({ allowed: false, reason: "role" });
  for (const page of ["AI Analyst", "Data workspace", "AutoML Studio", "Knowledge base", "Dashboards", "Projects"]) expect(pageAccess(page, "analyst").allowed).toBe(true);
  for (const page of ["Run analytics", "Execution traces", "Change history", "Backup info"]) {
    expect(pageAccess(page, "analyst")).toEqual({ allowed: false, reason: "role" });
    expect(pageAccess(page, "owner").allowed).toBe(true);
  }
  for (const role of ["viewer", "analyst", "owner"] as const) expect(pageAccess("Evaluation center", role)).toEqual({ allowed: false, reason: "hosted" });
  expect(roleAtLeast(null, "owner") && roleAtLeast("owner", "analyst") && roleAtLeast("analyst", "analyst") && !roleAtLeast("viewer", "analyst") && !roleAtLeast("analyst", "owner")).toBe(true);
});

it("login off: the app is rendered as before, after one status question, with no sign-in screen", async () => {
  routes["GET /api/auth/status"] = () => reply(200, { mode: "off", login_required: false });
  render(<AuthGate><Probe /></AuthGate>);
  expect(await screen.findByText("local")).toBeVisible();
  expect(calls()).toEqual(["GET /api/auth/status"]);
  expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
});

it("first load with the server unreachable: a plain screen with Retry, never treated as login off; it recovers when the server answers", async () => {
  let up = false;
  routes["GET /api/auth/status"] = () => { if (!up) throw new Error("offline"); return reply(200, { mode: "off", login_required: false }); };
  const user = userEvent.setup();
  render(<AuthGate><Probe /></AuthGate>);
  expect(await screen.findByRole("heading", { name: "Cannot reach the server" })).toBeVisible();
  expect(screen.queryByText("local")).not.toBeInTheDocument();
  up = true;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("local")).toBeVisible();
});

it("login on, no session: only the sign-in screen is shown and nothing but the status question is asked (no failing call)", async () => {
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", login_required: true, user: null });
  render(<AuthGate><Probe /></AuthGate>);
  expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect(screen.queryByText(/hosted|local/)).not.toBeInTheDocument();
  expect(calls()).toEqual(["GET /api/auth/status"]);
});

it("sign-in: an unknown or known email with a wrong password shows the same message; a lock says how long", async () => {
  const user = userEvent.setup();
  let status = 401;
  routes["POST /api/auth/login"] = () => reply(status, { detail: "x" }, status === 429 ? { "Retry-After": "90" } : {});
  render(<SignInPage onSignedIn={vi.fn()} />);
  const messages: string[] = [];
  for (const email of ["nobody@example.com", "known@example.com"]) {
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), email);
    await user.type(screen.getByLabelText("Password"), "wrong password!!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    messages.push((await screen.findByRole("alert")).textContent || "");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  }
  expect(messages).toEqual([SIGN_IN_ERROR, SIGN_IN_ERROR]);
  status = 429;
  await user.type(screen.getByLabelText("Password"), "whatever it is");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Try again in 2 minutes."));
});

it("sign-in: success reports the person; the form never shows claims about protection", async () => {
  const user = userEvent.setup(), done = vi.fn();
  routes["POST /api/auth/login"] = () => reply(200, ME);
  const { container } = render(<SignInPage onSignedIn={done} />);
  await user.type(screen.getByLabelText("Email"), "a@example.com");
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(ME));
  expect(container.textContent || "").not.toMatch(/secure|private|protected|separate|safe/i);
});

it("an expired session (401 anywhere in the app) opens a sign-in dialog over the app, which stays mounted", async () => {
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: ME });
  routes["GET /api/projects"] = () => reply(401, { detail: "Sign in required." });
  function App() { const a = useAuth(); return <div><p>{a.role}</p><input aria-label="Unsaved note" defaultValue="" /><button onClick={() => void fetch("/api/projects")}>Do something</button></div>; }
  const user = userEvent.setup();
  render(<AuthGate><App /></AuthGate>);
  await user.type(await screen.findByLabelText("Unsaved note"), "typed before the session ended");
  await user.click(screen.getByRole("button", { name: "Do something" }));
  const dialog = await screen.findByRole("dialog", { name: "Sign in again" });
  expect(within(dialog).getByLabelText("Email")).toHaveValue("a@example.com");
  expect(within(dialog).getByText(/Your last action may not have been saved/)).toBeVisible();
  expect(screen.getByLabelText("Unsaved note")).toHaveValue("typed before the session ended");     // the app is still there, nothing lost
  routes["POST /api/auth/login"] = () => reply(200, ME);
  await user.type(within(dialog).getByLabelText("Password"), "correct horse battery");
  await user.click(within(dialog).getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByLabelText("Unsaved note")).toHaveValue("typed before the session ended");
});

it("with no session the sign-in screen is shown and never the session dialog", async () => {
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: null });
  render(<AuthGate><Probe /></AuthGate>);
  await screen.findByRole("heading", { name: "Sign in" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("the fetch guard notices a required password change (403 with its code) and restores fetch when removed", async () => {
  const handlers = { onUnauthorized: vi.fn(), onPasswordChange: vi.fn() };
  routes["GET /api/datasets"] = () => reply(403, { detail: "Change your password before continuing.", code: "password_change_required" });
  routes["GET /api/other"] = () => reply(403, { detail: "Your role does not allow this." });
  const before = window.fetch, remove = installFetchGuard(handlers);
  await fetch("/api/datasets");
  await fetch("/api/other");
  expect(handlers.onPasswordChange).toHaveBeenCalledTimes(1);
  expect(handlers.onUnauthorized).not.toHaveBeenCalled();
  remove();
  expect(window.fetch).toBe(before);
});

it("first-login password change: the two passwords must match, the server's message is shown, and success reports the person", async () => {
  const user = userEvent.setup(), done = vi.fn();
  let reply1 = reply(400, { detail: "Use at least 12 characters." });
  routes["POST /api/auth/change-password"] = () => reply1;
  render(<PasswordChangePage user={{ ...ME, must_change_password: true } as never} onChanged={done} onSignOut={vi.fn()} />);
  expect(screen.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
  await user.type(screen.getByLabelText("Current password"), "first password given");
  await user.type(screen.getByLabelText("New password", { exact: true }), "short");
  await user.type(screen.getByLabelText("Repeat the new password"), "different");
  expect(screen.getByText("The two passwords differ.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Repeat the new password"));
  await user.type(screen.getByLabelText("Repeat the new password"), "short");
  await user.click(screen.getByRole("button", { name: "Change password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 12 characters.");
  reply1 = reply(200, ME);
  await user.clear(screen.getByLabelText("New password", { exact: true })); await user.type(screen.getByLabelText("New password", { exact: true }), "a long enough passphrase");
  await user.clear(screen.getByLabelText("Repeat the new password")); await user.type(screen.getByLabelText("Repeat the new password"), "a long enough passphrase");
  await user.click(screen.getByRole("button", { name: "Change password" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(ME));
});

it("a viewer's Home makes exactly one request, the dashboard list, and never an analyst route", async () => {
  routes["GET /api/dashboards"] = () => reply(200, [{ id: "d1", title: "Weekly numbers", description: "", updated_at: "2026-11-22T10:00:00+00:00", widget_count: 2, revision: "r" }]);
  const open = vi.fn();
  render(<ViewerHome onOpenDashboard={open} />);
  expect(await screen.findByText("Weekly numbers")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Open dashboard Weekly numbers" }));
  expect(open).toHaveBeenCalledWith("d1");
  expect(calls()).toEqual(["GET /api/dashboards"]);
});

it("a viewer's Home with no dashboards says so plainly", async () => {
  routes["GET /api/dashboards"] = () => reply(200, []);
  render(<ViewerHome onOpenDashboard={vi.fn()} />);
  expect(await screen.findByText(/There are no dashboards yet/)).toBeVisible();
});

async function hostedMenu(role: string) {
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: { ...ME, role } });
  routes["POST /api/auth/logout"] = () => reply(200, { signed_out: true });
  const onSignOut = vi.fn();
  function Show() { const admin = useAdminTools(); const notice = useAdminNotice(); return <p data-testid="admin">{`${admin.enabled}|${notice}`}</p>; }
  render(<AuthGate><AdminToolsProvider><ToastProvider><Show /><TopMenu onNavigate={vi.fn()} onSignOut={onSignOut} /></ToastProvider></AdminToolsProvider></AuthGate>);
  await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
  return onSignOut;
}

it("hosted menu: the person and role are shown, there is no Admin switch, and Sign out is offered", async () => {
  const onSignOut = await hostedMenu("viewer");
  expect(screen.getByText("Signed in as a@example.com (Viewer)")).toBeVisible();
  expect(screen.getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Change password", "Sign out"]);          // a viewer has no Settings or Projects
  expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalled();
});

it("hosted: Admin pages follow the owner role (the browser switch is not used) and the notice is a plain role statement", async () => {
  localStorage.setItem("insightiq-admin-tools-v1", "true");               // a leftover local switch must not grant anything
  await hostedMenu("analyst");
  expect(screen.getByTestId("admin")).toHaveTextContent("false|Admin tools: shown to owners.");
  cleanup();
  await hostedMenu("owner");
  expect(screen.getByTestId("admin")).toHaveTextContent("true|Admin tools: shown to owners.");
  expect(screen.getByTestId("admin").textContent).not.toMatch(/not protected/i);
});

it("local mode keeps the Admin switch and its honest warning exactly as before", async () => {
  routes["GET /api/auth/status"] = () => reply(200, { mode: "off" });
  function Show() { const notice = useAdminNotice(); const admin = useAdminTools(); return <p data-testid="admin">{`${admin.enabled}|${notice}`}</p>; }
  render(<AuthGate><AdminToolsProvider><ToastProvider><Show /><TopMenu onNavigate={vi.fn()} /></ToastProvider></AdminToolsProvider></AuthGate>);
  expect(await screen.findByTestId("admin")).toHaveTextContent("false|Admin tools: not protected by a login. Anyone using this computer can open them.");
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  expect(screen.getByRole("menuitemcheckbox", { name: /Show admin tools/ })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeVisible();
});
