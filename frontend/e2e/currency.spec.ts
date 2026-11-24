import {openResultActions} from './ui';
import {openTileDetails,closeDrawer} from './ui';
import {openAdmin} from './ui';
import {openResultData,openResultTechnical} from "./ui";
import { openAnalysisTypes, openSourceCurrencies } from "./ui";
import { expect, test } from "@playwright/test";
test("confirmed INR revenue converts with test-only rates and resets; counts have no currency control", async ({
  page,
}) => {
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({
    name: "currency-retail.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,revenue,region\n1,1250000,North\n2,0,South\n"),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await openAdmin(page);await page
    .getByRole("button", { name: "Business definitions", exact: true })
    .click();
  await openSourceCurrencies(page);
  await page
    .getByLabel("Currency for revenue", { exact: true })
    .selectOption("INR");
  await page
    .getByRole("button", { name: "Save definitions", exact: true })
    .click();
  const impact=page.getByRole('dialog',{name:'Currency dependency impact'});
  await impact.getByRole('checkbox').check();
  await impact.getByRole('button',{name:'Save confirmed change'}).click();
  await expect(page.getByRole("status")).toContainText("Definitions saved");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill("What is the total revenue?");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "₹12,50,000.00", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-kpi strong")).toHaveText("₹12,50,000.00");
  const originalUrl = await page
    .getByRole("link", { name: "Download CSV", exact: true })
    .getAttribute("href");
  const original = await (await page.request.get(originalUrl!)).text();
  await page
    .getByRole("button", { name: "Convert Currency", exact: true })
    .click();
  await page.getByLabel("Target currency").selectOption("USD");
  await page
    .getByRole("button", { name: "Apply conversion", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "$15,625.00", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-kpi strong")).toHaveText("$15,625.00");
  await expect(page.locator(".currency-controls")).toContainText(
    "1 INR = 0.0125 USD",
  );
  await expect(page.locator(".currency-controls")).toContainText(
    "Frankfurter daily reference",
  );
  const convertedUrl = await page
    .getByRole("link", {
      name: "Export converted CSV (original columns retained)",
    })
    .getAttribute("href");
  const converted = await (await page.request.get(convertedUrl!)).text();
  expect(converted).toContain("total_revenue__converted_USD");
  expect(converted).toContain("1250000.0,15625.00000,INR,0.0125");
  await page.getByLabel("Target currency").selectOption("EUR");
  await page
    .getByRole("button", { name: "Apply conversion", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "€12,500.00", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset to Original Currency", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "₹12,50,000.00", exact: true }),
  ).toBeVisible();
  expect(await (await page.request.get(originalUrl!)).text()).toBe(original);
  await page.request.post("/api/dashboards", {
    data: { title: "Currency dashboard", description: "" },
  });
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Monetary KPI");
  await page
    .getByRole("combobox", { name: "Dashboard", exact: true })
    .selectOption({ label: "Currency dashboard" });
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pinned to your dashboard" }),
  ).toBeVisible();
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill("How many orders are there?");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert Currency", exact: true }),
  ).toHaveCount(0);
});

test("saved monetary bar charts convert axes and reports without changing snapshots", async ({
  page,
}) => {
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({
    name: "currency-chart.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,revenue,region\n1,1250000,North\n2,500000,South\n"),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await openAdmin(page);await page
    .getByRole("button", { name: "Business definitions", exact: true })
    .click();
  await openSourceCurrencies(page);
  await page
    .getByLabel("Currency for revenue", { exact: true })
    .selectOption("INR");
  await page
    .getByRole("button", { name: "Save definitions", exact: true })
    .click();
  const impact=page.getByRole('dialog',{name:'Currency dependency impact'});
  await impact.getByRole('checkbox').check();
  await impact.getByRole('button',{name:'Save confirmed change'}).click();
  await expect(page.getByRole("status")).toContainText("Definitions saved");
  await page.request.post("/api/dashboards", {
    data: { title: "Currency charts review", description: "" },
  });
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill("Total revenue by region");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "₹12,50,000.00", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recharts-yAxis-tick-labels")).toContainText("₹");
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Regional money");
  await page
    .getByRole("combobox", { name: "Dashboard", exact: true })
    .selectOption({ label: "Currency charts review" });
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pinned to your dashboard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  const widget = page.locator(".dashboard-widget");
  await expect(widget.locator(".recharts-bar-rectangle")).toHaveCount(2);
  await widget.getByRole("button", { name: /^Actions for/ }).click();
  const rawUrl = await page
    .getByRole("menuitem", { name: "Download CSV", exact: true })
    .getAttribute("href");
  await page.keyboard.press("Escape");
  const raw = await (await page.request.get(rawUrl!)).text();
  await widget
    .getByRole("button", { name: "Convert Currency", exact: true })
    .click();
  await widget.getByLabel("Target currency").selectOption("USD");
  await widget
    .getByRole("button", { name: "Apply conversion", exact: true })
    .click();
  await expect(widget.locator(".recharts-yAxis-tick-labels")).toContainText(
    "$",
  );
  const detail = await openTileDetails(page, widget);
  await expect(
    detail.getByRole("cell", { name: "$15,625.00", exact: true }),
  ).toBeVisible();
  await closeDrawer(page);
  expect(await (await page.request.get(rawUrl!)).text()).toBe(raw);
  await page.getByLabel("Report currency", { exact: true }).selectOption("USD");
  const pdfUrl = await page.getByRole("link", { name: "Export PDF" }).getAttribute("href");
  const jsonUrl = pdfUrl!.split("?")[0].replace("report.pdf", "report.json");      // the page no longer offers JSON export; the API route is unchanged
  const report = await (await page.request.get(jsonUrl)).json();
  expect(report.widgets[0].result.rows[0][1]).toBe(1250000);
  await expect(page.locator(".dashboard-currency")).toContainText("0.0125");
  expect(report.widgets[0].result.columns[1].money.currency).toBe("INR");
  const pdf = await page.request.get(
    (await page.getByRole("link", { name: "Export PDF", exact: true })
      .getAttribute("href"))!,
  );
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.keyboard.press("Escape");
  await page.getByLabel("Report currency",{exact:true}).selectOption("");
  const reset = await openTileDetails(page, widget);
  await expect(
    reset.getByRole("cell", { name: "₹12,50,000.00", exact: true }),
  ).toBeVisible();
  await closeDrawer(page);
});
