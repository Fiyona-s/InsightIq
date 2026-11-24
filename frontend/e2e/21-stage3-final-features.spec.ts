import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { knowledgeTab, selectGlobal } from "./ui";

// The default owner view: offered currency USD, technical details off.
test.use({ storageState: { cookies: [], origins: [] } });

const shop = () => fs.readFileSync("../docs/demo/shop-sales-2026.csv");
async function uploadViaUi(page: Page, name: string, buffer: Buffer) {
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({ name, mimeType: "text/csv", buffer });
  await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible();
}

test("nothing is money or a percentage until the owner confirms it; confirming shows $ and % and can be changed or converted", async ({ page }) => {
  test.setTimeout(150000);
  const name = `units-${Date.now()}.csv`;
  // "sales" holds counts here; "discount_pct" is a percentage; "revenue" is money.
  await uploadViaUi(page, name, Buffer.from("id,region,sales,discount_pct,revenue\n1,North,2,5,1500\n2,South,1,0,1740\n"));
  await expect(page.getByText(/No columns are confirmed as money/)).toBeVisible();     // upload marks nothing

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByLabel("Analysis type for sales").selectOption("BIGINT");
  await page.getByLabel("Analysis type for discount_pct").selectOption("DOUBLE");
  // Name hints are pre-selected as suggestions only.
  await expect(page.getByLabel("What revenue is")).toHaveValue("money");
  await expect(page.getByLabel("What sales is")).toHaveValue("money");                  // a suggestion; it is really a count
  await expect(page.getByLabel("What discount_pct is")).toHaveValue("percent");
  await page.getByLabel("What sales is").selectOption("neither");                       // the owner says: a count
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();          // confirms types AND number choices
  await box.fill("What is the total revenue?");
  await box.press("Enter");
  const answer = page.getByRole("region", { name: "Result insights" });
  await expect(answer.locator(".answer-sentence")).toContainText("$3,240");
  await expect(answer.getByText(/Amounts are in USD/)).toBeVisible();
  await expect(answer.getByRole("button", { name: "Convert Currency" })).toBeVisible();

  // Change the dataset's currency: the button lands on the columns tab.
  await answer.getByRole("button", { name: "Change currency" }).click();
  await expect(page.getByLabel("Currency for revenue")).toHaveValue("USD");
  await expect(page.getByLabel("Currency for sales")).toHaveValue("none");
  await expect(page.getByLabel("Currency for discount_pct")).toHaveValue("percent");
  await page.getByLabel("Currency for revenue").selectOption("EUR");
  await page.getByRole("button", { name: "Save definitions", exact: true }).click();
  const impact = page.getByRole("dialog", { name: "Currency dependency impact" });
  await impact.waitFor({ timeout: 4000 }).catch(() => undefined);
  if (await impact.isVisible().catch(() => false)) {
    await impact.getByRole("checkbox").check();
    await impact.getByRole("button", { name: "Save confirmed change" }).click();
  }
  await expect(page.getByRole("status").filter({ hasText: "Definitions saved." })).toBeVisible();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await box.fill("What is the total revenue?");
  await expect(page.getByRole("button", { name: "Analyze" })).toBeEnabled(); // remembered types are back
  await box.press("Enter");
  await expect(page.getByRole("region", { name: "Result insights" }).locator(".answer-sentence")).toContainText("€3,240");
});

test("a dataset whose numbers were never confirmed shows bare numbers", async ({ page }) => {
  test.setTimeout(120000);
  await uploadViaUi(page, `bare-${Date.now()}.csv`, Buffer.from("id,revenue\n1,1500\n2,1740\n"));
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByLabel("What revenue is").selectOption("neither");
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill("What is the total revenue?");
  await box.press("Enter");
  const sentence = page.getByRole("region", { name: "Result insights" }).locator(".answer-sentence");
  await expect(sentence).toContainText("3,240");
  await expect(sentence).not.toContainText("$");
  // One row: "How this was calculated" says the number once instead of total / average / minimum / maximum.
  await page.getByText("Show details", { exact: true }).click();
  await page.getByRole("tab", { name: "How this was calculated" }).click();
  await expect(page.locator("[data-fact-id]")).toHaveCount(1);
});

test("Settings changes only the currency offered when the owner marks money", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByLabel("Currency offered for money columns").selectOption("GBP");
  await uploadViaUi(page, `gbp-${Date.now()}.csv`, Buffer.from("id,revenue\n1,10\n2,20\n"));
  await expect(page.getByText(/No columns are confirmed as money/)).toBeVisible();      // still nothing marked
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await expect(page.getByLabel("What revenue is").locator("option[value=money]")).toHaveText("Money (GBP)");
});

test("Business definitions: two tabs, one primary button, currency on each column row", async ({ page }) => {
  const d = await (await page.request.post("/api/datasets", { multipart: { file: { name: `defs-${Date.now()}.csv`, mimeType: "text/csv", buffer: Buffer.from("id,revenue\n1,10\n2,20\n") } } })).json();
  await page.goto("/#knowledge");
  await selectGlobal(page, d.id);
  const tabs = page.getByRole("tablist", { name: "Business definitions" }).getByRole("tab");
  await expect(tabs).toHaveText(["What your columns mean", "Your key metrics"]);
  await expect(page.locator(".button-primary:visible")).toHaveCount(1);
  await expect(page.getByLabel("Currency for revenue")).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft with AI" })).toBeVisible();   // drafting lives on the first tab
  await knowledgeTab(page, "Advanced");
  await expect(page.getByRole("heading", { name: "What Ask can find" })).toBeVisible();
});

test("Predictions warns about leakage before training and after a suspiciously perfect score", async ({ page }) => {
  test.setTimeout(150000);
  // y is exactly 4*a + b: a column that already contains the answer gives a near-perfect score.
  const rows = Array.from({ length: 300 }, (_, i) => `${i % 50},${i % 7},${4 * (i % 50) + (i % 7)}`).join("\n");
  const d = await (await page.request.post("/api/datasets", { multipart: { file: { name: `ml-${Date.now()}.csv`, mimeType: "text/csv", buffer: Buffer.from("a,b,y\n" + rows + "\n") } } })).json();
  await page.goto("/#predictions");
  await selectGlobal(page, d.id);
  await page.getByRole("button", { name: /Predict a number/ }).click();
  await page.getByLabel("Target column").selectOption("y");
  await page.getByRole("button", { name: "Next: check and train", exact: true }).click();
  await expect(page.getByRole("note", { name: "Leakage warning" })).toContainText("Check for leakage before you train");
  for (const n of ["a", "b"]) await page.getByLabel("Use feature " + n, { exact: true }).check();
  await page.getByRole("checkbox", { name: /I confirm selected predictors/ }).check();
  await page.getByRole("button", { name: "Train local models", exact: true }).click();
  await expect(page.getByRole("region", { name: "AutoML experiment results" })).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("alert", { name: "Leakage warning" })).toContainText("0.98 or more", { timeout: 10000 });
  await expect(page.getByText(/On rows it had not seen while choosing models/)).toBeVisible();
});

test("Run again on current data: a new answer in the same chat, no AI call", async ({ page }) => {
  test.setTimeout(120000);
  const d = await (await page.request.post("/api/datasets", { multipart: { file: { name: `rerun-${Date.now()}.csv`, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n1,1250,North\n2,500,South\n") } } })).json();
  await page.goto("/#analyst");
  await selectGlobal(page, d.id);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill("What is the total revenue?");
  await box.press("Enter");
  const answer = page.getByRole("region", { name: "Result insights" });
  await expect(answer.locator(".answer-sentence")).toContainText("1,750");
  const before = (await (await page.request.get(`/api/analyst/runs?dataset_id=${d.id}`)).json()).length;
  await answer.getByRole("button", { name: "More result actions" }).click();
  await page.getByRole("menuitem", { name: "Run again on current data" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/analyst/runs?dataset_id=${d.id}`)).json()).length).toBe(before + 1);
  const runs = await (await page.request.get(`/api/analyst/runs?dataset_id=${d.id}`)).json();
  expect(runs.every((r: { status: string }) => r.status === "succeeded")).toBe(true);
  expect(new Set(runs.map((r: { executed_sql: string }) => r.executed_sql)).size).toBe(1); // the same saved SQL, not a new AI answer
  await expect(page.getByRole("region", { name: "Result insights" }).locator(".answer-sentence")).toContainText("1,750");
});
