import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/**
 * Stage 5 after state: the Admin pages at 390 / 768 / 1280 (hidden notice, Accuracy check empty and
 * after an offline replay, Performance & errors, Execution traces, and the Menu switch). Asserts each kept capability and the new
 * wording; axe, overflow and 14px results go to report.json and the test fails on any.
 */
const folder = "../docs/stage5/after";
const widths = [1280, 768, 390];
const report: unknown[] = [];
test.use({ storageState: { cookies: [], origins: [] } });

async function snap(page: Page, name: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(350);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest(".ml-step-label") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
      return direct && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const axe = await new AxeBuilder({ page }).analyze();
    report.push({ screen: name, width, overflowFree: overflow, textUnder14pxCount: small, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
    await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("Stage 5 after state: every Admin page, the hidden notice and the new pages", async ({ page }) => {
  test.setTimeout(280000);
  fs.mkdirSync(folder, { recursive: true });
  // 1. Admin switch off: the three notices an owner could reach by bookmark.
  await page.goto("/#evaluation");
  await page.getByText("Admin tools are hidden").waitFor();
  await expect(page.getByRole("heading", { level: 1, name: /Admin tools are hidden/ })).toBeVisible();
  await snap(page, "hidden-notice-accuracy");
  await page.goto("/#analytics");
  await page.getByText("Admin tools are hidden").waitFor();
  await snap(page, "hidden-notice-performance");
  // The Menu with the switch.
  await page.goto("/#overview");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await snap(page, "menu-switch-off");
  const nav = page.getByRole("navigation").first();
  for (const label of ["Accuracy check", "Performance & errors", "Execution traces", "Change history", "Backup info", "Evaluation", "Audit log"]) await expect(nav.getByText(label, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 2. Admin on.
  await page.evaluate(() => localStorage.setItem("insightiq-admin-tools-v1", "true"));
  // Data for the pages: one dataset, a few questions, and the retail benchmark.
  const d = await (await page.request.post("/api/datasets", { multipart: { file: { name: `stage5-${Date.now()}.csv`, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n1,1250,North\n2,500,South\n3,300,East\n") } } })).json();
  for (const q of ["What is the total revenue?", "Total revenue by region"]) {
    await page.request.post("/api/analyst/runs", { data: { dataset_id: d.id, question: q, type_mapping: { revenue: "DOUBLE" } } });
  }
  await page.waitForTimeout(2500);
  const installed = await (await page.request.post("/api/benchmarks/retail-v1/install")).json();
  await page.request.post(`/api/benchmarks/retail-v1/verify?dataset_id=${installed.dataset_id}`);

  await page.goto("/#evaluation");
  await page.reload();                                                  // the switch is read when the page loads
  await page.getByRole("heading", { name: "Accuracy check" }).waitFor();
  await page.waitForTimeout(800);
  await expect(page.getByText(/What this is for/)).toBeVisible();
  await expect(page.getByText(/not protected by a login. Anyone using this computer can open them/)).toBeVisible();
  await snap(page, "accuracy-check-current-state");
  const setup = page.getByRole("button", { name: "Set up offline replay" });
  if (await setup.count()) {
    await setup.click();
    const override = page.getByRole("button", { name: "Use benchmark for this page only" });
    if (await override.count()) await override.click().catch(() => undefined);
    await page.waitForTimeout(600);
    await snap(page, "accuracy-check-setup");
    const run = page.locator("#offline-run-button");
    if (await run.count()) {
      await run.click().catch(() => undefined);
      await page.waitForTimeout(5000);
      await snap(page, "accuracy-check-after-offline-replay");
    }
  }
  await page.goto("/#analytics");
  await page.getByRole("heading", { name: "Performance & errors" }).waitFor();
  await page.waitForTimeout(800);
  await expect(page.getByText(/What this is for/)).toBeVisible();
  await snap(page, "performance-errors");
  await page.goto("/#traces");
  await page.getByRole("heading", { name: "Execution traces" }).waitFor();
  await page.waitForTimeout(800);
  await expect(page.getByText(/What this is for/)).toBeVisible();
  await snap(page, "execution-traces");
  await page.goto("/#change-history");
  await page.getByRole("heading", { level: 1, name: "Dataset change history" }).waitFor();
  await expect(page.getByText(/not a complete audit trail/i)).toBeVisible();
  await expect(page.getByText(/not protected by a login. Anyone using this computer can open them/)).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await snap(page, "change-history");
  await page.goto("/#backups");
  await page.getByRole("heading", { level: 1, name: "Backup info" }).waitFor();
  await expect(page.getByText(/not this computer/)).toBeVisible();
  await expect(page.getByText(/not protected by a login. Anyone using this computer can open them/)).toBeVisible();
  await snap(page, "backup-info");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await snap(page, "menu-switch-on");
  fs.writeFileSync(`${folder}/report.json`, JSON.stringify(report, null, 1));
  for (const r of report as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
});
