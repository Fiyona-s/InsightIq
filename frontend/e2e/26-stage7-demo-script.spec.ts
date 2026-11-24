import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { goAdmin } from "./ui";

/**
 * Stage 7: the 5-minute demo script in docs/DEMO_WALKTHROUGH.md, followed click by click on throwaway data with the
 * controlled stand-in AI (no live AI call). Every "expect" below is an expected result printed in that script.
 * It also captures the six owner pages (and the Admin area) at 1280, 768 and 390 for axe / overflow / 14px checks,
 * and writes the README screenshots (1280 and 390) to docs/screenshots/.
 */
const shots = "../docs/screenshots";
const after = "../docs/stage7/after";
const widths = [1280, 768, 390];
const report: unknown[] = [];
test.use({ storageState: { cookies: [], origins: [] } });

async function capture(page: Page, name: string, readme = true) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const toast = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await toast.count()) await toast.first().click().catch(() => undefined);   // a transient toast must not sit on a README image
    await page.mouse.move(2, 2);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const overflowFree = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.closest(".sr-only") || el.closest(".ml-step-label") || el.closest("svg") || el.closest(".recharts-wrapper")) return false;
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(style.fontSize) < 14 && el.getBoundingClientRect().width > 0;
    }).length);
    const axe = await new AxeBuilder({ page }).analyze();
    report.push({ screen: name, width, overflowFree, textUnder14pxCount: small, axeViolations: axe.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`) });
    await page.screenshot({ path: `${after}/${name}-${width}.png`, fullPage: true });
    if (readme && width !== 768) await page.screenshot({ path: `${shots}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("5-minute demo script: upload, first answer, pin, dashboard and PDF, predictions, definitions, admin area", async ({ page }) => {
  test.setTimeout(280000);
  fs.mkdirSync(shots, { recursive: true });
  fs.mkdirSync(after, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Step 0: a clean start. A fresh project stands in for the script's fresh throwaway copy, because the shared
  // test server keeps datasets from earlier specs.
  const project = await (await page.request.post("/api/projects", { data: { name: "Demo shop" } })).json();
  await page.context().addCookies([{ name: "insightiq_project", value: project.id, url: "http://127.0.0.1:5174" }]);
  await page.goto("/#overview");
  await page.evaluate((id) => localStorage.setItem("insightiq-active-project-v1", id), project.id);
  await page.reload();

  // Step 1: an empty project. Home asks for data.
  await expect(page.getByRole("heading", { name: "Add your data to get started" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Setup guide" })).toHaveCount(0);      // P3: no checklist on an empty workspace
  await capture(page, "home-empty", false);
  await page.getByRole("region", { name: "Welcome" }).getByRole("button", { name: "Upload a dataset" }).click();
  await expect(page.locator("main h1")).toHaveText("Datasets");      // the import window opens on Datasets

  // Step 2: upload shop-sales-2026.csv. Expect 120 rows and 8 columns.
  await page.getByLabel("Upload CSV file").setInputFiles("../docs/demo/shop-sales-2026.csv");
  await expect(page.getByRole("heading", { level: 1, name: "Ask your data" })).toBeVisible();      // P3: lands on the first question
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible();
  const row = page.locator("table.dataset-table tbody tr").first();
  await expect(row).toContainText("shop-sales-2026.csv");
  await expect(row).toContainText("120");
  await expect(row).toContainText("8");
  await expect(page.getByText(/0 missing values · 0 duplicate rows/)).toBeVisible();
  await expect(page.locator("table.dataset-table .sample-badge")).toHaveCount(0);   // nothing is a sample unless you mark it
  await capture(page, "datasets");

  // Step 3: Ask. Confirm the column types once, then ask a question.
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeDisabled();
  await expect(page.getByText(/Confirm column types to continue/)).toBeVisible();
  await page.getByRole("button", { name: "Use suggested types" }).click();
  await page.locator(".confirm-types input").check();
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill("What is the total revenue?");
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  const card = page.getByRole("region", { name: "Result insights" });
  await expect(card.locator(".answer-sentence")).toContainText("356,446");
  await expect(card.locator("details.result-details")).not.toHaveAttribute("open", "");   // details stay collapsed
  await expect(card).toContainText("using the column types you confirmed");
  await capture(page, "ask");
  await card.getByText("Show details", { exact: true }).click();
  await card.getByRole("tab", { name: "How this was calculated" }).click();
  await expect(card.getByRole("tabpanel")).toContainText("Total revenue: the value is $356,446.00");
  await card.getByText("Show details", { exact: true }).click();

  // Step 4: pin it to a new dashboard.
  await card.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  const pin = page.getByRole("dialog", { name: "Pin to dashboard" });
  await expect(pin).toContainText("Pinning saves up to 1,000 result rows in this project on this computer.");
  await pin.getByLabel("New dashboard name").fill("Weekly numbers");
  await pin.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByText(/Pinned to your dashboard/)).toBeVisible();
  // A second answer with a chart, pinned to the same dashboard.
  await page.getByRole("textbox", { name: /follow-up|Your question/ }).fill("Total revenue by region");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator('.answer-sentence')).toHaveText('Total revenue by region: East is highest at $109,219.50.');      // one lead sentence (P2)
  await page.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
  const pin2 = page.getByRole("dialog", { name: "Pin to dashboard" });
  await pin2.getByRole("combobox", { name: "Dashboard", exact: true }).selectOption({ label: "Weekly numbers" });
  await pin2.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByText(/Pinned to your dashboard/)).toBeVisible();

  // Step 5: the dashboard and its PDF.
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Weekly numbers", level: 2 }).first()).toBeVisible();
  await expect(page.locator(".dashboard-widget")).toHaveCount(2);
  await expect(page.getByText(/^Updated \d{1,2} \w{3} \d{4}$/).first()).toBeVisible();
  const pdfHref = await page.getByRole("link", { name: "Export PDF", exact: true }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await capture(page, "dashboards");

  // Step 6: Home now shows the dashboard and the recent question.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved dashboards" })).toContainText("Weekly numbers");
  await expect(page.getByRole("region", { name: "Recent questions" })).toContainText("total revenue");
  await capture(page, "home");

  // Step 7: Business definitions. Describe a column; nothing is shown as money until you say so.
  await page.getByRole("button", { name: "Business definitions", exact: true }).click();
  await expect(page.getByRole("tab", { name: "What your columns mean" })).toBeVisible();
  await page.getByLabel(/Dataset description/).fill("One row per shop order in 2026.");
  await capture(page, "business-definitions");

  // Step 8: Predictions. Plain steps and the "may give away the answer" warning.
  await page.getByRole("button", { name: "Predictions", exact: true }).click();
  await page.getByRole("button", { name: /Predict a number/ }).click();
  await page.getByLabel("Target column").selectOption("revenue");
  await page.getByRole("button", { name: "Next: check and train", exact: true }).click();
  for (const name of ["order_id", "order_date", "product"]) { const box = page.getByLabel(`Use feature ${name}`, { exact: true }); if (await box.count() && await box.isEnabled()) await box.setChecked(false); }
  for (const name of ["quantity", "unit_price", "discount_pct", "region"]) { const box = page.getByLabel(`Use feature ${name}`, { exact: true }); if (await box.count() && await box.isEnabled()) await box.setChecked(true); }
  await page.getByRole("checkbox", { name: /I confirm/ }).check();
  await page.getByRole("button", { name: "Train local models", exact: true }).click();
  await expect(page.getByRole("region", { name: "AutoML experiment results" })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText("Simple guess, for comparison").first()).toBeVisible();   // honest baseline next to the measured score
  await expect(page.getByText("How accurate is this?")).toBeVisible();
  await capture(page, "predictions");

  // Step 9: the Admin area is hidden until switched on, and says it is not protected by a login.
  await expect(page.getByText("Accuracy check", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /admin tools/i }).click();
  await page.keyboard.press("Escape");
  await goAdmin(page,"Accuracy check");
  await expect(page.getByText("Admin tools: not protected by a login. Anyone using this computer can open them.")).toBeVisible();
  await capture(page, "admin-accuracy-check", false);   // not a README image: earlier specs leave benchmark results on this server
  await goAdmin(page,"Backup info");
  await expect(page.getByRole("heading", { level: 1, name: "Backup info" })).toBeVisible();
  await capture(page, "admin-backup-info");
  await goAdmin(page,"Dataset change history");
  await expect(page.getByText(/not a complete audit trail/i)).toBeVisible();
  await capture(page, "admin-change-history");

  // Step 18: switching the Admin tools off removes them from the owner's menu again.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /admin tools/i }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Accuracy check", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Backup info", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  fs.writeFileSync(`${after}/report.json`, JSON.stringify(report, null, 1));
  expect(errors).toEqual([]);
  for (const r of report as { screen: string; width: number; overflowFree: boolean; textUnder14pxCount: number; axeViolations: string[] }[]) {
    expect(r.overflowFree, `${r.screen} ${r.width} overflow`).toBe(true);
    expect(r.textUnder14pxCount, `${r.screen} ${r.width} small text`).toBe(0);
    expect(r.axeViolations, `${r.screen} ${r.width} axe`).toEqual([]);
  }
});
