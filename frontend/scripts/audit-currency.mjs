import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const stage = process.argv[2] || "before";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
});
await page.goto("http://127.0.0.1:8080");
await page.getByRole("button", { name: "Dashboards", exact: true }).click();
await page
  .getByLabel("Open dashboard")
  .selectOption("bae47ed5-b60a-4573-ac83-e77e1fdfd6d3");
const widget = page.locator(
  '[data-widget-id="df240ab8-075c-460a-bdde-0650e19c5b7e"]',
);
await widget.locator(".result-kpi strong").waitFor();
await widget.scrollIntoViewIfNeeded();
if (stage === "after") {
  await expect(widget.locator(".result-kpi strong")).toHaveText(
    "₹83,79,680.76",
  );
  await expect(
    widget.getByRole("button", { name: "Convert Currency", exact: true }),
  ).toBeEnabled();
}
const result = {
  stage,
  kpi: await widget.locator(".result-kpi strong").innerText(),
  rawTitle: await widget.locator(".result-kpi strong").getAttribute("title"),
  conversionControls: await widget
    .getByRole("button", { name: "Convert Currency", exact: true })
    .count(),
};
await widget.screenshot({ path: `../docs/currency-audit/${stage}-kpi.png` });
fs.writeFileSync(
  `../docs/currency-audit/${stage}-browser.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
await browser.close();
