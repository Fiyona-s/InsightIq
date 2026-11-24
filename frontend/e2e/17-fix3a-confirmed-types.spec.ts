import { test, expect } from "@playwright/test";
import { openAnalysisTypes } from "./ui";

// Approved fix 3a: confirmed column types survive leaving and returning to Ask (and a reload),
// while the type-confirmation rule still holds.
test("confirmed column types survive leaving and returning to Ask; changing one requires confirming again", async ({ page }) => {
  const name = `fix3a-${Date.now()}.csv`;
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n1,10.5,North\n2,20.25,South\n") });
  await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible();
  const dataset = (await (await page.request.get("/api/datasets")).json()).find((d: { name: string }) => d.name === name);

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await expect(page.getByRole("checkbox", { name: /I confirm these types/ })).not.toBeChecked();
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/datasets/${dataset.id}/confirmed-types`) && r.request().method() === "PUT");
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
  expect((await saved).status()).toBe(200);

  // Leave Ask and come back (in-app navigation), then reload the page: still confirmed.
  for (const leave of ["navigate", "reload"]) {
    if (leave === "navigate") {
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.locator("main h1")).toHaveText("Home");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
    } else {
      await page.reload();
    }
    await expect(page.getByText(/Using the column types you confirmed/)).toHaveCount(1); // remembered types loaded (the panel closes itself once they are)
    await openAnalysisTypes(page);
    await expect(page.getByText(/Using the column types you confirmed/)).toBeVisible();
    await expect(page.getByLabel("Analysis type for revenue")).toHaveValue("DOUBLE");
    await expect(page.getByRole("checkbox", { name: /I confirm these types/ })).toBeChecked();
  }

  // The question actually uses the remembered, confirmed mapping.
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill("What is the total revenue?");
  const submitted = page.waitForResponse(r => r.url().endsWith("/api/analyst/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  const body = JSON.parse((await submitted).request().postData() || "{}");
  expect(body.type_mapping.revenue).toBe("DOUBLE");

  // Rule still holds: a changed type is not confirmed until the owner confirms again.
  await page.getByRole("button", { name: "New question" }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("BIGINT");
  await expect(page.getByRole("checkbox", { name: /I confirm these types/ })).not.toBeChecked();
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill("Count rows");
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeDisabled();
  await expect(page.getByText("Confirm column types to continue.")).toBeVisible();
});
