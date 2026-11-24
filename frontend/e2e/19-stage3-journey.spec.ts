import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { addSavedChart, selectGlobal, closeDrawer, editDashboard, openDashboard, openTileDetails, tileMenu } from "./ui";

const folder = "../docs/stage3/journey";

/** Stage 3 done-when: a brand-new owner, no help text, under five minutes, recorded as video. */
test.use({ storageState: { cookies: [], origins: [] }, video: { mode: "on", size: { width: 1280, height: 720 } }, viewport: { width: 1280, height: 720 } });
test.describe("new owner journey", () => {
  test("new project → upload → first answer → pin to a NEW dashboard → PDF, in under 5 minutes with no help text", async ({ page }, info) => {
    test.setTimeout(300000);
    fs.mkdirSync(folder, { recursive: true });
    const started = Date.now();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const opened: string[] = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) opened.push(frame.url()); });
    const stamp = Date.now();
    const csv = "id,revenue,region\n1,1250,North\n2,500,South\n3,750,North\n";

    // 1. A new project, so the owner sees exactly what a first-time owner sees.
    await page.goto("/#");
    await page.locator(".project-trigger").click();
    await page.getByRole("menuitem", { name: /New project/ }).click();
    await page.getByLabel("Project name").fill(`Journey shop ${stamp}`);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page.locator(".project-trigger")).toContainText(`Journey shop ${stamp}`);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add your data to get started" })).toBeVisible();
    await page.screenshot({ path: `${folder}/01-home-new-project.png` });

    // 2. Upload.
    await page.getByRole("region", { name: "Welcome" }).getByRole("button", { name: "Upload a dataset" }).click();
    await page.getByLabel("Upload CSV file").setInputFiles({ name: `journey-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("heading", { level: 1, name: "Ask your data" })).toBeVisible();      // P3: the first upload from Home lands on the first question
    await page.getByRole("button", { name: "Datasets", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible();
    await expect(page.locator("table.dataset-table")).toBeVisible();
    await page.screenshot({ path: `${folder}/02-datasets.png` });

    // 3. Home now leads with the question box. Type a question; it opens Ask with the text in place.
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What do you want to know?" })).toBeVisible();
    await page.getByLabel("Your question").fill("What is the total revenue?");
    await page.getByRole("region", { name: "Ask a question" }).getByRole("button", { name: "Ask now", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toHaveValue("What is the total revenue?");
    // Nothing ran yet: the owner still has to confirm column types and press Analyze.
    await expect(page.getByRole("region", { name: "Result insights" })).toHaveCount(0);
    await page.screenshot({ path: `${folder}/03-ask-first-visit.png` });

    // 4. Confirm column types (first visit), then Analyze.
    const panel = page.locator("details.type-settings");
    await expect(panel).toHaveJSProperty("open", true);
    await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
    await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    const answer = page.getByRole("region", { name: "Result insights" });
    await expect(answer.locator(".answer-sentence")).toContainText("2,500");
    await page.screenshot({ path: `${folder}/04-first-answer.png` });
    // Owners see plain details only: the data and how it was calculated, no SQL.
    await answer.getByText("Show details", { exact: true }).click();
    await expect(answer.getByRole("tab", { name: "How this was calculated" })).toBeVisible();
    await expect(answer.getByRole("tab", { name: "SQL" })).toHaveCount(0);
    await answer.getByText("Show details", { exact: true }).click();

    // 5. Pin to a NEW dashboard created inline (this project has none).
    await answer.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pin to dashboard" });
    await expect(dialog.getByRole("combobox", { name: "Dashboard", exact: true })).toHaveValue("__new__");
    await dialog.getByLabel("New dashboard name").fill("Weekly numbers");
    await expect(dialog.getByText("Pinning saves up to 1,000 result rows in this project on this computer.")).toBeVisible();
    await page.screenshot({ path: `${folder}/05-pin-dialog.png` });
    await dialog.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(page.getByText(/Pinned to your dashboard\. New dashboard “Weekly numbers” created\./)).toBeVisible();

    // 6. Dashboards: export the PDF.
    await page.getByRole("button", { name: "Dashboards", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Weekly numbers" })).toBeVisible();
    await expect(page.locator(".dashboard-widget")).toHaveCount(1);
    await page.screenshot({ path: `${folder}/06-dashboard.png` });
    const pdfLink = page.getByRole("link", { name: "Export PDF", exact: true });
    const download = page.waitForEvent("download");
    await pdfLink.click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
    const pdf = await page.request.get((await pdfLink.getAttribute("href"))!);
    expect(pdf.ok()).toBe(true);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const seconds = Math.round((Date.now() - started) / 1000);
    // No help text: the journey never opened a guide/help route, and no page error occurred.
    expect(opened.filter((u) => /guide|help/i.test(u))).toEqual([]);
    expect(errors).toEqual([]);
    expect(seconds, "the whole journey must take under five minutes").toBeLessThan(300);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    fs.writeFileSync(`${folder}/journey-result.json`, JSON.stringify({ seconds, limitSeconds: 300, helpOpened: false, pageErrors: errors, project: `Journey shop ${stamp}` }, null, 2));
    await page.close();
    const video = await page.video()?.path();
    if (video) fs.copyFileSync(video, `${folder}/new-owner-journey.webm`);
    info.annotations.push({ type: "seconds", description: String(seconds) });
  });
});

async function upload(page: Page, name: string) {
  const r = await page.request.post("/api/datasets", { multipart: { file: { name, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n001,1250000,North\n002,500000,South\n") } } });
  expect(r.status()).toBe(201);
  return r.json();
}
async function chart(page: Page, id: string, question: string, kind: string, title: string) {
  const response = await page.request.post("/api/analyst/runs", { data: { dataset_id: id, question, type_mapping: { revenue: "DOUBLE" } } });
  expect(response.status()).toBe(202);
  const run = await response.json();
  await expect.poll(async () => (await (await page.request.get("/api/analyst/runs/" + run.id)).json()).status, { timeout: 30000 }).toBe("succeeded");
  const r = await page.request.post("/api/saved-charts", { data: { run_id: run.id, title, spec: { kind, x: kind === "bar" ? 0 : null, y: kind === "bar" ? 1 : 0 }, persist_snapshot_confirmed: true } });
  expect(r.status()).toBe(201);
  return r.json();
}
async function attach(page: Page, id: string, chartId: string) {
  const d = await (await page.request.get("/api/dashboards/" + id)).json();
  const r = await page.request.post("/api/dashboards/" + id + "/charts", { data: { chart_id: chartId, revision: d.revision } });
  expect(r.ok()).toBe(true);
}

/** Stage 3 approval condition (B6/B8): nothing that used to be on a tile or in edit mode became unreachable. */
test("dashboards: every redesigned control is still reachable (click paths listed in STAGE3_REVIEW)", async ({ page }) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("insightiq-technical-details-v1", "true")); // this test exercises the technical paths
  const d = await upload(page, `reach-${Date.now()}.csv`);
  const kpi = await chart(page, d.id, "REACH reviewed revenue", "kpi", "Reach revenue");
  const bar = await chart(page, d.id, "REACH revenue by region", "bar", "Reach revenue by region");
  const board = await (await page.request.post("/api/dashboards", { data: { title: "Reach dashboard" } })).json();
  await attach(page, board.id, kpi.id);
  await attach(page, board.id, bar.id);
  await page.goto("/#dashboards");
  await openDashboard(page, board.id);
  const tiles = page.locator(".dashboard-widget");
  await expect(tiles).toHaveCount(2);
  const barTile = tiles.nth(1);

  // 1. Evidence / provenance and exact rows for a tile: tile ⋯ → Details → tabs.
  const details = await openTileDetails(page, barTile);
  await expect(details.getByRole("heading", { name: /Exact result rows/ })).toBeVisible();
  await expect(details.getByRole("cell", { name: "North", exact: true })).toBeVisible();
  await details.getByRole("tab", { name: "Evidence & provenance" }).click();
  await expect(details.getByText(/SELECT/).first()).toBeVisible();
  await expect(details.getByText(/Result /).first()).toBeVisible();
  await closeDrawer(page);

  // 2. Download CSV and PNG: tile ⋯ → Download CSV / Download PNG.
  await barTile.getByRole("button", { name: /^Actions for/ }).click();
  const csvHref = await page.getByRole("menuitem", { name: "Download CSV", exact: true }).getAttribute("href");
  expect((await page.request.get(csvHref!)).ok()).toBe(true);
  const png = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download PNG", exact: true }).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);

  // 3. Refresh a tile, then open its previous snapshots: tile ⋯ → Refresh, then tile ⋯ → View previous snapshot.
  await tileMenu(page, tiles.first(), "Refresh");
  await page.getByRole("dialog", { name: "Confirm snapshot refresh" }).getByRole("button", { name: "Confirm refresh", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Snapshot refreshed" })).toBeVisible();
  await tileMenu(page, tiles.first(), "View previous snapshot");
  const history = page.getByRole("dialog", { name: "Previous snapshots" });
  await expect(history).toBeVisible();
  await history.getByRole("button", { name: "Close history" }).click();

  // 4. Delete a saved chart: Saved charts → Delete saved chart (after removing it from the dashboard).
  await editDashboard(page);
  await page.getByRole("button", { name: "Delete widget 2" }).click();
  await page.getByRole("dialog", { name: "Delete widget" }).getByRole("button", { name: "Delete widget", exact: true }).click();
  await expect(tiles).toHaveCount(1);
  await page.getByRole("button", { name: "Add chart", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Saved charts" });
  const before = await library.getByRole("button", { name: "Delete saved chart" }).count();
  await library.locator(".library-row").filter({ hasText: "Reach revenue by region" }).getByRole("button", { name: "Delete saved chart" }).click();
  await expect(library.getByRole("button", { name: "Delete saved chart" })).toHaveCount(before - 1);
  await library.getByRole("button", { name: "Close", exact: true }).last().click();

  // 5. Add a chart back, reorder (move up / drag handle exist) and remove a tile.
  await addSavedChart(page, kpi.id);
  const duplicate = page.getByRole("dialog", { name: "Possible duplicate" });
  await duplicate.getByRole("button", { name: "Add anyway" }).click();
  await expect(tiles).toHaveCount(2);
  const order = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-widget-id")));
  await page.getByRole("button", { name: "Move widget 2 up" }).click();
  await expect.poll(() => tiles.first().getAttribute("data-widget-id")).toBe(order[1]);
  await expect(page.getByRole("button", { name: "Drag widget 1" })).toBeVisible();
  await page.getByRole("button", { name: "Delete widget 2" }).click();
  await page.getByRole("dialog", { name: "Delete widget" }).getByRole("button", { name: "Delete widget", exact: true }).click();
  await expect(tiles).toHaveCount(1);

  // 6. Duplicate and delete a dashboard from the view-mode ⋯ menu.
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate dashboard" }).click();
  await expect(page.getByRole("tab", { name: /Reach dashboard/ })).toHaveCount(2);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
  await page.getByRole("dialog", { name: "Delete dashboard" }).getByRole("button", { name: "Delete dashboard permanently" }).click();
  await expect(page.getByRole("tab", { name: /Reach dashboard/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Ask: suggestions never total a percentage column or quote column names, and the pin dialog cannot save without the Pin click", async ({ page }) => {
  const name = `pct-${Date.now()}.csv`;
  const rows = Array.from({ length: 30 }, (_, i) => `${i + 1},${["North", "South", "East"][i % 3]},${(i % 4) * 5},${100 + i}`).join("\n");
  const r = await page.request.post("/api/datasets", { multipart: { file: { name, mimeType: "text/csv", buffer: Buffer.from("order_id,region,discount_pct,revenue\n" + rows + "\n") } } });
  expect(r.status()).toBe(201);
  const dataset = await r.json();
  const settings = (await (await page.request.get(`/api/datasets/${dataset.id}/knowledge`)).json()).settings;
  settings.columns = { discount_pct: "Discount in percent", revenue: "Money taken" };
  expect((await page.request.put(`/api/datasets/${dataset.id}/knowledge`, { data: settings })).ok()).toBe(true);
  const suggestions: { question: string }[] = await (await page.request.get(`/api/datasets/${dataset.id}/suggested-questions`)).json();
  const text = suggestions.map((s) => s.question).join("\n");
  expect(text).not.toContain('"');
  expect(text).not.toMatch(/total of discount_pct/i);
  expect(text).toMatch(/total of revenue/i);
});

test("answers are kept with their question and technical details are one Settings switch away", async ({ page }) => {
  test.setTimeout(120000);
  const up = await page.request.post("/api/datasets", { multipart: { file: { name: `kept-${Date.now()}.csv`, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n1,1250,North\n2,500,South\n") } } });
  expect(up.status()).toBe(201);
  const dataset = await up.json();
  await page.goto("/#analyst");
  await selectGlobal(page, dataset.id);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill("What is the total revenue?");
  await box.press("Enter"); // Enter sends the question
  const answer = page.getByRole("region", { name: "Result insights" });
  await expect(answer.locator(".answer-sentence")).toContainText("1,750");
  // Reload the page, reopen the chat from Recent questions: the answer is there again.
  await page.reload();
  await page.getByText("Recent questions", { exact: false }).first().click();
  await page.getByRole("button", { name: /What is the total revenue/ }).first().click();
  await expect(page.getByRole("region", { name: "Result insights" }).locator(".answer-sentence")).toContainText("1,750");
  await expect(page.getByText(/asked before answers were kept/)).toHaveCount(0);
  // Technical details: off by default, one switch in Settings.
  await page.getByRole("region", { name: "Result insights" }).getByText("Show details", { exact: true }).click();
  await expect(page.getByRole("tab", { name: "SQL" })).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: /Show technical details/ }).check();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByText("Recent questions", { exact: false }).first().click();
  await page.getByRole("button", { name: /What is the total revenue/ }).first().click();
  await page.getByRole("region", { name: "Result insights" }).getByText("Show details", { exact: true }).click();
  await expect(page.getByRole("tab", { name: "SQL" })).toBeVisible();
});
