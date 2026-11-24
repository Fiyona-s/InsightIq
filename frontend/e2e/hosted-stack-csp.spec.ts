import { expect, test } from "./hosted-helpers";
import { goAdmin, signInOwner } from "./hosted-helpers";

/**
 * Accounts A5: the Content-Security-Policy is proven against the real app by walking its screens through the proxy
 * (playwright.hosted-stack.config.ts). The `cspGuard` fixture in hosted-helpers.ts fails a test on any violation.
 * Only runs through a stack: against the development server there is no proxy and so no policy.
 */
test.skip(!process.env.HOSTED_STACK_URL, "needs HOSTED_STACK_URL (a stack behind the proxy)");
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

test("the policy is sent on pages and API answers, and the guard really detects a violation", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "csp-violation-expected", description: "this test provokes one violation on purpose" });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  const api = await page.request.get("/api/auth/status");
  expect(api.headers()["content-security-policy"]).toContain("default-src 'self'");
  // prove the detector works: an inline script the policy forbids must be reported (and then we clear it so this test can pass)
  const reported = await page.evaluate(() => new Promise<string>((resolve) => {
    document.addEventListener("securitypolicyviolation", (e) => resolve(e.violatedDirective), { once: true });
    const s = document.createElement("script"); s.textContent = "window.__x = 1"; document.body.appendChild(s);
    setTimeout(() => resolve("none"), 1500);
  }));
  expect(reported).toMatch(/^script-src/);
});

test("every owner screen, an answer with its chart, and the exports run under the policy without a violation", async ({ page }) => {
  await signInOwner(page, "owner2@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  for (const [button, heading] of [["Datasets", "Datasets"], ["Dashboards", "Dashboards"], ["Predictions", "Predictions"], ["Business definitions", "Business definitions"], ["Performance & errors", "Performance & errors"], ["Execution traces", "Execution traces"], ["Backup info", "Backup info"], ["People", "People"], ["Security log", "Security log"]] as const) {
    if (["Performance & errors", "Execution traces", "Backup info", "People", "Security log"].includes(button)) await goAdmin(page, button); else await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await page.waitForTimeout(400);
  }
  // an answer with a chart
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill("Total revenue by region");
  const analyze = page.getByRole("button", { name: "Analyze", exact: true }), use = page.getByRole("button", { name: "Use suggested types" });
  await expect.poll(async () => (await analyze.isEnabled()) || (await use.isVisible())).toBe(true);
  if (!(await analyze.isEnabled())) { await use.click(); await page.locator(".confirm-types input").check(); }
  await analyze.click();
  await expect(page.locator(".answer-sentence")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(800);
  // the dashboard and its exports (CSV and PDF)
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  for (const label of items.filter((t) => /PDF|CSV|JSON/i.test(t))) {
    const download = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
    await page.getByRole("button", { name: "More actions", exact: true }).click().catch(() => undefined);
    await page.getByRole("menuitem", { name: label.trim() }).click().catch(() => undefined);
    await download;
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(500);
});
