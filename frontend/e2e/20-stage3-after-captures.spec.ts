import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { knowledgeTab, closeDrawer, openDashboard, openDataQuality, openVersionHistory, selectGlobal, showDatasetList, tileMenu } from "./ui";

/**
 * Stage 3 evidence: every redesigned screen and dialog at 390 / 768 / 1280 with the full axe rule set,
 * a horizontal-overflow check and a text-size check (nothing under 14px). Screenshots land in docs/stage3/after.
 */
test.use({ storageState: { cookies: [], origins: [] } }); // the default owner view: no technical details
const folder = "../docs/stage3/after";
const widths = [1280, 768, 390];
const report: unknown[] = [];

async function snap(page: Page, name: string, fullPage = true) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.mouse.move(2, 2); // keep chart hover tooltips out of the measurement
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement && document.activeElement.matches(".skip-link")) document.activeElement.blur(); window.scrollTo(0, 0); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const offenders = overflow ? [] : await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).display !== "none").slice(0, 6).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(el.getBoundingClientRect().right)} pos=${getComputedStyle(el).position}`));
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
      return direct && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 30)} ${getComputedStyle(el).fontSize}`));
    const axe = await new AxeBuilder({ page }).analyze();
    const violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    report.push({ screen: name, width, overflowFree: overflow, textUnder14px: small, axeViolations: violations });
    await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage });
    expect(overflow, `${name} @${width} horizontal overflow ${JSON.stringify(offenders)}`).toBe(true);
    expect(small, `${name} @${width} text under 14px`).toEqual([]);
    expect(violations, `${name} @${width} axe`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("Stage 3 after-state screens: axe, overflow and text size at 390/768/1280", async ({ page }) => {
  test.setTimeout(280000);
  fs.mkdirSync(folder, { recursive: true });
  const stamp = Date.now();
  const up = await page.request.post("/api/datasets", { multipart: { file: { name: `after-shop-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region,discount_pct\n1,1250,North,5\n2,500,South,10\n3,750,North,0\n4,300,East,5\n") } } });
  expect(up.status()).toBe(201);
  const dataset = await up.json();
  const mk = async (question: string, kind: string, title: string) => {
    const run = await (await page.request.post("/api/analyst/runs", { data: { dataset_id: dataset.id, question, type_mapping: { revenue: "DOUBLE" } } })).json();
    await expect.poll(async () => (await (await page.request.get("/api/analyst/runs/" + run.id)).json()).status, { timeout: 30000 }).toBe("succeeded");
    return (await page.request.post("/api/saved-charts", { data: { run_id: run.id, title, spec: { kind, x: kind === "bar" ? 0 : null, y: kind === "bar" ? 1 : 0 }, persist_snapshot_confirmed: true } })).json();
  };
  const kpi = await mk("AFTER total revenue", "kpi", "Total revenue");
  const bar = await mk("AFTER revenue by region", "bar", "Revenue by region");
  const board = await (await page.request.post("/api/dashboards", { data: { title: "Weekly numbers" } })).json();
  for (const c of [kpi, bar]) {
    const d = await (await page.request.get("/api/dashboards/" + board.id)).json();
    expect((await page.request.post(`/api/dashboards/${board.id}/charts`, { data: { chart_id: c.id, revision: d.revision } })).ok()).toBe(true);
  }

  // Home with data
  await page.goto("/#overview");
  await selectGlobal(page, dataset.id);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you want to know?" })).toBeVisible();
  await snap(page, "home");

  // Ask: first visit, answer, details, menu, pin dialog
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator("details.type-settings")).toHaveJSProperty("open", true);
  await snap(page, "ask-first-visit");
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await expect(page.getByLabel("What revenue is")).toBeVisible();
  await snap(page, "ask-units-card");
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill("What is the total revenue?");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".answer-sentence")).toContainText("2,800");
  await snap(page, "ask-answer");
  await page.getByText("Show details", { exact: true }).click();
  await snap(page, "ask-details-data");
  await page.getByRole("tab", { name: "How this was calculated" }).click();
  await snap(page, "ask-details-calculation");
  await page.getByRole("button", { name: "More result actions" }).click();
  await snap(page, "ask-more-actions-menu", false);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  await snap(page, "ask-pin-dialog", false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Datasets
  await page.goto("/#datasets");
  await selectGlobal(page, dataset.id);
  await snap(page, "datasets");
  await showDatasetList(page);
  await page.locator("tr.selected").getByRole("button", { name: /^Actions for/ }).click();
  await snap(page, "datasets-row-menu", false);
  await page.keyboard.press("Escape");
  await openVersionHistory(page);
  await snap(page, "datasets-version-history", false);
  await closeDrawer(page);
  await openDataQuality(page);
  await snap(page, "datasets-quality-details", false);
  await closeDrawer(page);
  await page.getByRole("tab", { name: "Columns", exact: true }).click();
  await snap(page, "datasets-columns");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await showDatasetList(page);
  await page.locator("tr.selected").getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await snap(page, "datasets-delete-dialog", false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Dashboards
  await page.goto("/#dashboards");
  await openDashboard(page, board.id);
  await expect(page.locator(".dashboard-widget")).toHaveCount(2);
  await snap(page, "dashboards-view");
  await tileMenu(page, page.locator(".dashboard-widget").nth(1), "Details");
  await snap(page, "dashboards-tile-details", false);
  await closeDrawer(page);
  await page.locator(".dashboard-widget").first().getByRole("button", { name: /^Actions for/ }).click();
  await snap(page, "dashboards-tile-menu", false);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await snap(page, "dashboards-more-actions", false);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  await snap(page, "dashboards-edit");
  await page.getByRole("button", { name: "Filters", exact: false }).first().click();
  await snap(page, "dashboards-filters-drawer", false);
  await closeDrawer(page);
  await page.getByRole("button", { name: "Add chart", exact: true }).click();
  await snap(page, "dashboards-saved-charts", false);
  await closeDrawer(page);
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("button", { name: "New dashboard", exact: true }).click();
  await snap(page, "dashboards-new-dashboard", false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Business definitions and Predictions moved to Stage 4: see 22-stage4-after-captures.spec.ts (docs/stage4/after).

  // Projects, switcher and the new-owner (empty project) screens
  await page.goto("/#projects");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await snap(page, "projects");
  await page.locator(".project-trigger").click();
  await snap(page, "project-switcher-open", false);
  await page.keyboard.press("Escape");
  await page.locator(".project-trigger").click();
  await page.getByRole("menuitem", { name: /New project/ }).click();
  await page.getByLabel("Project name").fill(`Capture shop ${stamp}`);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.locator(".project-trigger")).toContainText(`Capture shop ${stamp}`);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await snap(page, "home-new-project");
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await snap(page, "datasets-new-project");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await snap(page, "ask-new-project");
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await snap(page, "dashboards-new-project");

  fs.writeFileSync(`${folder}/report.json`, JSON.stringify(report, null, 2));
});
