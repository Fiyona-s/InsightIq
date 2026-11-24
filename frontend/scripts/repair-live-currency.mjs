// Explicit local repair and verification for the audited existing retail dashboard.
// No mocked responses or exchange rates are used by this script.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
if (!process.argv.includes("--apply-confirmed-inr"))
  throw new Error(
    "Use --apply-confirmed-inr only after verifying the retail definitions.",
  );
const base = "http://127.0.0.1:8080";
const datasetId = "4d7cb8c8-9300-401f-a864-b29f89920559";
const dashboardId = "bae47ed5-b60a-4573-ac83-e77e1fdfd6d3";
const kpiId = "df240ab8-075c-460a-bdde-0650e19c5b7e";
const barId = "cb5cb777-f777-4f48-bf74-5a9edcd8f638";
const folder = "../docs/currency-audit";
fs.mkdirSync(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(15000);
const report = {
  base,
  verified_at: new Date().toISOString(),
  quotes: [],
  analyst: [],
};
async function get(path) {
  const r = await page.request.get(base + "/api" + path);
  expect(r.ok(), path).toBe(true);
  return r.json();
}
async function screenshot(widget, name) {
  await widget.scrollIntoViewIfNeeded();
  await widget.screenshot({ path: folder + "/" + name + ".png" });
}
async function apply(widget, target, amount) {
  if (!(await widget.getByLabel("Target currency").isVisible()))
    await widget
      .getByRole("button", { name: "Convert Currency", exact: true })
      .click();
  await widget.getByLabel("Target currency").selectOption(target);
  let quote;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/currency/convert") &&
        r.request().method() === "POST",
    );
    await widget
      .getByRole("button", { name: "Apply conversion", exact: true })
      .click();
    const r = await response;
    if (r.ok()) {
      quote = await r.json();
      break;
    }
    expect(r.status()).toBe(503);
    await expect(widget.locator(".result-kpi strong")).toHaveText(
      "₹83,79,680.76",
    );
    await screenshot(widget, "live-provider-outage");
    if (attempt === 1)
      throw new Error(
        "Live provider unavailable after a safe retry; no conversion claimed.",
      );
    console.log(
      "Provider temporarily unavailable; original INR retained. Waiting for safe retry.",
    );
    await page.waitForTimeout(31000);
    await widget
      .getByRole("button", { name: "Retry rate service", exact: true })
      .click();
    await expect(
      widget.getByRole("button", { name: "Apply conversion", exact: true }),
    ).toBeEnabled();
  }
  expect(quote.source_currency).toBe("INR");
  expect(quote.target_currency).toBe(target);
  expect(Number(quote.rate)).toBeGreaterThan(0);
  // Independent server Decimal oracle. Amount stays on localhost; the FX adapter sends pair/date only.
  const oracleResponse = await page.request.post(
    base + "/api/currency/convert",
    {
      data: {
        source_currency: "INR",
        target_currency: target,
        amounts: [String(amount)],
      },
    },
  );
  expect(oracleResponse.ok()).toBe(true);
  const oracle = await oracleResponse.json();
  expect(oracle.rate).toBe(quote.rate);
  expect(oracle.fetched_at).toBe(quote.fetched_at);
  const expected = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: target,
  }).format(oracle.converted_amounts[0]);
  await expect(widget.locator(".currency-controls")).toContainText(
    `1 INR = ${quote.rate} ${target}`,
  );
  await expect(widget.locator(".currency-controls")).toContainText(
    quote.effective_date,
  );
  await expect(widget.locator(".currency-controls")).toContainText(
    quote.rate_source,
  );
  report.quotes.push({
    ...quote,
    original_value: String(amount),
    expected_display: expected,
  });
  return expected;
}
try {
  await page.goto(base);
  const knowledge = await get("/datasets/" + datasetId + "/knowledge");
  expect(knowledge.settings.columns.net_revenue_inr).toContain(
    "revenue in INR",
  );
  expect(knowledge.settings.columns.unit_price_inr).toContain("in INR");
  for (const name of ["net_revenue_inr", "unit_price_inr"])
    expect([undefined, null, "INR"]).toContain(
      knowledge.settings.monetary_columns[name]?.currency,
    );
  report.currency_basis = {
    dataset_id: datasetId,
    description: knowledge.settings.description,
    column_definition: knowledge.settings.columns.net_revenue_inr,
  };
  await page
    .getByRole("button", { name: "Knowledge base", exact: true })
    .click();
  await page.locator(".knowledge-selector select").selectOption(datasetId);
  await expect(page.getByLabel("Dataset description")).toHaveValue(
    knowledge.settings.description,
  );
  await page.locator(".currency-settings > summary").click();
  for (const name of ["net_revenue_inr", "unit_price_inr"])
    await page
      .getByLabel("Currency for " + name, { exact: true })
      .selectOption("INR");
  await page
    .getByLabel("Metric 1 currency", { exact: true })
    .selectOption("INR");
  await page
    .getByRole("button", { name: "Save knowledge", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Knowledge saved");
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await page.getByLabel("Open dashboard").selectOption(dashboardId);
  for (const id of [kpiId, barId]) {
    const w = page.locator(`[data-widget-id="${id}"]`);
    const button = w.getByRole("button", {
      name: "Apply confirmed currencies",
      exact: true,
    });
    const currentWidget = (
      await get("/dashboards/" + dashboardId)
    ).widgets.find((w) => w.id === id);
    if (currentWidget.currency_metadata_available) {
      await expect(button).toBeVisible();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/currency-metadata") &&
          r.request().method() === "POST",
      );
      await button.click();
      const r = await response;
      expect(r.ok()).toBe(true);
      await expect(button).toHaveCount(0);
    }
  }
  const widget = page.locator(`[data-widget-id="${kpiId}"]`);
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  await expect(widget.locator(".result-kpi")).toContainText(
    "Recognized Revenue",
  );
  await expect(widget.locator(".result-kpi")).toContainText("INR");
  await expect(
    widget.getByRole("button", { name: "Convert Currency", exact: true }),
  ).toBeEnabled();
  await screenshot(widget, "after-inr-kpi");
  const view = await get("/dashboards/" + dashboardId);
  const source = view.widgets.find((w) => w.id === kpiId);
  const original = source.result.rows[0][0];
  report.original_value = String(original);
  const csvUrl = `/api/dashboards/${dashboardId}/widgets/${kpiId}/results.csv`;
  const originalCsv = await (await page.request.get(base + csvUrl)).text();
  let expected = await apply(widget, "USD", original);
  await expect(widget.locator(".result-kpi strong")).toHaveText(expected);
  report.usd_display = expected;
  await screenshot(widget, "after-usd-conversion");
  expected = await apply(widget, "EUR", original);
  await expect(widget.locator(".result-kpi strong")).toHaveText(expected);
  report.eur_display = expected;
  await screenshot(widget, "after-eur-conversion");
  await widget
    .getByRole("button", { name: "Reset to Original Currency", exact: true })
    .click();
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  await widget
    .locator("summary")
    .filter({ hasText: "Exact result rows" })
    .click();
  await expect(
    widget.getByRole("cell", { name: "₹83,79,680.76", exact: true }),
  ).toBeVisible();
  await screenshot(widget, "after-reset-table");
  expect(await (await page.request.get(base + csvUrl)).text()).toBe(
    originalCsv,
  );
  const bar = page.locator(`[data-widget-id="${barId}"]`);
  await expect(bar.locator(".recharts-yAxis-tick-labels")).toContainText("₹");
  const barData = view.widgets.find((w) => w.id === barId);
  const barValue = barData.result.rows[0][1];
  expected = await apply(bar, "USD", barValue);
  await expect(bar.locator(".recharts-yAxis-tick-labels")).toContainText("$");
  await bar.locator("summary").filter({ hasText: "Exact result rows" }).click();
  await expect(
    bar.getByRole("cell", { name: expected, exact: true }),
  ).toBeVisible();
  await bar.locator(".recharts-bar-rectangle").first().hover();
  await expect(bar.locator(".recharts-tooltip-wrapper")).toContainText(
    expected,
  );
  await screenshot(bar, "after-chart-table-tooltip");
  await bar
    .getByRole("button", { name: "Reset to Original Currency", exact: true })
    .click();
  const convertedCsv = await page.request.get(
    base + csvUrl + "?target_currency=USD",
  );
  expect(convertedCsv.ok()).toBe(true);
  expect(await convertedCsv.text()).toContain(
    "total_recognized_revenue_inr__converted_USD",
  );
  await page.getByLabel("Report currency", { exact: true }).selectOption("USD");
  const reportJson = await (
    await page.request.get(
      base +
        (await page
          .getByRole("link", { name: "JSON", exact: true })
          .getAttribute("href")),
    )
  ).json();
  const reportKpi = reportJson.widgets.find((w) => w.id === kpiId);
  expect(reportKpi.original_result.rows[0][0]).toBe(original);
  expect(reportKpi.currency_conversion[0].rate).toBe(report.quotes[0].rate);
  const pdf = await page.request.get(
    base +
      (await page
        .getByRole("link", { name: "PDF report", exact: true })
        .getAttribute("href")),
  );
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  report.exports = {
    raw_csv_unchanged: true,
    converted_csv: true,
    json_retains_original: true,
    pdf: true,
  };
  await page.reload();
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await page.getByLabel("Open dashboard").selectOption(dashboardId);
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  await expect(
    widget.getByRole("button", { name: "Convert Currency", exact: true }),
  ).toBeEnabled();
  await screenshot(widget, "after-reload-kpi");
  report.reload_display = "₹83,79,680.76";
  console.log(
    "LIVE DASHBOARD VERIFIED",
    JSON.stringify({
      inr: report.reload_display,
      usd: report.usd_display,
      eur: report.eur_display,
      exports: report.exports,
    }),
  );
  if (process.argv.includes("--verify-analyst")) {
    await page.getByRole("button", { name: "AI Analyst", exact: true }).click();
    await page
      .getByLabel("Analyze dataset", { exact: true })
      .selectOption(datasetId);
    const types = page.locator("details.type-settings");
    const revenueType = page.getByLabel("Analysis type for net_revenue_inr", {
      exact: true,
    });
    await revenueType.waitFor({ state: "attached" });
    if (!(await types.evaluate((el) => el.open)))
      await types.locator("summary").click();
    await revenueType.selectOption("DOUBLE");
    await page.getByRole("checkbox").check();
    for (const question of [
      "What is the total recognized revenue? Sum net_revenue_inr and use the alias total_recognized_revenue_inr.",
      "How many orders are there?",
    ]) {
      await page.getByLabel("Ask your data").fill(question);
      const accepted = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/analyst/runs") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Ask Analyst", exact: true })
        .click();
      const run = await (await accepted).json();
      await expect
        .poll(async () => (await get("/analyst/runs/" + run.id)).status, {
          timeout: 60000,
        })
        .toMatch(/^(succeeded|failed|clarification|cancelled)$/);
      const completed = await get("/analyst/runs/" + run.id);
      report.analyst.push(completed);
      if (completed.status !== "succeeded") {
        await page.screenshot({
          path: folder + "/live-analyst-unavailable.png",
          fullPage: true,
        });
        console.log("LIVE ANALYST", completed.status, completed.error);
        break;
      }
      const monetary = question.startsWith("What");
      await expect(page.locator(".result-kpi strong")).toHaveText(
        monetary ? "₹83,79,680.76" : "2,400",
      );
      await expect(
        page.getByRole("button", { name: "Convert Currency", exact: true }),
      ).toHaveCount(monetary ? 1 : 0);
      await page.locator(".response-body").screenshot({
        path:
          folder +
          (monetary ? "/live-analyst-inr.png" : "/live-analyst-count.png"),
      });
      console.log(
        "LIVE ANALYST VERIFIED",
        completed.id,
        monetary ? "INR" : "count without currency",
      );
    }
  }
  report.success = true;
} catch (error) {
  report.error = String(error);
  console.error(error);
  process.exitCode = 1;
  await page
    .screenshot({
      path: folder + "/live-verification-error.png",
      fullPage: true,
    })
    .catch(() => {});
} finally {
  fs.writeFileSync(
    folder + "/live-verification.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
