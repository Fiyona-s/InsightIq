import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/** PRODUCT-POLISH P2: every redone page, before (5178) and after (5174), plus axe, overflow and 14 px checks at 390/768/1280 on the after screens. */
const OUT = "../docs/ui-clean/p2";
const CSV = "order_id,region,quantity,revenue\n1,North,3,1250.0\n2,South,1,320.0\n3,East,2,900.0\n4,West,5,2100.0\n5,North,4,700.0\n";
test.setTimeout(240000);
const PAGES: [string, string][] = [["predictions", "#predictions"], ["business-definitions", "#knowledge"], ["projects", "#projects"]];

async function seed(page: Page) {
  const created = await page.request.post("/api/datasets", { multipart: { file: { name: "shop-orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) } } });
  const dataset = await created.json();
  const board = await (await page.request.post("/api/dashboards", { data: { title: "Weekly numbers", description: "" } })).json();
  const run = await (await page.request.post("/api/analyst/runs", { data: { dataset_id: dataset.id, question: "Total revenue by region", type_mapping: { quantity: "BIGINT", revenue: "DOUBLE" } } })).json();
  await expect.poll(async () => (await (await page.request.get("/api/analyst/runs/" + run.id)).json()).status, { timeout: 60000 }).toBe("succeeded");
  const chart = await (await page.request.post("/api/saved-charts", { data: { run_id: run.id, title: "Revenue by region", persist_snapshot_confirmed: true } })).json();
  const got = await (await page.request.get("/api/dashboards/" + board.id)).json();
  await page.request.put("/api/dashboards/" + board.id, { data: { title: "Weekly numbers", description: "", revision: got.revision ?? board.revision, filters: [], widgets: [{ chart_id: chart.id, kind: "chart", title: "Revenue by region", width: 6, height: 4 }] } });
}

async function checks(page: Page, name: string, rows: unknown[]) {
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(350);
    const overflowFree = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest("svg") || el.closest(".recharts-wrapper") || el.closest(".ml-step-label")) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const nested = await page.evaluate(() => Array.from(document.querySelectorAll("main *")).filter((el) => { if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return false; const s = getComputedStyle(el); return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 2 && !el.closest(".ui-modal, .ui-drawer, [role=dialog]"); }).map((el) => el.tagName + "." + String(el.className).slice(0, 60)));
    const axe = await new AxeBuilder({ page }).analyze();
    rows.push({ screen: name, width, overflowFree, textUnder14pxCount: small, nestedVerticalScrollBoxes: nested.length, nestedBoxes: nested, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("after: every redone page at 1280 and 390, with layout checks", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/#overview");
  await seed(page);
  const rows: unknown[] = [];
  const shots = async (name: string) => { for (const width of [1280, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/after-${name}-${width}.png`, fullPage: true }); } await page.setViewportSize({ width: 1280, height: 900 }); };
  for (const [name, hash] of PAGES) {
    await page.goto("/" + hash); await page.reload();
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForTimeout(900);
    await shots(name); await checks(page, name, rows);
  }
  // Ask with an answer
  await page.goto("/#analyst"); await page.reload();
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill("Total revenue by region");
  const analyze = page.getByRole("button", { name: "Analyze", exact: true }), use = page.getByRole("button", { name: "Use suggested types" });
  await expect.poll(async () => (await analyze.isEnabled()) || (await use.isVisible())).toBe(true);
  if (!(await analyze.isEnabled())) { await use.click(); await page.locator(".confirm-types input").check(); }
  await analyze.click();
  await expect(page.locator(".answer-sentence")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(900);
  await shots("ask-answer"); await checks(page, "ask-answer", rows);
  await page.getByText("Show details", { exact: true }).click();
  await page.getByRole("tab", { name: "How this was calculated" }).click();
  await page.waitForTimeout(500);
  await shots("ask-answer-details"); await checks(page, "ask-answer-details", rows);
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(rows, null, 1));
  for (const r of rows as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; nestedVerticalScrollBoxes: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
});

test("before the stage (for comparison only)", async ({ page }) => {
  test.skip(!process.env.BEFORE_DIR, "needs BEFORE_DIR");
  for (const [name, hash] of [...PAGES, ["ask-answer", "#analyst"]] as [string, string][]) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("http://127.0.0.1:5178/" + hash);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/before-${name}-${width}.png`, fullPage: true });
    }
  }
});
