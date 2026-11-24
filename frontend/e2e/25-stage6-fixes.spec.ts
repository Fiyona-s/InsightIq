import { test, expect } from "@playwright/test";
import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { knowledgeTab, openDashboard, selectGlobal } from "./ui";

/**
 * Stage 6 logic fixes, in a real browser against the controlled test server (no live AI):
 * owner-set sample flag + Select all samples + bulk archive, per-item metric approval, dashboard display currency
 * remembered per dashboard, "Saved before change tracking" wording, unit label, and the simpler verified-example steps.
 */
const folder = "../docs/stage6/after";
const widths = [1280, 768, 390];
const report: unknown[] = [];
test.use({ storageState: { cookies: [], origins: [] } });

const CSV = "id,revenue,region\n001,1250,North\n002,20,South\n003,300,East\n";
async function upload(page: import("@playwright/test").Page, name: string) {
  const r = await page.request.post("/api/datasets", { multipart: { file: { name, mimeType: "text/csv", buffer: Buffer.from(CSV) } } });
  expect(r.status()).toBe(201);
  return r.json();
}
async function snap(page: import("@playwright/test").Page, name: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(350);
    const overflowFree = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const axe = await new AxeBuilder({ page }).analyze();
    report.push({ screen: name, width, overflowFree, textUnder14pxCount: small, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
    await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("sample data is whatever the owner marks: mark, hide, select all samples, bulk archive", async ({ page }) => {
  test.setTimeout(120000);
  fs.mkdirSync(folder, { recursive: true });
  const suffix = String(Date.now());
  const demo = await upload(page, `InsightIQ_Retail_Demo_${suffix}.csv`);
  const t1 = await upload(page, `illustrative-e2e-${suffix}-a.csv`);
  const t2 = await upload(page, `SYNTHETIC-${suffix}-b.csv`);
  const real = await upload(page, `shop-sales-${suffix}.csv`);
  await page.goto("/#datasets");
  await page.locator("table.dataset-table").waitFor();
  await page.getByLabel("Find a dataset", { exact: true }).fill(suffix);
  // Nothing is a sample on its own, whatever it is called.
  await expect(page.locator("table.dataset-table .sample-badge")).toHaveCount(0);
  await expect(page.getByLabel("Hide sample data")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select all samples" })).toHaveCount(0);
  await snap(page, "datasets-nothing-marked");
  // Mark the two test files through the row menu.
  for (const d of [t1, t2]) {
    await page.getByLabel(`Actions for ${d.name}`, { exact: true }).click();
    await page.getByRole("menuitem", { name: "Mark as sample", exact: true }).click();
    await expect(page.getByLabel(`Actions for ${d.name}`, { exact: true }).locator("xpath=ancestor::tr").locator(".sample-badge")).toBeVisible();
  }
  await expect(page.locator("table.dataset-table .sample-badge")).toHaveCount(2);
  // The real demo file is untouched and visible even with sample data hidden.
  await page.getByLabel("Hide sample data").check();
  await expect(page.getByLabel(`Actions for ${demo.name}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel(`Actions for ${t1.name}`, { exact: true })).toHaveCount(0);
  await page.reload();
  await page.locator("table.dataset-table").waitFor();
  await page.getByLabel("Find a dataset", { exact: true }).fill(suffix);
  await expect(page.getByLabel("Hide sample data")).toBeChecked();
  await expect(page.getByLabel(`Actions for ${demo.name}`, { exact: true })).toBeVisible();
  await page.getByLabel("Hide sample data").uncheck();
  // Select all samples -> bulk bar -> archive only those two.
  await page.getByRole("button", { name: "Select all samples" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();
  await snap(page, "datasets-samples-selected");
  await page.getByRole("region", { name: "Selected dataset actions" }).getByRole("button", { name: "Archive", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Archive/ }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  const list = await (await page.request.get("/api/datasets?include_archived=true")).json();
  const archived = (id: string) => !!list.find((d: { id: string }) => d.id === id).archived_at;
  expect([archived(t1.id), archived(t2.id), archived(demo.id), archived(real.id)]).toEqual([true, true, false, false]);
  // The owner can unmark: the flag is a plain preference, nothing else changes.
  expect((await page.request.put(`/api/datasets/${t1.id}/sample`, { data: { is_sample: false } })).status()).toBe(200);
  expect((await (await page.request.get(`/api/datasets/${t1.id}`)).json()).is_sample).toBe(false);
  // Home only offers "Use sample data" for something the owner marked.
  await page.goto("/#overview");
  await expect(page.getByRole("button", { name: "Use sample data" })).toHaveCount(0);
});

test("metric calculations are approved one at a time; the API refuses them in approve-all", async ({ page }) => {
  test.setTimeout(120000);
  const d = await upload(page, `synthetic-stage6-metrics-${Date.now()}.csv`);
  const state = await (await page.request.get(`/api/datasets/${d.id}/knowledge/review`)).json();
  expect(state.drafts).toEqual([]);
  const sharing = await page.request.post(`/api/datasets/${d.id}/knowledge/drafts`, { data: { confirm_sharing: true } });
  expect(sharing.ok(), await sharing.text()).toBe(true);
  const review = await (await page.request.get(`/api/datasets/${d.id}/knowledge/review`)).json();
  const metric = review.drafts.find((x: { item_type: string }) => x.item_type === "metric");
  expect(metric).toBeTruthy();
  const refused = await page.request.post(`/api/datasets/${d.id}/knowledge/drafts/approve-all`, { data: { ids: [metric.id], confirm_count: 1, confirm_revision: review.revision } });
  expect(refused.status()).toBe(409);
  await page.goto("/#knowledge");
  await selectGlobal(page, d.id);
  await knowledgeTab(page, "AI drafts");
  const panel = page.locator(".knowledge-review");
  await expect(panel.getByRole("button", { name: /^Approve all eligible/ })).toHaveCount(0);
  const metricCard = panel.locator(".knowledge-draft").filter({ hasText: metric.item_key });
  await expect(metricCard.getByText(/SELECT/i).first()).toBeVisible();
  await expect(metricCard.getByText(/approve it on its own/)).toBeVisible();
  await snap(page, "business-definitions-metric-review");
  await metricCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(metricCard).toContainText("approved by you");
});

test("display currency is remembered per dashboard; no selector without a confirmed currency", async ({ page }) => {
  test.setTimeout(120000);
  const d = await upload(page, `synthetic-stage6-currency-${Date.now()}.csv`);
  const plain = await upload(page, `synthetic-stage6-plain-${Date.now()}.csv`);
  const knowledge = await (await page.request.get(`/api/datasets/${d.id}/knowledge`)).json();
  knowledge.settings.monetary_columns = { revenue: { currency: "INR" } };
  expect((await page.request.put(`/api/datasets/${d.id}/knowledge`, { data: knowledge.settings })).ok()).toBe(true);
  async function board(datasetId: string, title: string) {
    const run = await (await page.request.post("/api/analyst/runs", { data: { dataset_id: datasetId, question: "What is the total revenue?", type_mapping: { revenue: "DOUBLE" } } })).json();
    await expect.poll(async () => (await (await page.request.get(`/api/analyst/runs/${run.id}`)).json()).status).toBe("succeeded");
    const chart = await (await page.request.post("/api/saved-charts", { data: { run_id: run.id, title, persist_snapshot_confirmed: true } })).json();
    const doc = await (await page.request.post("/api/dashboards", { data: { title } })).json();
    const put = await page.request.put(`/api/dashboards/${doc.id}`, { data: { title, description: "", revision: doc.revision, filters: [], widgets: [{ chart_id: chart.id, kind: "chart", title, width: 6, height: 4 }] } });
    expect(put.status()).toBe(200);
    return doc.id as string;
  }
  const withCurrency = await board(d.id, "Stage6 money board");
  const without = await board(plain.id, "Stage6 plain board");
  await page.goto("/#dashboards");
  await openDashboard(page, withCurrency);
  await page.getByLabel("Report currency", { exact: true }).selectOption("USD");
  await expect(page.locator(".dashboard-currency")).toContainText("1 INR =");
  await page.reload();
  await openDashboard(page, withCurrency);
  await expect(page.getByLabel("Report currency", { exact: true })).toHaveValue("USD");
  await expect(page.locator(".dashboard-currency")).toContainText("1 INR =");
  await snap(page, "dashboard-currency-remembered");
  await openDashboard(page, without);
  await expect(page.getByLabel("Report currency", { exact: true })).toHaveCount(0);   // no confirmed currency: no selector
  await openDashboard(page, withCurrency);
  await expect(page.getByLabel("Report currency", { exact: true })).toHaveValue("USD");
  await page.getByLabel("Report currency", { exact: true }).selectOption("");
  await page.reload();
  await openDashboard(page, withCurrency);
  await expect(page.getByLabel("Report currency", { exact: true })).toHaveValue("");
  // Blocked storage must not break the page.
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("denied"); }; Storage.prototype.removeItem = () => { throw new Error("denied"); }; });
  await page.reload();
  await openDashboard(page, withCurrency);
  await page.getByLabel("Report currency", { exact: true }).selectOption("USD");
  await expect(page.locator(".dashboard-currency")).toContainText("1 INR =");
});

test("a chart saved before change tracking says so in plain words", async ({ page }) => {
  test.setTimeout(120000);
  const d = await upload(page, `synthetic-stage6-legacy-${Date.now()}.csv`);
  const run = await (await page.request.post("/api/analyst/runs", { data: { dataset_id: d.id, question: "What is the total revenue?", type_mapping: { revenue: "DOUBLE" } } })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/analyst/runs/${run.id}`)).json()).status).toBe("succeeded");
  const chart = await (await page.request.post("/api/saved-charts", { data: { run_id: run.id, title: "Stage6 legacy", persist_snapshot_confirmed: true } })).json();
  const doc = await (await page.request.post("/api/dashboards", { data: { title: "Stage6 legacy board" } })).json();
  await page.request.put(`/api/dashboards/${doc.id}`, { data: { title: doc.title, description: "", revision: doc.revision, filters: [], widgets: [{ chart_id: chart.id, kind: "chart", title: "Stage6 legacy", width: 6, height: 4 }] } });
  const widget = (await (await page.request.get(`/api/dashboards/${doc.id}`)).json()).widgets[0];
  await page.request.post(`/api/test/phase6/${doc.id}/${widget.id}/legacy`);
  const stored = (await (await page.request.get(`/api/dashboards/${doc.id}`)).json()).widgets[0].freshness.status;
  expect(stored).toBe("Revision not recorded");                       // the stored status value is unchanged
  await page.goto("/#dashboards");
  await openDashboard(page, doc.id);
  const tile = page.locator(".dashboard-widget").first();
  await expect(tile).toContainText("Saved before change tracking");
  await expect(tile).not.toContainText("Revision not recorded");
  await snap(page, "dashboard-saved-before-tracking");
});

test("verified example: three explicit steps, single value by default, safeguards never pre-ticked or combined", async ({ page }) => {
  test.setTimeout(120000);
  const d = await upload(page, `synthetic-stage6-steps-${Date.now()}.csv`);
  const run = await (await page.request.post("/api/analyst/runs", { data: { dataset_id: d.id, question: "What is the total revenue?", type_mapping: { revenue: "DOUBLE" } } })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/analyst/runs/${run.id}`)).json()).status).toBe("succeeded");
  const candidate = await page.request.post(`/api/datasets/${d.id}/knowledge/candidates`, { data: { run_id: run.id } });
  expect(candidate.ok(), await candidate.text()).toBe(true);
  await page.goto("/#knowledge");
  await selectGlobal(page, d.id);
  await knowledgeTab(page, "Advanced");
  const example = page.locator(".knowledge-example").filter({ hasText: "What is the total revenue?" });
  await expect(example.getByRole("list", { name: "Steps to verify this example" }).getByRole("listitem")).toHaveText(["Write the answer yourself", "Check it against the example", "Approve it"]);
  await expect(example.getByLabel("Reference type")).toHaveValue("scalar");
  const independent = example.getByLabel(/I wrote this reference independently/);
  await expect(independent).not.toBeChecked();
  const check = example.getByRole("button", { name: "Check reference" }), approve = example.getByRole("button", { name: "Approve example" });
  await example.getByRole("textbox", { name: "Single value" }).fill("1570");
  await example.getByPlaceholder("value").fill("total_revenue");
  await expect(check).toBeDisabled();                       // typing a value is not enough: the owner must confirm independence
  await expect(approve).toBeDisabled();
  await snap(page, "verified-example-steps");
  await independent.check();
  await expect(approve).toBeDisabled();                     // confirming independence does not approve
  await check.click();
  await expect(example.getByText(/Check result:/)).toBeVisible();
  await expect(example.getByRole("heading", { name: "Candidate", exact: true })).toBeVisible();   // checked, still not approved: Approve is its own click
  await approve.click();
  await expect(page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
  fs.writeFileSync(`${folder}/report.json`, JSON.stringify(report, null, 1));
  for (const r of report as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
});
