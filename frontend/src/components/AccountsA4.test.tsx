import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthGate } from "../lib/auth";
import SignInPage from "./SignIn";
import PeoplePage from "./PeoplePage";
import SecurityLogPage from "./SecurityLogPage";
import ChangePasswordPage from "./ChangePasswordPage";
import { ToastProvider } from "./ui/toast";
import { pageAccess } from "../lib/access";

/** Accounts A4 (frontend): people, one-time links, two-step sign-in and the security log. Plain copy, no protection claims. */
const OWNER = { email: "boss@example.com", display_name: "Boss", role: "owner", company: "Acme", must_change_password: false };
let routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString(), "http://localhost").pathname;
    const handler = routes[`${(init?.method || "GET").toUpperCase()} ${path}`];
    return handler ? handler(init) : reply(404, { detail: "no route" });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

const person = (over: Record<string, unknown> = {}) => ({ id: "u1", email: "pat@example.com", display_name: "Pat", role: "analyst", active: true, status: "Active", last_sign_in: null, locked_seconds: 0, two_step: null, ...over });

it("sign-in asks for a code when the server says so, and sends it with the same email and password", async () => {
  const user = userEvent.setup(), done = vi.fn(), bodies: unknown[] = [];
  routes["POST /api/auth/login"] = (init) => { const b = JSON.parse(String(init?.body)); bodies.push(b); return b.code ? reply(200, OWNER) : reply(200, { two_step_required: true }); };
  render(<SignInPage onSignedIn={done} />);
  await user.type(screen.getByLabelText("Email"), "boss@example.com");
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await user.type(await screen.findByLabelText(/Code from your authenticator app/), "123456");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(OWNER));
  expect(bodies).toEqual([{ email: "boss@example.com", password: "correct horse battery" }, { email: "boss@example.com", password: "correct horse battery", code: "123456" }]);
});

it("a one-time link: the token is read from the fragment, removed from the address, sent once, and a bad link gets one generic answer", async () => {
  const user = userEvent.setup(), bodies: unknown[] = [];
  window.history.replaceState(null, "", "/#accept=abc_DEF-123");
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: null });
  routes["POST /api/auth/redeem"] = (init) => { bodies.push(JSON.parse(String(init?.body))); return reply(400, { detail: "This link cannot be used. Ask the owner for a new one." }); };
  render(<AuthGate><p>app</p></AuthGate>);
  expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeVisible();
  expect(window.location.hash).toBe("");
  await user.type(screen.getByLabelText("New password"), "a long enough password");
  await user.type(screen.getByLabelText("Repeat the new password"), "a long enough password");
  await user.click(screen.getByRole("button", { name: "Save password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This link cannot be used. Ask the owner for a new one.");
  expect(bodies).toEqual([{ token: "abc_DEF-123", new_password: "a long enough password" }]);
  routes["POST /api/auth/redeem"] = () => reply(200, { ok: true });
  await user.click(screen.getByRole("button", { name: "Save password" }));
  expect(await screen.findByRole("heading", { name: "Password saved" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Go to sign in" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

it("an owner who must set up two-step sign-in sees the setup first, confirms a code, and sees recovery codes once", async () => {
  const user = userEvent.setup();
  let starts = 0;
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: { ...OWNER, must_enrol_two_step: true } });
  routes["POST /api/auth/two-step/start"] = () => { starts += 1; return reply(200, { secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" }); };
  routes["POST /api/auth/two-step/confirm"] = () => reply(200, { recovery_codes: ["aaaa-1111", "bbbb-2222", "cccc-3333", "dddd-4444", "eeee-5555", "ffff-6666", "gggg-7777", "hhhh-8888"] });
  render(<AuthGate><p>the app</p></AuthGate>);
  expect(await screen.findByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
  expect(screen.queryByText("the app")).not.toBeInTheDocument();
  expect(await screen.findByLabelText("Setup key")).toHaveTextContent("JBSWY3DPEHPK3PXP");
  await user.type(screen.getByLabelText(/Enter the 6-digit code/), "123456");
  await user.click(screen.getByRole("button", { name: "Turn on" }));
  const list = await screen.findByRole("list", { name: "Recovery codes" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  await user.click(screen.getByRole("button", { name: "I have saved these codes" }));
  expect(await screen.findByText("the app")).toBeVisible();
  expect(starts).toBe(1);
});

it("People: lists everyone without any password field, invites with a one-time link shown once, and changes a role", async () => {
  const user = userEvent.setup();
  let people = [person(), person({ id: "u0", email: "boss@example.com", display_name: "Boss", role: "owner", two_step: "Set up" })];
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: OWNER });
  routes["GET /api/users"] = () => reply(200, people);
  routes["POST /api/users"] = () => { people = [...people, person({ id: "u2", email: "new@example.com", display_name: "New", status: "Invited" })]; return reply(200, { user: people[2], token: "tok123", expires_hours: 24 }); };
  routes["PATCH /api/users/u1"] = () => { people = [{ ...people[0], role: "viewer" }, people[1]]; return reply(200, people[0]); };
  render(<AuthGate><ToastProvider><PeoplePage /></ToastProvider></AuthGate>);
  expect(await screen.findByText("pat@example.com")).toBeVisible();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await user.click(screen.getByRole("button", { name: "Invite a person" }));
  const invite = await screen.findByRole("dialog", { name: "Invite a person" });
  await user.type(within(invite).getByLabelText("Email"), "new@example.com");
  await user.type(within(invite).getByLabelText("Name"), "New");
  await user.click(within(invite).getByRole("button", { name: "Create invitation" }));
  const link = await screen.findByRole("dialog", { name: "Link for new@example.com" });
  expect(within(link).getByLabelText("One-time link")).toHaveValue(`${window.location.origin}/#accept=tok123`);
  expect(within(link).getByText(/shown only once/)).toBeVisible();
  await user.click(within(link).getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Actions for pat@example.com" }));
  await user.click(await screen.findByRole("menuitem", { name: "Change role" }));
  const roleDialog = await screen.findByRole("dialog", { name: "Change role for pat@example.com" });
  await user.selectOptions(within(roleDialog).getByLabelText("Role"), "viewer");
  await user.click(within(roleDialog).getByRole("button", { name: "Save role" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findAllByText("Viewer")).not.toHaveLength(0);
});

it("People: an owner is not offered Deactivate on their own row, and a server refusal is shown in plain words", async () => {
  const user = userEvent.setup();
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: OWNER });
  routes["GET /api/users"] = () => reply(200, [person({ id: "u0", email: "boss@example.com", display_name: "Boss", role: "owner" }), person({ role: "owner", id: "u3", email: "co@example.com" })]);
  routes["PATCH /api/users/u3"] = () => reply(400, { detail: "Your workspace needs at least one active owner." });
  render(<AuthGate><ToastProvider><PeoplePage /></ToastProvider></AuthGate>);
  await screen.findByText("co@example.com");
  await user.click(screen.getByRole("button", { name: "Actions for boss@example.com" }));
  expect(screen.queryByRole("menuitem", { name: "Deactivate" })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Actions for co@example.com" }));
  await user.click(await screen.findByRole("menuitem", { name: "Deactivate" }));
  await user.click(await screen.findByRole("button", { name: "Deactivate" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your workspace needs at least one active owner.");
});

it("Security log: newest first with plain labels, a failed-only filter, and no claim that it cannot be changed", async () => {
  const user = userEvent.setup(), urls: string[] = [];
  routes["GET /api/auth/status"] = () => reply(200, { mode: "on", user: OWNER });
  routes["GET /api/audit-events"] = () => { urls.push("x"); return reply(200, { events: [{ id: 2, at: "2026-11-22T10:00:00Z", event: "sign_in_failed", actor: "pat@example.com", target: null, detail: null, client: "10.0.0.2" }, { id: 1, at: "2026-11-22T09:00:00Z", event: "sign_in_ok", actor: "boss@example.com", target: null, detail: null, client: null }], next_before: null }); };
  const { container } = render(<AuthGate><SecurityLogPage /></AuthGate>);
  expect(await screen.findByText("Failed sign-in")).toBeVisible();
  expect(screen.getByText("Signed in")).toBeVisible();
  await user.click(screen.getByLabelText(/Show only failed sign-ins/));
  await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("failed_only=true"))).toBe(true));
  expect(container.textContent || "").not.toMatch(/tamper|secure|private|protected|separate/i);
});

it("Change password: sends the current and new password to the existing route and clears the fields", async () => {
  const user = userEvent.setup(); let sent: unknown = null;
  routes["POST /api/auth/change-password"] = (init) => { sent = JSON.parse(String(init?.body)); return reply(200, OWNER); };
  render(<ToastProvider><ChangePasswordPage /></ToastProvider>);
  await user.type(screen.getByLabelText("Current password"), "old password here");
  await user.type(screen.getByLabelText("New password"), "a brand new password");
  await user.type(screen.getByLabelText("Repeat the new password"), "a brand new password");
  await user.click(screen.getByRole("button", { name: "Change password" }));
  await waitFor(() => expect(sent).toEqual({ current_password: "old password here", new_password: "a brand new password" }));
  await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveValue(""));
});

it("page access: People and Security log are owner only; Change password is for every signed-in role and absent locally", () => {
  for (const page of ["People", "Security log"]) {
    expect(pageAccess(page, "owner")).toEqual({ allowed: true });
    expect(pageAccess(page, "analyst")).toEqual({ allowed: false, reason: "role" });
    expect(pageAccess(page, "viewer")).toEqual({ allowed: false, reason: "role" });
    expect(pageAccess(page, null)).toEqual({ allowed: false, reason: "signin" });
  }
  for (const role of ["viewer", "analyst", "owner"] as const) expect(pageAccess("Change password", role)).toEqual({ allowed: true });
  expect(pageAccess("Change password", null)).toEqual({ allowed: false, reason: "signin" });
});
