import { knowledgeTab } from "./ui";
import {openResultActions} from './ui';
import {openAdmin} from './ui';
import {openResultData,openResultTechnical,openResultSql,openResultCalculation} from "./ui";
import { openAnalysisTypes } from "./ui";
import { expect, test } from "@playwright/test";
test("controlled provider boundary, real typed aggregation, history and CSV export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({
    name: "controlled-analyst-fixture.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,revenue,order_date\n001,10.5,2026-01-02\n002,20,2026-02-03\n003,bad,invalid\n004,,\n",
    ),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ask your data" }),
  ).toBeVisible();
  await openAnalysisTypes(page);
  await page
    .getByRole("combobox", { name: "Analysis type for revenue" })
    .selectOption("DOUBLE");
  await expect(
    page.getByText(/1 missing · 1 failed conversions/).first(),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill("What is the total revenue?");
  await page.getByRole("button", { name: "Analyze" }).click();
  await openResultData(page);
  await expect(
    page.getByText("Your total revenue is 30.5.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "30.5", exact: true }),
  ).toBeVisible();
  await openResultSql(page);
  await expect(page.locator(".sql-viewer pre")).toContainText("SELECT");
  await openResultData(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("insightiq-result.csv");
  const runId = await page
    .getByRole("link", { name: "Download CSV" })
    .getAttribute("href");
  const csv = await page.request.get(runId!);
  expect(await csv.text()).toBe("total_revenue\r\n30.5\r\n");
  await openResultData(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/analyst-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page
    .getByRole("button", { name: /What is the total revenue\?/ })
    .click();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "30.5", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/analyst-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("RAG, live graph repair, actual Recharts, evidence and verified example lifecycle", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const streams: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/events")) streams.push(response.url());
  });
  await page.goto("/#datasets");
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles({
      name: "phase3-controlled-fixture.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "id,revenue,region\n001,10.5,North\n002,20,South\n003,5,North\n",
      ),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await openAdmin(page);await page
    .getByRole("button", { name: "Business definitions", exact: true })
    .click();
  await page
    .getByLabel("Dataset description")
    .fill("Retail sales by sales region.");
  await page
    .getByRole("button", { name: "Save definitions", exact: true })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Definitions saved" })).toBeVisible();
  await knowledgeTab(page, "Advanced"); // What Ask can find lives under the Advanced disclosure
  await page.getByLabel("Question", { exact: true }).fill("revenue by region");
  await page
    .getByRole("button", { name: "Show what Ask would use", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "What Ask would use" })
    .click();
  await expect(page.locator(".retrieved-document").first()).toBeVisible();
  await expect(page.locator(".retrieved-document").first()).toContainText(
    "Rank",
  );
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page
    .getByRole("combobox", { name: "Analysis type for revenue" })
    .selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill("Retry total revenue by region");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await openResultTechnical(page);
  await expect(page.getByText("Attempt 2 / 3", { exact: true })).toBeVisible();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "15.5", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle")).toHaveCount(2);
  await expect(page.getByLabel("Visualization type")).toHaveValue("bar");
  await page.getByLabel("Visualization type").selectOption("donut");
  await expect(page.locator(".recharts-pie-sector")).toHaveCount(2);
  await page.getByLabel("Visualization type").selectOption("bar");
  await openResultTechnical(page);
  await page.locator("summary").filter({ hasText: "Agent workflow" }).click();
  await expect(page.locator(".workflow-events")).toContainText(
    "recoverable SQL failure",
  );
  await expect(page.locator(".workflow-events")).toContainText("rejected");
  await expect(page.locator(".evidence-fact").filter({hasText:"total_revenue: total = 35.5"})).toBeVisible();
  await openResultActions(page);await expect(page.getByRole("menuitem",{name:"Propose as verified example"})).toBeVisible();await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"Verify & save SQL example"})).toHaveCount(0);
  await openResultData(page);
  await openResultCalculation(page);
  expect(streams.length).toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/phase3-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/phase3-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
