import {openEvaluationSetup, goAdmin } from './ui';
import {editDashboard,openDashboardCreation,closeDrawer} from './ui';
import {openResultActions} from './ui';
import { openAdmin } from "./ui";
import { openResultData, openResultTechnical } from "./ui";
import { openAnalysisTypes } from "./ui";
import { test, expect } from "@playwright/test";
test("dashboard save, layout, filters, reload and exports", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({
    name: "phase4-dashboard-controlled.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,revenue,region\n001,10.5,North\n002,20,South\n003,5,North\n",
    ),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await openDashboardCreation(page);
  await page
    .getByLabel("New dashboard title")
    .fill("Controlled regional review");
  await page
    .getByRole("button", { name: "Create dashboard", exact: true })
    .click();
  await expect(page.getByLabel("Dashboard title", { exact: true })).toHaveValue(
    "Controlled regional review",
  );
  await page
    .getByRole("button", { name: "Ask", exact: true })
    .click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill("Total revenue by region");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "15.5", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Actual regional totals");
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByLabel("Refresh policy").selectOption("manual");
  await page
    .getByRole("combobox", { name: "Dashboard", exact: true })
    .selectOption({ label: "Controlled regional review" });
  await expect(
    page.getByText("Pinning saves up to 1,000 result rows in this project on this computer."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pinned to your dashboard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.locator(".dashboard-widget")).toHaveCount(1);
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(2);
  await editDashboard(page);
  await page
    .locator(".dashboard-widget")
    .first()
    .locator(".widget-layout > summary")
    .click();
  await page.getByLabel("Widget width 1").selectOption("12");
  await expect(page.locator(".dashboard-widget")).toHaveAttribute(
    "style",
    /span 12/,
  );
  await page.getByRole("button", { name: "Duplicate widget 1" }).click();
  await expect(page.locator(".dashboard-widget")).toHaveCount(2);
  const before = await page
    .locator(".dashboard-widget")
    .evaluateAll((elements) =>
      elements.map((e) => e.getAttribute("data-widget-id")),
    );
  await page.getByRole("button", { name: "Move widget 2 up" }).click();
  await expect
    .poll(() =>
      page.locator(".dashboard-widget").first().getAttribute("data-widget-id"),
    )
    .toBe(before[1]);
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page
    .getByRole("button", { name: "Drag widget 1", exact: true })
    .dragTo(page.locator(".widget-header").nth(1));
  await expect
    .poll(() =>
      page.locator(".dashboard-widget").first().getAttribute("data-widget-id"),
    )
    .toBe(before[0]);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const filter = page.getByRole("dialog", { name: "Filters" }).locator(".filter-editor").first();
  await filter.locator("summary").click();
  await filter.getByLabel("Result column").fill("region");
  await filter.getByLabel("Values, separated by commas").fill("North");
  await filter.getByRole("button", { name: "Apply filter" }).click();
  await closeDrawer(page);
  await expect(
    page
      .locator(".dashboard-widget")
      .first()
      .locator(".recharts-bar-rectangle"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const pdf = await page.request.get(
    (await page.getByRole("link", { name: "Export PDF", exact: true })
      .getAttribute("href"))!,
  );
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.locator(".dashboard-widget").first().getByRole("button", { name: /^Actions for/ }).click();
  const csv = await page.request.get(
    (await page
      .getByRole("menuitem", { name: "Download CSV", exact: true })
      .getAttribute("href"))!,
  );
  await page.keyboard.press("Escape");
  expect(await csv.text()).toContain("North,15.5");
  expect(await csv.text()).not.toContain("South");
  const download = page.waitForEvent("download");
  await page.locator(".dashboard-widget").first().getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Download PNG", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.reload();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.locator(".dashboard-widget")).toHaveCount(2);
  await expect(
    page
      .locator(".dashboard-widget")
      .first()
      .locator(".recharts-bar-rectangle"),
  ).toHaveCount(1);
  await editDashboard(page);
  await expect(page.getByLabel("Widget width 1")).toHaveValue("12");
  await page.screenshot({
    path: "test-results/phase4-dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/phase4-dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("controlled evaluation verifies references and records actual comparisons", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#datasets");
  await openAdmin(page);
  await goAdmin(page,"Accuracy check");
  await openEvaluationSetup(page);await page.getByText("Setup and verification", { exact: true }).click();
  await page
    .getByRole("button", {
      name: /^(Install controlled benchmark|Check installation)$/,
    })
    .click();
  await expect(
    page.getByText(
      "Controlled benchmark explicitly installed. Uploaded datasets are not assumed compatible.",
    ),
  ).toBeVisible();
  const benchmarkOverride = page.getByRole("button", {
    name: "Use benchmark for this page only",
  });
  if (await benchmarkOverride.count()) await benchmarkOverride.click();
  await expect(
    page.getByRole("button", { name: "Verify benchmark references" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Verify benchmark references" })
    .click();
  await expect(
    page.getByText("45 / 45 verified · 0 pending", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByText("0 new LLM calls", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByLabel(
      "I authorize paid provider calls within these displayed limits.",
    ),
  ).toHaveCount(0);
  const offlineAccepted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/evaluations/offline") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Start offline replay", exact: true })
    .click();
  const offlineId = (await (await offlineAccepted).json()).id;
  await expect(
    page.locator(`a[href="/api/evaluations/${offlineId}/report.json"]`),
  ).toHaveCount(1);
  await expect(page.getByLabel("Current evaluation state")).toHaveText(
    "completed",
    { timeout: 30000 },
  );
  await page
    .getByText("Detailed diagnostics and exports", { exact: true })
    .click();
  const missing = page.getByRole("region", {
    name: "Offline evaluation results",
    exact: true,
  });
  await expect(missing.getByRole("status")).toContainText(/^completed ·/, {
    timeout: 30000,
  });
  const missingResponse = await page.request.get(
    (await missing
      .getByRole("link", { name: "Export offline JSON report" })
      .getAttribute("href"))!,
  );
  const missingReport = await missingResponse.json();
  expect(missingReport.provider_calls).toBe(0);
  expect(missingReport.metrics.accuracy).toBeNull();
  expect(missingReport.metrics.missing_predictions).toBe(45);
  expect(
    missingReport.results.every(
      (r: { run: unknown; correct: unknown }) =>
        r.run === null && r.correct === null,
    ),
  ).toBe(true);
  await openEvaluationSetup(page);await page.getByLabel("Evaluation mode").selectOption("paid");
  await expect(
    page.getByRole("button", { name: "Run evaluation", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "I authorize paid provider calls within these displayed limits.",
    )
    .check();
  const liveAccepted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/evaluations") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run evaluation", exact: true })
    .click();
  const liveId = (await (await liveAccepted).json()).id;
  await expect(
    page.locator(`a[href="/api/evaluations/${liveId}/report.json"]`),
  ).toHaveCount(1);
  await expect(page.getByLabel("Current evaluation state")).toHaveText(
    "completed",
    { timeout: 30000 },
  );
  await page
    .getByText("Detailed diagnostics and exports", { exact: true })
    .click();
  const results = page.getByRole("region", {
    name: "Evaluation results",
    exact: true,
  });
  await expect(results.getByRole("status")).toContainText(/^completed ·/, {
    timeout: 30000,
  });
  await expect(results).toContainText("50.0%");
  await results
    .locator(".evaluation-case-result")
    .first()
    .locator("summary")
    .first()
    .click();
  await expect(results).toContainText("Alias-only contract mismatch");
  await expect(results).toContainText("Strict correctness remains failed");
  await expect(results).toContainText("50.0% · 1 / 2 evaluated predictions");
  await expect(
    results.getByRole("cell", { name: "8", exact: true }).first(),
  ).toBeVisible();
  const json = await page.request.get(
    (await results
      .getByRole("link", { name: "Export JSON report" })
      .getAttribute("href"))!,
  );
  const report = await json.json();
  expect(report.results).toHaveLength(2);
  expect(report.metrics.accuracy).toBe(0.5);
  expect(report.provider_calls).toBe(2);
  expect(report.results.map((r: { correct: boolean }) => r.correct)).toEqual([
    false,
    true,
  ]);
  expect(report.results[0].comparison_details.alias_only_mismatch).toBe(true);
  expect(report.results[0].run.prompt_version).toBe("sql-grounding-v4");
  expect(report.results[0].run.attempt_history).toHaveLength(1);
  expect(report.results[0].run.activity_kind).toBe("evaluation");
  await page.screenshot({
    path: "test-results/phase4-evaluation-desktop.png",
    fullPage: true,
  });
  await openEvaluationSetup(page);await page.getByLabel("Evaluation mode").selectOption("offline");
  const replayAccepted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/evaluations/offline") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Start offline replay", exact: true })
    .click();
  const replayId = (await (await replayAccepted).json()).id;
  await expect(
    page.locator(`a[href="/api/evaluations/${replayId}/report.json"]`),
  ).toHaveCount(1);
  await expect(page.getByLabel("Current evaluation state")).toHaveText(
    "completed",
    { timeout: 30000 },
  );
  await page
    .getByText("Detailed diagnostics and exports", { exact: true })
    .click();
  const offline = page.getByRole("region", {
    name: "Offline evaluation results",
    exact: true,
  });
  await expect(offline.getByRole("status")).toContainText(/^completed ·/, {
    timeout: 30000,
  });
  const replayResponse = await page.request.get(
    (await offline
      .getByRole("link", { name: "Export offline JSON report" })
      .getAttribute("href"))!,
  );
  const replay = await replayResponse.json();
  expect(replay.provider_calls).toBe(0);
  expect(replay.metrics.evaluated_count).toBe(2);
  expect(replay.metrics.correct_count).toBe(1);
  expect(replay.metrics.incorrect_count).toBe(1);
  expect(replay.metrics.missing_predictions).toBe(43);
  expect(replay.metrics.accuracy).toBe(0.5);
  expect(
    replay.results.filter((r: { correct: unknown }) => r.correct === null),
  ).toHaveLength(43);
  await expect(
    offline.getByText("0 new LLM calls", { exact: true }),
  ).toBeVisible();
  await expect(
    offline
      .getByRole("cell", {
        name: "Not evaluated — no saved prediction",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await offline.getByLabel("Filter question results").selectOption("incorrect");
  await expect(offline.locator("tbody tr")).toHaveCount(1);
  await expect(offline.locator("tbody tr")).toContainText("q05");
  await offline
    .getByText("Saved prediction and trace", { exact: true })
    .click();
  await expect(offline.getByText(/Alias-only contract mismatch/)).toBeVisible();
  await offline.getByLabel("Filter question results").selectOption("correct");
  await expect(offline.locator("tbody tr")).toHaveCount(1);
  await expect(offline.locator("tbody tr")).toContainText("q06");
  await offline
    .getByLabel("Filter question results")
    .selectOption("unevaluated");
  await expect(offline.locator("tbody tr")).toHaveCount(43);
  await offline.getByLabel("Filter question results").selectOption("all");
  await page.screenshot({
    path: "test-results/offline-evaluation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/offline-evaluation-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await openAdmin(page);
  await goAdmin(page,"Accuracy check");
  await expect(
    page.getByRole("button", { name: "Inspect run" }).first(),
  ).toBeVisible();
  await openAdmin(page);
  await goAdmin(page,"Execution traces");
  await expect(
    page.getByRole("heading", { name: /Execution traces/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Run history", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Your question", exact: true }),
  ).toHaveCount(0);
  await page.locator(".trace-history .trace-run").first().click();
  await expect(
    page.getByRole("region", { name: "Run trace details" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/execution-traces-desktop.png",
    fullPage: true,
  });
  await openAdmin(page);
  await goAdmin(page,"Performance & errors");
  await expect(
    page.getByRole("heading", { name: "Performance & errors" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
