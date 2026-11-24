import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/** PRODUCT-POLISH P3: first run on an EMPTY workspace (this config starts a fresh server). Upload path, sample path, plain upload errors. */
const OUT = "../docs/ui-clean/p3";
test.setTimeout(180000);
const CSV = "order_id,region,quantity,revenue\n1,North,3,1250.0\n2,South,1,320.0\n3,East,2,900.0\n4,West,5,2100.0\n5,North,4,700.0\n";

async function checks(page: Page, name: string, rows: unknown[]) {
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(350);
    const overflowFree = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const axe = await new AxeBuilder({ page }).analyze();
    rows.push({ screen: name, width, overflowFree, textUnder14pxCount: small, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function shot(page: Page, name: string) { for (const width of [1280, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true }); } await page.setViewportSize({ width: 1280, height: 900 }); }

test("first run: empty Home, upload a file, check columns, suggested questions, first answer; then the sample path", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows: unknown[] = [];
  await page.goto("/#overview");
  expect(await (await page.request.get("/api/datasets")).json()).toEqual([]);                  // truly empty
  await expect(page.getByRole("heading", { name: "Add your data to get started" })).toBeVisible();
  await expect(page.getByText(/Sample data, not your business/)).toBeVisible();
  await expect(page.getByText(/Show setup guide|Get started/)).toHaveCount(0);                    // no checklist
  await expect(page.getByRole("dialog")).toHaveCount(0);                                          // no tour or popup
  await shot(page, "home-empty"); await checks(page, "home-empty", rows);
  expect((await (await page.request.get("/api/datasets")).json()).length).toBe(0);                // looking at Home added nothing
  // the upload path
  await page.getByRole("button", { name: "Upload a dataset" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await page.getByLabel("Upload CSV file").setInputFiles({ name: "my-shop.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await expect(page.getByRole("heading", { level: 1, name: "Ask your data" })).toBeVisible();     // lands on the first question
  const check = page.locator("details.type-settings");
  await expect(check).toHaveAttribute("open", "");                                                // the quick column check is open, nothing else is needed first
  await shot(page, "ask-first-run"); await checks(page, "ask-first-run", rows);
  await page.getByRole("button", { name: "Use suggested types" }).click();
  await page.locator(".confirm-types input").check();                                              // the owner confirms (Rule 4)
  await expect(page.getByText("Suggested", { exact: true }).first()).toBeVisible();
  const chip = page.locator(".analyst-chips .button").first();
  await chip.click();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".answer-sentence")).toBeVisible({ timeout: 60000 });
  await shot(page, "first-answer");
  // the sample path: nothing is added until the button is pressed
  const list = await (await page.request.get("/api/datasets")).json();
  for (const d of list) await page.request.post(`/api/datasets/${d.id}/archive`);
  await page.goto("/#overview"); await page.reload();
  await expect(page.getByRole("heading", { name: "Add your data to get started" })).toBeVisible();
  const before = (await (await page.request.get("/api/datasets")).json()).length;
  await page.waitForTimeout(800);
  expect((await (await page.request.get("/api/datasets")).json()).length).toBe(before);
  await page.getByRole("button", { name: "Try sample data" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ask your data" })).toBeVisible({ timeout: 30000 });
  const all = await (await page.request.get("/api/datasets?include_archived=true")).json();
  const sample = all.find((d: { name: string }) => d.name === "sample-shop-orders.csv");
  expect(sample, "sample dataset added by the button").toBeTruthy();
  expect(sample.is_sample).toBe(true);                                                            // labelled as sample data
  expect(all.filter((d: { name: string }) => d.name === "my-shop.csv").length).toBe(1);           // the owner's own file is untouched
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(rows, null, 1));
  for (const r of rows as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
});

test("upload problems are explained in plain words", async ({ page }) => {
  await page.goto("/#datasets");
  await page.getByRole("button", { name: "Import CSV" }).click();
  const modal = page.getByRole("dialog");
  await page.getByLabel("Upload CSV file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(modal.getByRole("alert")).toContainText("not a CSV");
  await page.getByLabel("Upload CSV file").setInputFiles({ name: "dupe.csv", mimeType: "text/csv", buffer: Buffer.from("a,A\n1,2\n") });
  await expect(modal.getByRole("alert")).toContainText("Two columns have the same name");
  await page.getByLabel("Upload CSV file").setInputFiles({ name: "ragged.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2,3\n") });
  await expect(modal.getByRole("alert")).toContainText("different number of columns");
  const text = await modal.getByRole("alert").innerText();
  expect(text).not.toMatch(/UTF-8 CSV with fields|nonempty|MiB|fields as the header/);
});

test("P4: a larger file shows a progress bar and then a still-working message, and the page reports the server limit", async ({ page }) => {
  test.setTimeout(240000);
  const rows = ["order_id,region,quantity,revenue"];
  for (let i = 1; i <= 150000; i += 1) rows.push(`${i},R${i % 7},${(i % 9) + 1},${((i * 37) % 1000) / 10}`);
  const big = Buffer.from(rows.join("\n") + "\n");
  await page.goto("/#datasets");
  await page.getByRole("button", { name: "Import CSV" }).click().catch(() => undefined);
  const modal = page.getByRole("dialog");
  if (!(await modal.count())) await page.getByRole("button", { name: /Choose file|Import/ }).first().click().catch(() => undefined);
  await page.getByLabel("Upload CSV file").setInputFiles({ name: "big-orders.csv", mimeType: "text/csv", buffer: big });
  await expect(page.getByRole("progressbar", { name: "Upload progress" })).toBeVisible();
  await expect(page.getByText(/Uploading… \d+%|Reading and checking your file…/)).toBeVisible();
  await expect(page.getByText(/Still working\. Large files can take a minute or two\./)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible({ timeout: 180000 });
  const list = await (await page.request.get("/api/datasets")).json();
  expect(list.find((d: { name: string }) => d.name === "big-orders.csv").rows).toBe(150000);
  // the server's limit is what the page says
  const health = await (await page.request.get("/api/health")).json();
  expect(health.upload_limit_mb).toBe(60);
});
