import { test, expect, type Page } from "@playwright/test";

/**
 * Stage 7 follow-up (mobile first load):
 *  - Datasets used to flash its empty "import" panel while the list was still loading, then jump (layout shift
 *    0.074 at 390 px). While loading it must now show only the loading text; the import panel appears only for an
 *    empty project that has finished loading.
 * Layout shift itself is measured on the production build with Lighthouse (docs/stage7), not here: the development
 * build used by these tests renders too differently for a numeric threshold to be reliable.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function freshProject(page: Page, withDataset: boolean) {
  const project = await (await page.request.post("/api/projects", { data: { name: `Stable ${Date.now()}${withDataset ? "a" : "b"}` } })).json();
  await page.context().addCookies([{ name: "insightiq_project", value: project.id, url: "http://127.0.0.1:5174" }]);
  await page.goto("/#overview");
  await page.evaluate((id) => localStorage.setItem("insightiq-active-project-v1", id), project.id);
  if (withDataset) {
    const up = await page.request.post("/api/datasets", { headers: { "X-InsightIQ-Project": project.id }, multipart: { file: { name: "stable.csv", mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n001,1250,North\n002,20,South\n") } } });
    expect(up.status()).toBe(201);
  }
  return project;
}

test("Datasets shows only 'Loading' while the list loads, then the table, and never the import panel", async ({ page }) => {
  test.setTimeout(90000);
  await freshProject(page, true);
  await page.route(/\/api\/datasets\?/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#datasets");
  await page.reload();
  await expect(page.getByText("Loading datasets…")).toBeVisible();
  await expect(page.locator(".upload-zone")).toHaveCount(0);          // no flash of the empty-project panel
  await page.getByRole("button", { name: "Files", exact: true }).click({ timeout: 15000 });      // phones: the file list opens in a drawer
  await expect(page.locator("table.dataset-table")).toBeAttached({ timeout: 15000 });
  await expect(page.locator(".upload-zone")).toHaveCount(0);
});

test("an empty project still offers the import panel once loading has finished", async ({ page }) => {
  test.setTimeout(90000);
  await freshProject(page, false);
  await page.goto("/#datasets");
  await page.reload();
  await expect(page.locator(".upload-zone")).toBeVisible();
  await expect(page.getByText("Loading datasets…")).toHaveCount(0);
});
