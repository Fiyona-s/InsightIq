import { test, expect } from "@playwright/test";
import fs from "node:fs";

/** PRODUCT-POLISH P5: the three README screenshots, from a throwaway workspace with fictional data (controlled provider; no live AI). */
const OUT = "../docs/readme";
const CSV = "order_id,order_date,region,product,quantity,revenue\n"+Array.from({length:40},(_,i)=>`${i+1},2026-0${1+(i%6)}-1${i%9},${["North","South","East","West"][i%4]},${["Notebook","Desk lamp","Backpack"][i%3]},${1+(i%5)},${((i*37)%500)+20}.00`).join("\n")+"\n";
test.setTimeout(180000);
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


test("README screenshots", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/#overview");
  await seed(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/#overview"); await page.reload();
  await expect(page.getByRole("heading", { name: "What do you want to know?" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent questions" }).getByRole("button").first()).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/home.png` });
  await page.goto("/#analyst"); await page.reload();
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill("Total revenue by region");
  const analyze = page.getByRole("button", { name: "Analyze", exact: true }), use = page.getByRole("button", { name: "Use suggested types" });
  await expect.poll(async () => (await analyze.isEnabled()) || (await use.isVisible())).toBe(true);
  if (!(await analyze.isEnabled())) { await use.click(); await page.locator(".confirm-types input").check(); }
  await analyze.click();
  await expect(page.locator(".answer-sentence")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/ask.png` });
  await page.goto("/#datasets"); await page.reload();
  await expect(page.locator("table.dataset-table")).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/datasets.png` });
});
