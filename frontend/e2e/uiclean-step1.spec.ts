import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/** UI-CLEAN step 1 (shell and Home): seeds a small workspace, then captures the Home page before (5178) and after (5174) and checks the changed screens. */
const OUT = "../docs/ui-clean/step1";
const CSV = "order_id,region,quantity,revenue\n1,North,3,1250.0\n2,South,1,320.0\n3,East,2,900.0\n4,West,5,2100.0\n5,North,4,700.0\n";
test.setTimeout(180000);

async function seed(page: Page) {
  const dataset = await (await page.request.post("/api/datasets", { multipart: { file: { name: "shop-orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) } } })).json();
  const mapping = { quantity: "BIGINT", revenue: "DOUBLE" };
  const widgets: object[] = [];
  const created = await page.request.post("/api/dashboards", { data: { title: "Weekly numbers", description: "" } });
  expect(created.status(), await created.text()).toBe(201);
  const board = await created.json();
  for (const [question, title] of [["What is the total revenue?", "Total revenue"], ["What is the total revenue?", "Total revenue again"], ["Total revenue by region", "Revenue by region"]]) {
    const started = await page.request.post("/api/analyst/runs", { data: { dataset_id: dataset.id, question, type_mapping: mapping } });
    expect(started.ok(), await started.text()).toBe(true);
    const run = await started.json();
    await expect.poll(async () => (await (await page.request.get("/api/analyst/runs/" + run.id)).json()).status, { timeout: 60000 }).toBe("succeeded");
    if (title !== "Total revenue again") {
      const chart = await page.request.post("/api/saved-charts", { data: { run_id: run.id, title, persist_snapshot_confirmed: true } });
      expect(chart.status(), await chart.text()).toBe(201);
      widgets.push({ chart_id: (await chart.json()).id, kind: "chart", title, width: 6, height: 4 });
    }
  }
  const got = await (await page.request.get("/api/dashboards/" + board.id)).json();
  const put = await page.request.put("/api/dashboards/" + board.id, { data: { title: "Weekly numbers", description: "", revision: got.revision ?? board.revision, filters: [], widgets } });
  expect(put.status(), await put.text()).toBe(200);
}

async function checks(page: Page, name: string) {
  const rows: unknown[] = [];
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(400);
    const overflowFree = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest("svg")) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const axe = await new AxeBuilder({ page }).analyze();
    rows.push({ screen: name, width, overflowFree, textUnder14pxCount: small, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  return rows;
}

test("Home before and after, at 1280 and 390, and the changed screens pass axe, overflow and 14 px", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("/#overview");
  await seed(page);
  const report: unknown[] = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/#overview");
    await page.reload();
    await expect(page.getByRole("heading", { name: "What do you want to know?" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent questions" }).getByRole("button")).toHaveCount(2);     // the identical question is grouped
    await expect(page.getByRole("region", { name: "Recent questions" })).toContainText("asked 2x");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/after-home-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  report.push(...await checks(page, "home"));
  // Admin pages live under Menu only
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /Show admin tools/ }).click();
  await expect(page.getByRole("menuitem", { name: "Performance & errors" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/after-menu-admin-1280.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button")).toHaveCount(6);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Performance & errors" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Performance & errors" })).toBeVisible();
  report.push(...await checks(page, "admin-page"));
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  for (const r of report as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
});

test("Home before the stage (for comparison only)", async ({ page }) => {
  test.skip(!process.env.BEFORE_DIR, "needs BEFORE_DIR (the UI as it was before the stage)");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("http://127.0.0.1:5178/#overview");
      await expect(page.getByRole("heading", { name: "What do you want to know?" })).toBeVisible();
      await page.getByText("Recent questions").first().waitFor();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/before-home-${width}.png`, fullPage: true });
    }
  
});
