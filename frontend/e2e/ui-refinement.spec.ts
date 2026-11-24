import {openAdmin, goAdmin} from './ui';
import { test, expect } from "@playwright/test";
// [sidebar label, page heading]
const modules: [string, string][] = [
  ["Home", "Home"],
  ["Datasets", "Datasets"],
  ["Ask", "Ask your data"],
  ["Dashboards", "Dashboards"],
  ["Predictions", "Predictions"],
  ["Business definitions", "Business definitions"],
  ["Accuracy check", "Accuracy check"],
  ["Performance & errors", "Performance & errors"],
  ["Execution traces", "Execution traces"],
];
test("sidebar collapse preserves the current workspace and keyboard dataset tabs preserve the preview", async ({
  page,
}) => {
  await page.goto("/#datasets");
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles({
      name: "UI-KEYBOARD-CONTROLLED.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("account,revenue\n001,1250\n002,\n"),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveClass(/nav-collapsed/);
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Preview", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Columns", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Columns", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".app")).toHaveClass(/nav-collapsed/);
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(page.locator(".app")).not.toHaveClass(/nav-collapsed/);
  await page.keyboard.press("Control+Home");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
test("mobile navigation is keyboard accessible, traps focus and restores focus on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#datasets");
  const toggle = page.getByRole("button", {
    name: "Toggle navigation",
    exact: true,
  });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Datasets", exact: true }),
  ).toBeFocused();
  const brand = page.getByRole("link", { name: "InsightIQ home", exact: true });
  await brand.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Business definitions", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(brand).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(
    await page
      .locator("#workspace-navigation")
      .evaluate((el: HTMLElement) => el.inert),
  ).toBe(true);
});
test("all nine modules fit desktop tablet and mobile without horizontal overflow", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [width, height] of [
    [1440, 1000],
    [820, 1180],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#datasets");
    for (const [name, heading] of modules) {
      const toggle = page.getByRole("button", {
        name: "Toggle navigation",
        exact: true,
      });
      if (await toggle.isVisible()) await toggle.click();
      if(["Accuracy check","Performance & errors","Execution traces"].includes(name)){if(await toggle.isVisible())await page.getByRole("button",{name:"Close navigation",exact:true}).click();await openAdmin(page);}
      if (["Accuracy check", "Performance & errors", "Execution traces"].includes(name)) await goAdmin(page, name); else await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator("main h1")).toHaveText(heading);
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          { message: `${name} should fit ${width}px` },
        )
        .toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('Phase 1A Overview groups counts and filters recent statuses without deleting records', async ({page})=>{
 await page.route('**/api/analytics/runs?*',route=>route.fulfill({json:{total_questions:2430,recent:['succeeded','failed','clarification'].map((status,i)=>({id:String(i),status,question:`Phase1A ${status}`,dataset_name:'CONTROLLED-BENCHMARK-long-retail-v1.csv',created_at:'2026-01-01T00:00:00Z'}))}}));
 await page.goto('/#datasets');await page.getByRole('button',{name:'Home',exact:true}).click();
 await expect(page.getByText('Project totals',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Phase1A succeeded',{exact:true})).toBeVisible();
 await expect(page.getByText('Phase1A failed',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Show all',{exact:true})).toHaveCount(0); // failed and clarification outcomes live in Ask > Recent questions
 await expect(page.getByText('Needs clarification',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Local workspace',{exact:true})).toHaveCount(0);await expect(page.locator('.avatar')).toHaveCount(0);await expect(page.getByText(/Measured intelligence|Local models/)).toHaveCount(0);
 const nav=page.getByRole('button',{name:'Home',exact:true});await nav.click();
 expect(await nav.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
 await nav.focus();await page.keyboard.press('Tab');expect(await page.locator(':focus').evaluate(el=>el.matches(':focus-visible'))).toBe(true);
 await expect(page.locator('[title="CONTROLLED-BENCHMARK-long-retail-v1.csv"]').first()).toBeVisible();
 await expect(page.getByText('Phase1A failed',{exact:true})).toHaveCount(0);
});
