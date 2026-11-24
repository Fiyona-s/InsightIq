import { expect, test as base, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const PASSWORD = "correct horse battery";
export const folder = process.env.HOSTED_E2E_CAPTURE_DIR || "../docs/accounts/a5/after";
export const widths = [1280, 768, 390];
export const report: unknown[] = [];

export async function signIn(page: Page, email: string, password = PASSWORD, path = "/") {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Every /api request the page makes, so a test can prove which routes a role never calls. */
export function trackApi(page: Page) {
  const calls: { method: string; path: string }[] = [], statuses: { path: string; status: number }[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) calls.push({ method: r.method(), path: u.pathname }); });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) statuses.push({ path: u.pathname, status: r.status() }); });
  return { calls, statuses };
}

/** Axe, horizontal overflow and the 14 px minimum at 390, 768 and 1280, plus a screenshot, for the screen shown now. */
export async function capture(page: Page, name: string) {
  fs.mkdirSync(folder, { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.mouse.move(2, 2);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement && !document.activeElement.closest("dialog")) document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.waitForTimeout(350);
    const overflowFree = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest(".ml-step-label") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const axe = await new AxeBuilder({ page }).analyze();
    report.push({ screen: name, width, overflowFree, textUnder14pxCount: small, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
    await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

export function writeReport() {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(`${folder}/report.json`, JSON.stringify(report, null, 1));
}

export function expectClean() {
  for (const r of report as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
}

/** Routes only an analyst or owner may call (a viewer must never request them). */
export const ANALYST_PREFIXES = ["/api/analyst", "/api/automl", "/api/analytics", "/api/benchmarks", "/api/evaluations"];
export const isAnalystRoute = (path: string) =>
  ANALYST_PREFIXES.some((p) => path.startsWith(p)) || (path.startsWith("/api/datasets") && path !== "/api/datasets/references") || path.startsWith("/api/saved-charts");

/** Responses of 400 or more. Before sign-in the page asks only the status question, which never fails. */
export const refusals = (api: { statuses: { path: string; status: number }[] }) => api.statuses.filter((s) => s.status >= 400);

/** Throwaway owner secrets written by hosted_e2e_prepare.py. They belong to no real account. */
const ownersFile = process.env.HOSTED_E2E_OWNERS_FILE || path.join(process.env.HOSTED_E2E_DIR || path.join(os.tmpdir(), "insightiq-hosted-e2e"), "e2e_owners.json");
export const owners = (): Record<string, { secret: string; recovery_codes: string[] }> => JSON.parse(fs.readFileSync(ownersFile, "utf8"));

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function totpAt(secret: string, step: number) {
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}
/** A code for a 30-second step the server has not seen from this test run yet (it accepts one step either side of now, each once). */
const lastStep = new Map<string, number>();
export async function nextCode(email: string, secret = owners()[email]?.secret) {
  for (;;) {
    const now = Math.floor(Date.now() / 30000);
    const step = [now - 1, now, now + 1].find((s) => s > (lastStep.get(email) ?? 0));
    if (step !== undefined) { lastStep.set(email, step); return totpAt(secret, step); }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Admin pages live under the top-bar Menu: open it and choose the page. */
export async function goAdmin(page: Page, name: string) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** Password step, then the code step, for an owner whose two-step sign-in is already set up. */
export async function signInOwner(page: Page, email: string, path = "/") {
  await signIn(page, email, PASSWORD, path);
  await page.getByLabel(/Code from your authenticator app/).fill(await nextCode(email));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

/**
 * `test` for the hosted specs. Run through the real proxy (HOSTED_STACK_URL, playwright.hosted-stack.config.ts) it also fails any
 * test during which the browser reports a Content-Security-Policy violation, so the policy is proven against the real app.
 */
export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [async ({ page }, use, testInfo) => {
    const seen: string[] = [];
    if (process.env.HOSTED_STACK_URL) {
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI}`));
      });
      page.on("console", (m) => { if (/CSP-VIOLATION|Content Security Policy|Refused to/i.test(m.text())) seen.push(m.text()); });
    }
    await use();
    if (!testInfo.annotations.some((a) => a.type === "csp-violation-expected")) expect(seen, "Content-Security-Policy violations").toEqual([]);
  }, { auto: true }],
});
export { expect };
