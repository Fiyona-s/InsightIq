import type { Page } from "@playwright/test";
import { expect, test } from "./hosted-helpers";
import { PASSWORD, capture, expectClean, goAdmin, nextCode, refusals, signIn, signInOwner, trackApi, writeReport } from "./hosted-helpers";

/**
 * Accounts A4, hosted mode: people, one-time links, voluntary password change, owner two-step sign-in and the security log.
 * Each test uses its own accounts. Controlled provider only. Nothing here claims protection: it checks behaviour.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);
test.afterAll(() => { writeReport(); });

const NEW_PASSWORD = "an invited persons own passphrase";
async function openPage(page: Page, button: string, heading: string) {
  await goAdmin(page, button);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}
async function actions(page: Page, email: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${email}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("an owner invites a person with a one-time link, who sets a password; the link works once; role change and deactivate take effect at once", async ({ page, browser }) => {
  const email = "ivy@example.com";
  await signInOwner(page, "people@example.com");
  const owner = trackApi(page);
  await openPage(page, "People", "People");
  await expect(page.getByRole("cell", { name: "people@example.com", exact: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);                          // nothing on this page can show a password
  await capture(page, "people");
  // invite
  await page.getByRole("button", { name: "Invite a person" }).click();
  const invite = page.getByRole("dialog", { name: "Invite a person" });
  await invite.getByLabel("Email").fill(email);
  await invite.getByLabel("Name").fill("Ivy Invitee");
  await invite.getByLabel("Role").selectOption("viewer");
  await capture(page, "people-invite");
  await invite.getByRole("button", { name: "Create invitation" }).click();
  const linkDialog = page.getByRole("dialog", { name: `Link for ${email}` });
  await expect(linkDialog.getByText(/shown only once/)).toBeVisible();
  const link = await linkDialog.getByLabel("One-time link").inputValue();
  expect(link).toMatch(/\/#accept=[A-Za-z0-9_-]+$/);                                              // the token is in the fragment, never in the query string
  await capture(page, "people-link");
  await linkDialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Invited");
  // the person opens the link in their own browser, chooses a password, and the link is used up
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const invitee = await other.newPage();
  const seen: string[] = [];
  invitee.on("request", (r) => seen.push(r.url()));
  await invitee.goto(link);
  await expect(invitee.getByRole("heading", { level: 1, name: "Choose your password" })).toBeVisible();
  expect(new URL(invitee.url()).hash).toBe("");                                                  // the token is taken out of the address bar
  expect(seen.some((u) => u.includes("accept=") || u.includes(link.split("#accept=")[1]))).toBe(false);     // and was never sent in any request address
  await capture(invitee, "accept-link");
  await invitee.getByLabel("New password", { exact: true }).fill("short");
  await invitee.getByLabel("Repeat the new password").fill("short");
  await invitee.getByRole("button", { name: "Save password" }).click();
  await expect(invitee.getByRole("alert")).toContainText("at least 12 characters");
  await invitee.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await invitee.getByLabel("Repeat the new password").fill(NEW_PASSWORD);
  await invitee.getByRole("button", { name: "Save password" }).click();
  await expect(invitee.getByRole("heading", { level: 1, name: "Password saved" })).toBeVisible();
  await invitee.getByRole("button", { name: "Go to sign in" }).click();
  await signIn(invitee, email, NEW_PASSWORD);
  await expect(invitee.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();          // a viewer: no two-step asked
  // the same link a second time: the same plain answer as any bad link
  const again = await other.newPage();
  await again.goto(link);
  await again.getByLabel("New password", { exact: true }).fill("another long passphrase");
  await again.getByLabel("Repeat the new password").fill("another long passphrase");
  await again.getByRole("button", { name: "Save password" }).click();
  await expect(again.getByRole("alert")).toHaveText("This link cannot be used. Ask the owner for a new one.");
  await again.close();
  // duplicate email is refused in plain words
  await page.getByRole("button", { name: "Invite a person" }).click();
  const dup = page.getByRole("dialog", { name: "Invite a person" });
  await dup.getByLabel("Email").fill(email);
  await dup.getByRole("button", { name: "Create invitation" }).click();
  await expect(dup.getByRole("alert")).toBeVisible();
  await dup.getByRole("button", { name: "Cancel" }).click();
  // role change, then deactivation ends the person's session at once
  await actions(page, email, "Change role");
  const roleDialog = page.getByRole("dialog", { name: `Change role for ${email}` });
  await roleDialog.getByLabel("Role").selectOption("analyst");
  await roleDialog.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Analyst");
  expect((await invitee.request.get("/api/datasets")).status()).toBe(200);                       // the new role applies on the very next request
  await actions(page, email, "Deactivate");
  await capture(page, "people-deactivate");
  await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Deactivated");
  expect((await invitee.request.get("/api/dashboards")).status()).toBe(401);                     // signed out at once
  await actions(page, email, "Reactivate");
  await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Active");
  // a new link for an existing person; the owner never sees a password
  await actions(page, email, "Create a link to set a password");
  const second = page.getByRole("dialog", { name: `Link for ${email}` });
  await expect(second.getByText(/shown only once/)).toBeVisible();
  await second.getByRole("button", { name: "Done" }).click();
  // the owner cannot deactivate themselves: no such menu item
  await page.getByRole("button", { name: "Actions for people@example.com" }).click();
  await expect(page.getByRole("menuitem", { name: "Deactivate" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(refusals(owner).filter((r) => r.status !== 400 && r.status !== 409)).toEqual([]);
  // the security log shows what happened, in plain words, with no token or password in it
  await openPage(page, "Security log", "Security log");
  const log = page.locator("main");
  for (const word of ["Invited", "Used a link to set a password", "Changed role", "Deactivated", "Reactivated", "Created a link"]) await expect(log).toContainText(word);
  const text = await log.innerText();
  expect(text).not.toContain(link.split("#accept=")[1]);
  expect(text).not.toContain(NEW_PASSWORD);
  expect(text).not.toMatch(/tamper|secure|private|protected|separate/i);
  await capture(page, "security-log");
  await other.close();
  expectClean();
});

test("an owner sets up two-step sign-in in the browser, signs in with a code, and a recovery code works once", async ({ page }) => {
  const email = "enrol@example.com";
  await signIn(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Set up two-step sign-in" })).toBeVisible();
  expect((await page.request.get("/api/datasets")).status()).toBe(403);                          // nothing else works until it is set up
  const secret = (await page.getByLabel("Setup key").innerText()).trim();
  await capture(page, "two-step-setup");
  await page.getByLabel(/Enter the 6-digit code/).fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel(/Enter the 6-digit code/).fill(await nextCode(email, secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(8);
  const codes = await list.getByRole("listitem").allInnerTexts();
  await capture(page, "two-step-recovery");
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expect((await page.request.get("/api/dashboards")).status()).toBe(200);
  // sign out, then the second step is asked
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, email);
  await expect(page.getByLabel(/Code from your authenticator app/)).toBeVisible();
  await capture(page, "two-step-code");
  await page.getByLabel(/Code from your authenticator app/).fill("000000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That code did not work");
  await page.getByLabel(/Code from your authenticator app/).fill(codes[0].trim());
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  // the same recovery code is refused the second time
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, email);
  await page.getByLabel(/Code from your authenticator app/).fill(codes[0].trim());
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That code did not work");
  expectClean();
});

for (const [email, label] of [["viewer2@example.com", "viewer"], ["analyst2@example.com", "analyst"]] as const) {
  test(`a${label === "analyst" ? "n" : ""} ${label} cannot reach People or the Security log, and the server refuses both`, async ({ page }) => {
    await signIn(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    const api = trackApi(page);
    for (const hash of ["people", "security-log"]) {
      await page.goto(`/#${hash}`);
      await expect(page.getByRole("heading", { level: 1, name: "Not available" })).toBeVisible();
    }
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "People", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Security log", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(api.calls.filter((c) => c.path.startsWith("/api/users") || c.path.startsWith("/api/audit-events"))).toEqual([]);
    for (const path of ["/api/users", "/api/audit-events"]) expect((await page.request.get(path)).status()).toBe(403);
    expect((await page.request.post("/api/users", { data: { email: "x@example.com", display_name: "X", role: "viewer" } })).status()).toBe(403);
    if (label === "viewer") {
      expect((await page.request.get("/api/saved-charts")).status()).toBe(403);                    // saved charts are analyst level
      const board = trackApi(page);
      await page.goto("/#dashboards");
      await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
      await expect(page.locator(".dashboard-card, .dashboard-widget").first()).toBeVisible();
      expect(board.calls.filter((c) => c.path.startsWith("/api/saved-charts"))).toEqual([]);     // the viewer's Dashboards page makes no saved-chart call
    }
    await page.goto("/#people");
    await capture(page, `${label}-not-available`);
    expectClean();
  });
}

test("any signed-in person can change their own password; other sessions end and the old password stops working", async ({ page, browser }) => {
  const email = "pwchange@example.com", next = "my own new long passphrase";
  await signIn(page, email);
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const second = await other.newPage();
  await signIn(second, email);
  await expect(second.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();
  await capture(page, "change-password");
  await page.getByLabel("Current password").fill("not the current one!!");
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Repeat the new password").fill(next);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed")).toBeVisible();
  expect((await page.request.get("/api/dashboards")).status()).toBe(200);                          // this session continues
  expect((await second.request.get("/api/dashboards")).status()).toBe(401);                        // the other one ended
  await other.close();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(page, email);
  await expect(page.getByRole("alert")).toHaveText("Email or password incorrect.");
  await page.getByLabel("Password").fill(next);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expectClean();
});

test("with the server unreachable at first load the page says so, retries quietly, and has a Retry button", async ({ page }) => {
  await page.route("**/api/auth/status", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Cannot reach the server" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);                    // never treated as "login off"
  await capture(page, "server-unreachable");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cannot reach the server" })).toBeVisible();
  await page.unroute("**/api/auth/status");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible({ timeout: 15000 });   // the quiet automatic retry found it
  expectClean();
});
