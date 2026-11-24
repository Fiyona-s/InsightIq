import { expect, test } from "@playwright/test";
test("real upload, schema, preview, reload and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#datasets");
  await expect(
    page.getByRole("heading", { name: "Datasets", exact: true }),
  ).toBeVisible();
  const name = `illustrative-e2e-${Date.now()}.csv`;
  await page.getByLabel("Upload CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from("account,revenue\n001,1240.50\n002,\n"),
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `${name} imported successfully.` }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Columns", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "revenue" }),
  ).toContainText("DOUBLE");
  await expect(page.getByRole("row").filter({hasText:"account"})).toContainText("VARCHAR");
  const catalog=await (await page.request.get('/api/datasets')).json();
  expect(catalog.find((d:{name:string})=>d.name===name).columns.find((c:{name:string})=>c.name==='revenue').type).toBe('VARCHAR');
  await page.reload();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Dashboards", exact: true })
    .click();
  await expect(page.getByRole("heading", {name:"Dashboards"})).toBeVisible();
  await page.getByRole("button", {name:"Toggle navigation"}).click();
  await page.getByRole("button", {name:"Datasets",exact:true}).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
