import { test, expect, type Page } from "@playwright/test";
import { openAnalysisTypes, openAdmin } from "./ui";

// Stage 2: Projects. Items created in one project never appear in another, through the real UI.
async function switchProject(page: Page, name: RegExp) {
  await page.getByRole("button", { name: /^Project / }).click();
  await Promise.all([page.waitForEvent("load"), page.getByRole("menuitemradio", { name }).click()]);
  await page.waitForLoadState("networkidle");
}

test("a project isolates datasets, questions, dashboards and admin views; archive and delete are safe", async ({ page }) => {
  test.setTimeout(150000);
  const stamp = Date.now(), project = `Stage2 shop ${stamp}`, file = `stage2-${stamp}.csv`, question = `STAGE2-${stamp} total revenue`;
  // Default project gets its own throwaway dataset first.
  await page.goto("/#datasets");
  await page.getByLabel("Upload CSV file").setInputFiles({ name: `default-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n1,5,North\n") });
  await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible();

  // Create the project from the top-bar switcher; the app switches into it.
  await page.getByRole("button", { name: /^Project / }).click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(project);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create project" }).click()]);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: new RegExp(`^Project ${project}`) })).toBeVisible();

  // Work inside the project: upload, ask with confirmed types, pin to a dashboard of this project.
  await page.goto("/#datasets");
  await expect(page.getByText(`default-${stamp}.csv`)).toHaveCount(0); // Default's data is not here
  await page.getByLabel("Upload CSV file").setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n1,10.5,North\n2,20.25,South\n") });
  await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible();
  const board = await (await page.request.post("/api/dashboards", { data: { title: `Board ${stamp}`, description: "" } })).json();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox", { name: /I confirm these types/ }).check();
  await page.getByRole("textbox", { name: "Your question", exact: true }).fill(question);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText(/^Your total revenue is/)).toBeVisible();
  await page.getByRole("button", { name: "Pin to dashboard" }).click();
  await page.locator("select").filter({ has: page.locator("option", { hasText: `Board ${stamp}` }) }).first().selectOption({ label: `Board ${stamp}` });
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByText(/Pinned to your dashboard/)).toBeVisible();

  // Switch to Default: nothing from the project appears on any owner surface.
  await switchProject(page, /Default project/);
  for (const route of ["datasets", "overview", "analyst", "dashboards", "automl", "knowledge"]) {
    await page.goto("/#" + route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toContainText(file);
    await expect(page.locator("main")).not.toContainText(question);
    await expect(page.locator("main")).not.toContainText(`Board ${stamp}`);
  }
  await page.getByRole("button", { name: /^Active dataset/ }).click();
  await page.getByRole("textbox", { name: "Search active datasets" }).fill(`stage2-${stamp}`);
  await expect(page.getByRole("listbox", { name: "Active datasets" }).getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await openAdmin(page);
  for (const route of ["analytics", "traces"]) {
    await page.goto("/#" + route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).not.toContainText(question);
  }
  expect((await (await page.request.get("/api/datasets?include_archived=true")).json()).some((d: { name: string }) => d.name === file)).toBe(false);

  // Archive (reversible): hidden from the switcher, restored intact.
  await page.goto("/#projects");
  await page.getByRole("button", { name: `Actions for ${project}` }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: `Restore ${project}` })).toBeVisible();
  await page.getByRole("button", { name: /^Project / }).click();
  await expect(page.getByRole("menuitemradio", { name: project })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Restore ${project}` }).click();
  await switchProject(page, new RegExp(project));
  await page.goto("/#datasets");
  await expect(page.getByText(file).first()).toBeVisible();

  // Delete: dependency preview + exact typed name; items move to Default, nothing is deleted.
  await page.goto("/#projects");
  await page.getByRole("button", { name: `Actions for ${project}` }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Delete ${project}?` });
  await expect(dialog).toContainText("1 dataset");
  await expect(dialog).toContainText("No data is deleted");
  await expect(dialog.getByRole("button", { name: "Delete project" })).toBeDisabled();
  await dialog.getByLabel(/to confirm/).fill(project);
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Delete project" }).click()]);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /^Project Default project/ })).toBeVisible();
  await page.goto("/#datasets");
  await expect(page.getByText(file).first()).toBeVisible();
});
