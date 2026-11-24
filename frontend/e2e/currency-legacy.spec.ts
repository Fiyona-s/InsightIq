import { editDashboard, openDashboard } from "./ui";
import {openTileDetails,closeDrawer} from './ui';
import {openResultActions} from './ui';
import {openResultData,openResultTechnical} from "./ui";
import { expect, test } from "@playwright/test";
import { openAnalysisTypes } from "./ui";
test("legacy recognized-revenue KPI gains confirmed INR metadata without rewriting its snapshot", async ({
  page,
}) => {
  await page.goto("/#datasets");
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles({
      name: "LEGACY-CURRENCY-TEST.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,revenue,region\n001,8379680.76,Retail\n"),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  const dash = await (
    await page.request.post("/api/dashboards", {
      data: { title: "Legacy currency audit", description: "" },
    })
  ).json();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page
    .getByRole('textbox',{name:'Your question',exact:true})
    .fill("Legacy recognized revenue audit");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(page.locator(".result-kpi strong")).toHaveText("8,379,680.76");
  await expect(
    page.getByRole("button", { name: "Convert Currency", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Recognized Revenue");
  await page.getByRole("combobox", { name: "Dashboard", exact: true }).selectOption(dash.id);
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pinned to your dashboard" }),
  ).toBeVisible();
  const view = await (
    await page.request.get("/api/dashboards/" + dash.id)
  ).json();
  const chartId = view.widgets[0].chart_id;
  const raw = await (
    await page.request.get("/api/saved-charts/" + chartId)
  ).json();
  const datasetId = raw.dataset_id;
  const datasetCsv = await (
    await page.request.get("/api/datasets/" + datasetId + "/export")
  ).text();
  const knowledge = await (
    await page.request.get("/api/datasets/" + datasetId + "/knowledge")
  ).json();
  knowledge.settings.metrics = [
    {
      name: "Recognized revenue",
      description: "Confirmed INR recognized revenue.",
      sql: "SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data",
      money: { currency: "INR" },
    },
  ];
  expect(
    (
      await page.request.put("/api/datasets/" + datasetId + "/knowledge", {
        data: knowledge.settings,
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await openDashboard(page,dash.id);
  const widget = page.locator(".dashboard-widget");
  await editDashboard(page);
  await widget
    .getByRole("button", { name: "Apply confirmed currencies", exact: true })
    .click();
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  await expect(widget.locator(".result-kpi")).toContainText("INR");
  await page.reload();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await openDashboard(page,dash.id);
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  await widget
    .getByRole("button", { name: "Convert Currency", exact: true })
    .click();
  await widget.getByLabel("Target currency").selectOption("USD");
  await widget
    .getByRole("button", { name: "Apply conversion", exact: true })
    .click();
  await expect(widget.locator(".result-kpi strong")).toHaveText("$104,746.01");
  await expect(widget.locator(".currency-controls")).toContainText(
    "1 INR = 0.0125 USD",
  );
  await widget.getByLabel("Target currency").selectOption("EUR");
  await widget
    .getByRole("button", { name: "Apply conversion", exact: true })
    .click();
  await expect(widget.locator(".result-kpi strong")).toHaveText("€83,796.81");
  await widget
    .getByRole("button", { name: "Reset to Original Currency", exact: true })
    .click();
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  const after = await (
    await page.request.get("/api/saved-charts/" + chartId)
  ).json();
  expect(after.snapshot).toEqual(raw.snapshot);
  expect(after.sql).toBe(raw.sql);
  expect(after.currency_metadata["0"].currency).toBe("INR");
  expect(
    await (
      await page.request.get("/api/datasets/" + datasetId + "/export")
    ).text(),
  ).toBe(datasetCsv);
  const detail = await openTileDetails(page, widget);
  await expect(
    detail.getByRole("cell", { name: "₹83,79,680.76", exact: true }),
  ).toBeVisible();
  await closeDrawer(page);
  // Future Analyst runs receive the same confirmed metadata; old run values remain untouched.
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page
    .getByRole('textbox',{name:'Your question',exact:true})
    .fill("Legacy recognized revenue audit");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(page.locator(".result-kpi strong")).toHaveText("₹83,79,680.76");
  await expect(
    page.getByRole("button", { name: "Convert Currency", exact: true }),
  ).toBeEnabled();
});
