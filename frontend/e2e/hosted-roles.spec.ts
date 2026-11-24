import { expect, test } from "./hosted-helpers";
import { PASSWORD, capture, expectClean, goAdmin, isAnalystRoute, refusals, signIn, signInOwner, trackApi, writeReport } from "./hosted-helpers";

/**
 * Accounts A3, hosted mode (login on). Each test signs in as its own user so lockouts and password changes cannot affect
 * another test. Controlled provider only; no live AI. Nothing here claims that data is protected: it checks what each role
 * sees and cannot reach, and how the sign-in flows behave.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120000);

const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main navigation" });
const navLabels = async (page: import("@playwright/test").Page) => (await nav(page).getByRole("button").allInnerTexts()).map((t) => t.trim());

test.afterAll(() => { writeReport(); });

/** Column types are remembered per dataset on the server: the first person to ask confirms them, later people are not asked. */
async function typeQuestionAndConfirmTypesIfAsked(page: import("@playwright/test").Page, question: string) {
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill(question);
  const analyze = page.getByRole("button", { name: "Analyze", exact: true }), use = page.getByRole("button", { name: "Use suggested types" });
  await expect.poll(async () => (await analyze.isEnabled()) || (await use.isVisible())).toBe(true);     // wait until the page has decided
  if (!(await analyze.isEnabled())) { await use.click(); await page.locator(".confirm-types input").check(); }
  return box;
}

test("the sign-in page loads without a session, asks for nothing else, and wrong passwords get one message", async ({ page }) => {
  const api = trackApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect([...new Set(api.calls.map((c) => c.path))]).toEqual(["/api/auth/status"]);     // nothing else is requested before sign-in
  expect(await page.getByRole("navigation").count()).toBe(0);                                     // no app behind it
  await capture(page, "sign-in");
  // unknown email and known email with a wrong password: the same message
  const messages: string[] = [];
  for (const email of ["nobody@example.com", "wrongpw@example.com"]) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not the password!!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    messages.push((await alert.innerText()).trim());
    await expect(page.getByLabel("Password")).toHaveValue("");
  }
  expect(messages).toEqual(["Email or password incorrect.", "Email or password incorrect."]);
  await capture(page, "sign-in-error");
  // five failures lock the account; the page says so plainly
  for (let i = 0; i < 4; i += 1) {
    await page.getByLabel("Email").fill("wrongpw@example.com");
    await page.getByLabel("Password").fill("not the password!!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.getByLabel("Email").fill("wrongpw@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/Too many attempts\. Try again in 1 minute\./);
  expectClean();
});

test("a viewer sees Home and Dashboards only, never calls an analyst route, and cannot change anything", async ({ page }) => {
  const api = trackApi(page);
  await signIn(page, "viewer@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expect(await navLabels(page)).toEqual(["Home", "Dashboards"]);
  await expect(page.getByRole("region", { name: "Saved dashboards" })).toContainText("Weekly numbers");
  await capture(page, "viewer-home");
  // the menu: who is signed in and Sign out; no settings, projects or admin switch
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Menu" })).toContainText("viewer@example.com (Viewer)");
  await expect(page.getByRole("menuitem")).toHaveText(["Change password", "Sign out"]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Show admin tools")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New project/ })).toHaveCount(0);
  // open the dashboard: read-only
  await page.getByRole("button", { name: "Open dashboard Weekly numbers" }).click();
  await expect(page.getByRole("heading", { name: "Weekly numbers" }).first()).toBeVisible();
  await expect(page.locator(".dashboard-widget")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Edit dashboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New dashboard/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Saved charts/ })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Export PDF without calculation pages" })).toBeVisible();
  for (const hidden of ["Duplicate dashboard", "Refresh all", "Delete dashboard"]) await expect(page.getByRole("menuitem", { name: hidden })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator(".dashboard-widget").first().getByRole("button", { name: /^Actions for/ }).click();
  await expect(page.getByRole("menuitem", { name: "Download CSV" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Refresh" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const pdf = await page.request.get((await page.getByRole("link", { name: "Export PDF", exact: true }).getAttribute("href"))!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await capture(page, "viewer-dashboards");
  // pages a viewer cannot open: a plain notice, still no analyst call
  for (const hash of ["analyst", "datasets", "automl", "knowledge", "analytics", "projects", "settings", "evaluation"]) {
    await page.goto("/#" + hash);
    await expect(page.getByRole("heading", { level: 1, name: "Not available" })).toBeVisible();
  }
  await capture(page, "not-available");
  const forbidden = api.calls.filter((c) => isAnalystRoute(c.path));
  expect(forbidden, "a viewer must never request an analyst route").toEqual([]);
  expect(refusals(api)).toEqual([]);                      // and nothing was refused either
  // the server agrees: the same session is refused on an analyst route
  expect((await page.request.get("/api/datasets")).status()).toBe(403);
  expect((await page.request.get("/api/dashboards")).status()).toBe(200);
  expectClean();
});

test("an analyst sees everything except Admin, Home reads the analyst's own questions, and cannot delete", async ({ page }) => {
  const api = trackApi(page);
  await signIn(page, "analyst@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expect(await navLabels(page)).toEqual(["Home", "Ask", "Datasets", "Dashboards", "Predictions", "Business definitions"]);
  await expect(page.getByText("Admin tools", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recent questions" })).toContainText(/total revenue/i);   // from GET /api/analyst/runs
  expect(api.calls.some((c) => c.path.startsWith("/api/analytics"))).toBe(false);                       // the owner-only route is never called
  expect(refusals(api)).toEqual([]);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem").filter({ hasNotText: "Design system" })).toHaveText([/Settings/, /Projects/, /Change password/, /Sign out/]);      // (the Design page item exists only in development builds)
  await expect(page.getByRole("menuitemcheckbox")).toHaveCount(0);                                       // no Admin switch in hosted mode
  await page.keyboard.press("Escape");
  await capture(page, "analyst-home");
  // Datasets: no Delete for an analyst
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await page.locator("table.dataset-table").waitFor();
  await page.getByLabel(/^Actions for shop-orders/).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Dashboards: may change, may not delete
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Duplicate dashboard" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete dashboard" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Admin pages: a plain notice
  for (const hash of ["analytics", "traces", "change-history", "backups", "evaluation"]) {
    await page.goto("/#" + hash);
    await expect(page.getByRole("heading", { level: 1, name: "Not available" })).toBeVisible();
  }
  expect((await page.request.get("/api/analytics/runs")).status()).toBe(403);
  expect((await page.request.get("/api/datasets")).status()).toBe(200);
  // Ask: the pin dialog tells the analyst who can see the pinned rows
  await page.goto("/#analyst");
  await typeQuestionAndConfirmTypesIfAsked(page, "What is the total revenue?");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".answer-sentence")).toBeVisible();
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  const pin = page.getByRole("dialog", { name: "Pin to dashboard" });
  await expect(pin).toContainText("People with the Viewer role can see the rows pinned to this dashboard.");
  await expect(pin).toContainText("Pinning saves up to 1,000 result rows in this project on this computer.");
  await capture(page, "analyst-pin-dialog");
  expectClean();
});

test("an owner sees the Admin pages by role (no switch), without the accuracy check, and may delete", async ({ page }) => {
  await signInOwner(page, "owner@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expect(await navLabels(page)).toEqual(["Home", "Ask", "Datasets", "Dashboards", "Predictions", "Business definitions"]);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Accuracy check" })).toHaveCount(0);
  await expect(page.getByText("Admin tools (owners only)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/not protected by a login/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem").filter({ hasNotText: "Design system" })).toHaveText([/Settings/, /Performance & errors/, /Execution traces/, /Dataset change history/, /Backup info/, /People/, /Security log/, /Projects/, /Change password/, /Sign out/]);      // (the Design page item exists only in development builds)
  await expect(page.getByRole("menuitemcheckbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await goAdmin(page, "Performance & errors");
  await expect(page.getByRole("heading", { level: 1, name: "Performance & errors" })).toBeVisible();
  await expect(page.getByRole("note")).toHaveText(/Admin tools: shown to owners\./);
  await expect(page.locator("main")).not.toContainText(/not protected by a login/i);
  await capture(page, "owner-admin-page");
  await goAdmin(page, "Backup info");
  await expect(page.getByRole("heading", { level: 1, name: "Backup info" })).toBeVisible();
  await page.goto("/#evaluation");
  await expect(page.getByRole("heading", { level: 1, name: "Not available" })).toBeVisible();
  expect((await page.request.get("/api/evaluations")).status()).toBe(404);                          // the accuracy check is not served in hosted mode
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await page.locator("table.dataset-table").waitFor();
  await page.getByLabel(/^Actions for shop-orders/).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Delete dashboard" })).toBeVisible();
  expectClean();
});

test("an ended session asks for sign-in again over the page, keeps what was typed, and returns to the same page", async ({ page, context }) => {
  await signIn(page, "expiry@example.com");
  await page.goto("/#analyst");
  const box = await typeQuestionAndConfirmTypesIfAsked(page, "What is the total revenue?");
  await context.clearCookies();                                                                    // the session ends
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in again" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Your last action may not have been saved");
  await expect(dialog.getByLabel("Email")).toHaveValue("expiry@example.com");
  await capture(page, "session-ended");
  await dialog.getByLabel("Password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("#analyst");                                               // same page
  await expect(box).toHaveValue("What is the total revenue?");                                     // nothing typed was lost
  await page.getByRole("button", { name: "Analyze", exact: true }).click();                        // and the action can simply be repeated
  await expect(page.locator(".answer-sentence")).toBeVisible();
  expectClean();
});

test("signing out returns to the sign-in page, and signing in again returns to the page that was open", async ({ page }) => {
  await signIn(page, "signout@example.com", PASSWORD, "/#dashboards");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect((await page.request.get("/api/dashboards")).status()).toBe(401);                          // the session is really gone
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("signout@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#dashboards");
});

test("a first-login account must choose its own password before anything else", async ({ page }) => {
  await signIn(page, "first@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
  expect((await page.request.get("/api/datasets")).status()).toBe(403);                            // the server refuses everything else meanwhile
  await capture(page, "password-change");
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Repeat the new password").fill("short");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 12 characters");
  await page.getByLabel("New password", { exact: true }).fill("a different long passphrase");
  await page.getByLabel("Repeat the new password").fill("something else entirely");
  await expect(page.getByText("The two passwords differ.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
  await page.getByLabel("Repeat the new password").fill("a different long passphrase");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expect((await page.request.get("/api/dashboards")).status()).toBe(200);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill("first@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password incorrect.");                // the old password no longer works
  await page.getByLabel("Password").fill("a different long passphrase");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expectClean();
});
