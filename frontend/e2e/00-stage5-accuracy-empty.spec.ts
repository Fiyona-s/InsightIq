import { test, expect } from "@playwright/test";

/**
 * Stage 5: the Accuracy check empty state, on a fresh database (this file sorts first, before any evaluation exists).
 * Offline replay with no saved answers scores 0 of 45: the page must say why and what to do, and "Set up a live check"
 * must only open Live mode (never start a run).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("Accuracy check empty state explains 0 of 45; the live check button only opens Live mode", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/#overview");
  await page.evaluate(() => localStorage.setItem("insightiq-admin-tools-v1", "true"));
  const installed = await (await page.request.post("/api/benchmarks/retail-v1/install")).json();
  await page.request.post(`/api/benchmarks/retail-v1/verify?dataset_id=${installed.dataset_id}`);
  await page.goto("/#evaluation");
  await page.reload();
  await page.getByRole("heading", { name: "Accuracy check" }).waitFor();
  await page.waitForTimeout(800);
  await expect(page.getByText(/What this is for/)).toBeVisible();
  await expect(page.getByText("No evaluation results yet", { exact: true })).toBeVisible();
  await expect(page.getByText(/not a low accuracy/i)).toBeVisible();
  await expect(page.getByText(/not protected by a login. Anyone using this computer can open them/)).toBeVisible();
  // "Set up a live check" only opens Live mode: no run is created, the confirmation and spend limit stay.
  const before = (await (await page.request.get("/api/evaluations")).json()) as unknown[];
  await page.getByRole("button", { name: "Set up a live check" }).click();
  await expect(page.getByLabel("Evaluation mode")).toHaveValue("paid");
  await page.waitForTimeout(500);
  const afterJobs = (await (await page.request.get("/api/evaluations")).json()) as unknown[];
  expect(afterJobs.length).toBe(before.length);

});
