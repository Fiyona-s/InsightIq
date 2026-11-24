import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { knowledgeTab, selectGlobal } from "./ui";

/**
 * Stage 4 evidence: Predictions (three guided steps) and Business definitions (two tabs + Advanced) at
 * 390 / 768 / 1280 with the full axe rule set, a horizontal-overflow check and a text-size check (nothing under
 * 14px). Screenshots land in docs/stage4/after. Also proves the data-driven leakage warning and the plain wording.
 */
test.use({ storageState: { cookies: [], origins: [] } });
const folder = "../docs/stage4/after";
const widths = [1280, 768, 390];
const report: unknown[] = [];

async function snap(page: Page, name: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.mouse.move(2, 2);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest(".ml-step-label") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
      return direct && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 30)} ${getComputedStyle(el).fontSize}`));
    const axe = await new AxeBuilder({ page }).analyze();
    const violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    report.push({ screen: name, width, overflowFree: overflow, textUnder14px: small, axeViolations: violations });
    await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
    expect(overflow, `${name} @${width} horizontal overflow`).toBe(true);
    expect(small, `${name} @${width} text under 14px`).toEqual([]);
    expect(violations, `${name} @${width} axe`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const csv = (rows: string[], head: string) => Buffer.from(head + "\n" + rows.join("\n") + "\n");
async function upload(page: Page, name: string, buffer: Buffer) {
  return (await (await page.request.post("/api/datasets", { multipart: { file: { name, mimeType: "text/csv", buffer } } })).json()) as { id: string };
}
const NEXT = "Next: check and train";

test("Stage 4: Predictions in three steps, the data-driven leakage warning, and Business definitions in two tabs", async ({ page }) => {
  test.setTimeout(280000);
  fs.mkdirSync(folder, { recursive: true });
  const trains: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/automl/experiments") trains.push(r.url()); });
  // Cancelled orders have revenue exactly 0: a column that gives the answer away.
  const rows = Array.from({ length: 240 }, (_, i) => {
    const cancelled = i % 5 === 0, units = 1 + (i % 6), price = 20 + (i % 9) * 5;
    return `${1000 + i},${["North", "South", "East", "West"][i % 4]},${units},${price},${cancelled ? "cancelled" : "completed"},${cancelled ? 0 : units * price}`;
  });
  const d = await upload(page, `stage4-orders-${Date.now()}.csv`, csv(rows, "order_id,region,units,unit_price,status,revenue"));

  // ---- Predictions ----
  await page.goto("/#predictions");
  await selectGlobal(page, d.id);
  const stages = page.getByRole("navigation", { name: "Model workflow" }).getByRole("button");
  await expect(stages).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "What do you want to predict?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: NEXT })).toBeDisabled();
  await snap(page, "predictions-1-what-to-predict");
  await page.getByRole("button", { name: /Predict a category/ }).click();
  await page.getByLabel("Target column").selectOption("status");
  await expect(page.getByRole("region", { name: "Target values" })).toContainText("different values");
  await snap(page, "predictions-1-target-chosen");
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByRole("heading", { name: "Check and train", exact: true })).toBeFocused();
  for (const f of ["region", "units", "unit_price", "revenue"]) await page.getByLabel("Use feature " + f, { exact: true }).check();
  const warning = page.getByRole("alert", { name: "Columns that may give away the answer" });
  await expect(warning).toContainText("revenue");                                              // data-driven: named before training
  await expect(warning).toContainText("When revenue is 0, status is always cancelled (48 of 48 rows).");
  await expect(warning).toContainText("may give away the answer");
  await expect(warning).toContainText("only a warning, not a finding");
  await page.getByRole("checkbox", { name: /I confirm selected predictors/ }).check();
  await expect(page.getByRole("button", { name: "Train local models", exact: true })).toBeEnabled();   // a warning never blocks
  await expect(page.locator(".button-primary:visible")).toHaveCount(1);
  expect(trains).toEqual([]);                                                                   // nothing trained by navigating
  await snap(page, "predictions-2-check-and-train");
  await page.getByRole("button", { name: "Train local models", exact: true }).click();
  await expect(page.getByRole("region", { name: "AutoML experiment results" })).toBeVisible({ timeout: 120000 });
  expect(trains).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "Results and predict", exact: true })).toBeVisible();
  const results = page.getByRole("region", { name: "AutoML experiment results" });
  await expect(results.getByRole("heading", { name: "How accurate is this?" })).toBeVisible();
  await expect(results.getByRole("columnheader", { name: /Simple guess, for comparison/ })).toBeVisible();   // the baseline is labelled
  const leak = results.getByRole("alert", { name: "Leakage warning" });
  await expect(leak).toContainText("revenue");                                                  // named again after training
  for (const jargon of ["fingerprint", "imputation", "numeric__"]) await expect(page.locator("main")).not.toContainText(jargon);
  await expect(page.getByRole("heading", { name: "Predict with a saved model" })).toBeVisible();   // results and predicting on one step
  await snap(page, "predictions-3-results-and-predict");

  // ---- Business definitions ----
  await page.goto("/#knowledge");
  await selectGlobal(page, d.id);
  await expect(page.getByRole("tablist", { name: "Business definitions" }).getByRole("tab")).toHaveText(["What your columns mean", "Your key metrics"]);
  await expect(page.locator(".button-primary:visible")).toHaveCount(1);
  await snap(page, "definitions-columns");
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await page.getByRole("dialog", { name: "Draft data sharing" }).waitFor();
  await snap(page, "definitions-dialog-data-sharing");
  await page.getByRole("dialog", { name: "Draft data sharing" }).getByRole("button", { name: "Cancel" }).click();
  await knowledgeTab(page, "Your key metrics");
  await page.getByRole("button", { name: "Add metric" }).click();
  await expect(page.locator(".button-primary:visible")).toHaveCount(1);
  await snap(page, "definitions-metrics");
  await knowledgeTab(page, "Advanced");
  await expect(page.getByRole("heading", { name: "What Ask can find" })).toBeVisible();
  await snap(page, "definitions-advanced");
  fs.writeFileSync(`${folder}/report.json`, JSON.stringify(report, null, 1));
});
