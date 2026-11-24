import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1600 },
  reducedMotion: "reduce",
});
await page.goto("http://127.0.0.1:8080");
await page.getByRole("button", { name: "Dashboards", exact: true }).click();
await page
  .getByLabel("Open dashboard")
  .selectOption("bae47ed5-b60a-4573-ac83-e77e1fdfd6d3");
const bar = page.locator(
  '[data-widget-id="cb5cb777-f777-4f48-bf74-5a9edcd8f638"]',
);
await bar
  .getByRole("button", { name: "Convert Currency", exact: true })
  .click();
await bar.getByLabel("Target currency").selectOption("USD");
const response = page.waitForResponse(
  (r) =>
    r.url().endsWith("/api/currency/convert") &&
    r.request().method() === "POST",
);
await bar
  .getByRole("button", { name: "Apply conversion", exact: true })
  .click();
const conversion = await response;
expect(conversion.ok()).toBe(true);
const quote = await conversion.json();
const view = await (
  await page.request.get(
    "http://127.0.0.1:8080/api/dashboards/bae47ed5-b60a-4573-ac83-e77e1fdfd6d3",
  )
).json();
const amount = view.widgets.find(
  (w) => w.id === "cb5cb777-f777-4f48-bf74-5a9edcd8f638",
).result.rows[0][1];
const oracle = await (
  await page.request.post("http://127.0.0.1:8080/api/currency/convert", {
    data: {
      source_currency: "INR",
      target_currency: "USD",
      amounts: [String(amount)],
    },
  })
).json();
expect(oracle.fetched_at).toBe(quote.fetched_at);
const expected = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
}).format(oracle.converted_amounts[0]);
await expect(bar.locator(".recharts-yAxis-tick-labels")).toContainText("$");
await bar.scrollIntoViewIfNeeded();
await bar.locator(".recharts-bar-rectangle path").first().hover();
const tooltip = bar.locator(".recharts-tooltip-wrapper");
await expect(tooltip).toBeVisible();
await expect(tooltip).toContainText(expected);
await tooltip.screenshot({
  path: "../docs/currency-audit/live-chart-tooltip.png",
});
fs.writeFileSync(
  "../docs/currency-audit/tooltip-verification.json",
  JSON.stringify(
    {
      visible: true,
      text: await tooltip.innerText(),
      note: "Real INR/USD provider quote, same cached rate used by the verified chart/table.",
    },
    null,
    2,
  ),
);
console.log("VISIBLE TOOLTIP", await tooltip.innerText());
await browser.close();
