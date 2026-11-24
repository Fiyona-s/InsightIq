import os from "node:os";
import path from "node:path";
import { openAdmin, openVersionHistory, openDataQuality, closeDrawerIfOpen } from "./ui";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { selectGlobal, openAnalysisTypes } from "./ui";
const folder = "../docs/phase4/after";
test.beforeEach(async({page})=>{await page.setViewportSize({width:1440,height:1000})});
async function shot(page: Page, name: string) {
  fs.mkdirSync(folder, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}
async function upload(page: Page, name: string, csv: string) {
  const r = await page.request.post("/api/datasets", {
    multipart: {
      file: { name, mimeType: "text/csv", buffer: Buffer.from(csv) },
    },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
const csv =
  "account,revenue,day,note\n" +
  Array.from(
    { length: 1000 },
    (_, i) =>
      `${String(i + 1).padStart(3, "0")},${i + 10}.00,2026-01-01,note-${i + 1}`,
  ).join("\n") +
  "\n";
function oversizeCsv() {        // a file just over the default limit (60 MB); Playwright wants big files as paths, not buffers
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "insightiq-big-"));
  const file = path.join(folder, "too-big.csv");
  fs.writeFileSync(file, Buffer.alloc(60 * 1024 * 1024 + 1));
  return file;
}

test("preview-first import, sticky editing, navigation guards and bounded mobile preview", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const seed = await upload(
    page,
    "PHASE4-seed.csv",
    "account,revenue,day,note\n001,10,2026-01-01,seed\n",
  );
  await page.goto("/#datasets");
  await selectGlobal(page, seed.id);
  await expect(page.getByRole("region", { name: "CSV import" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Import CSV", exact: true })
    .click();
  let modal = page.getByRole("dialog", { name: "Import CSV" });
  await expect(modal).toContainText("Up to 60 MB");
  await expect(
    modal.getByRole("button", { name: "Close import" }),
  ).toBeFocused();
  await shot(page, "compact-import");
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles({
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
  await expect(modal.getByRole("alert")).toContainText("That file is not a CSV");
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles(oversizeCsv());
  await expect(modal.getByRole("alert")).toContainText("too big");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/datasets") && r.request().method() === "POST",
  );
  const transfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([text], "PHASE4-large-preview.csv", { type: "text/csv" }),
    );
    return dt;
  }, csv);
  await modal
    .getByRole("region", { name: "CSV import" })
    .dispatchEvent("drop", { dataTransfer: transfer });
  const item = await (await response).json();
  await expect(
    page.locator('tr[aria-selected="true"] [title="' + item.name + '"]').first(),
  ).toBeVisible();        // the imported dataset is the selected row (the top-bar picker is not on Datasets any more)
  await expect(modal).toHaveCount(0);
  await openDataQuality(page);
  await expect(
    page.getByRole("region", { name: "Data quality" }),
  ).toBeVisible();
  await closeDrawerIfOpen(page);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(
    page.locator('table[aria-label="Editable dataset"] tbody tr'),
  ).toHaveCount(25);
  await expect(page.getByRole("switch", { name: "Edit mode" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.locator(".editor-help")).toHaveCount(0);
  await shot(page, "preview-first-desktop");
  const before = await (
    await page.request.get(`/api/datasets/${item.id}/rows`)
  ).json();
  await page.getByRole("switch", { name: "Edit mode" }).click();
  await page
    .getByRole("button", { name: "Use suggested types", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm types", exact: true })
    .click();
  await expect(page.locator(".editor-help")).toContainText(
    "Enter applies, Escape cancels",
  );
  await page.getByRole("button", { name: "10.00", exact: true }).click();
  await page.getByRole("textbox", { name: "Row 1, revenue" }).fill("1500.00");
  await page.keyboard.press("Enter");
  const bar = page.getByRole("region", { name: "Unsaved dataset changes" });
  await expect(bar).toContainText("1 changed cell");
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe(
    "sticky",
  );
  await shot(page, "edit-mode-sticky-bar");
  await bar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await page.getByRole("button", { name: "10.00", exact: true }).click();
  await page.getByRole("textbox", { name: "Row 1, revenue" }).fill("1500.00");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Unsaved dataset changes" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("main h1")).toHaveText("Datasets");
  await openVersionHistory(page);
  await expect(
    page.getByRole("button", { name: "Restore revision 1" }),
  ).toBeDisabled();
  await closeDrawerIfOpen(page);
  await page.getByRole("tab", { name: "Preview" }).click();
  page.once("dialog", (d) => d.accept());
  await bar.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Saved · Version 2", {
      exact: true,
    }),
  ).toBeVisible();
  const after = await (
    await page.request.get(`/api/datasets/${item.id}/rows`)
  ).json();
  expect(after.rows[0].id).toBe(before.rows[0].id);
  expect(after.rows[0].values[0]).toBe("001");
  expect(after.rows[0].values[1]).toBe("1500.00");
  await openDataQuality(page);
  await expect(
    page.getByRole("region", { name: "Data quality" }),
  ).toContainText("Revision 2");
  await closeDrawerIfOpen(page);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Files", exact: true })).toBeVisible();      // phones: the file list is one tap away, in a drawer
  await expect(page.locator("table.dataset-table")).toBeHidden();      // the file list is closed until "Files" is pressed
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.locator('table[aria-label="Editable dataset"] tbody tr'),
  ).toHaveCount(25);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    (await page
      .locator('table[aria-label="Editable dataset"] tbody tr')
      .first()
      .boundingBox())!.y,
  ).toBeLessThan(844);
  await shot(page, "preview-first-mobile");
  expect(errors).toEqual([]);
});
test("schema descriptions share Knowledge storage and quality issues remain informational", async ({
  page,
}) => {
  const raw =
    "account,revenue,day,empty,constant\n" +
    Array.from(
      { length: 8 },
      (_, i) => `${String(i + 1).padStart(3, "0")},${10 + i},2026-01-01,,same`,
    ).join("\n") +
    "\n009,bad,not-date,,same\n009,bad,not-date,,same\n";
  const item = await upload(page, "PHASE4-quality-profile.csv", raw);
  await page.goto("/#datasets");
  await selectGlobal(page, item.id);
  await openDataQuality(page);
  const quality = page.getByRole("region", { name: "Data quality" });
  await expect(quality).toContainText("1 duplicate rows");
  await quality.getByText("Review details").click();
  await expect(quality).toContainText("Fully empty: empty");
  await expect(quality).toContainText("do not conform to numeric");
  await shot(page, "quality-summary");
  await closeDrawerIfOpen(page);
  await page.getByRole("tab", { name: "Columns", exact: true }).click();
  const profile = page.getByRole("region", { name: "Schema and profile" });
  await expect(profile).toContainText("Original file: " + item.name);
  await expect(profile.getByText("001", { exact: true })).toBeVisible();
  await expect(profile.getByRole("textbox", { name: "Description for account" })).toHaveCount(0);      // P6: descriptions are written in Business definitions, shown read-only here
  await expect(profile).toContainText("No description yet");
  await profile.getByRole("button", { name: "Edit descriptions in Business definitions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Business definitions" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "account", exact: true })
    .fill("Account reference — leading zeros are meaningful");
  await page
    .getByRole("button", { name: "Save definitions", exact: true })
    .click();
  await expect(page.getByText(/Definitions saved/)).toBeVisible();
  await shot(page, "schema-descriptions");
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await page.getByRole("tab", { name: "Columns", exact: true }).click();
  await expect(page.getByRole("region", { name: "Schema and profile" })).toContainText("Account reference — leading zeros are meaningful");
  const rows = await (
    await page.request.get(`/api/datasets/${item.id}/rows`)
  ).json();
  expect(rows.version).toBe(1);
  expect(rows.rows[0].values[0]).toBe("001");
});
test("real forward-only history shows unavailable, pruned and retained snapshots and restores N+1", async ({
  page,
}) => {
  test.setTimeout(90000);
  const response = await page.request.post("/api/test/phase4/legacy-dataset");
  expect(response.status()).toBe(200);
  const item = await response.json(),
    endpoint = "/api/datasets/" + item.id;
  const initial = await (await page.request.get(endpoint + "/rows")).json();
  for (let i = 0; i < 21; i++) {
    const saved = await page.request.post(endpoint + "/edits", {
      data: {
        expected_version: i + 1,
        updates: [
          {
            id: initial.rows[0].id,
            values: { revenue: String(900 + i) + ".00" },
          },
        ],
      },
    });
    expect(saved.status()).toBe(200);
  }
  const before = await (await page.request.get(endpoint + "/revisions")).json();
  expect(before.current_revision).toBe(22);
  expect(before.revisions.find((r: any) => r.revision === 1).status).toBe(
    "unavailable",
  );
  expect(before.revisions.find((r: any) => r.revision === 2).status).toBe(
    "pruned",
  );
  expect(
    before.revisions.filter((r: any) => r.status === "available"),
  ).toHaveLength(20);
  await page.goto("/#datasets");
  await selectGlobal(page, item.id);
  await openVersionHistory(page);
  await expect(
    page.getByText("No snapshot available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Snapshot pruned", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore revision 1", exact: true }),
  ).toHaveCount(0);
  await shot(page, "history-three-statuses");
  await page
    .getByRole("button", { name: "Preview revision 3", exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: "Read-only preview of revision 3",
  });
  await expect(preview).toContainText("001");
  await expect(preview).toContainText("901.00");
  await shot(page, "history-preview");
  await page.getByRole("button", { name: "Close preview" }).click();
  await page
    .getByRole("button", { name: "Restore revision 3", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Restore revision 3?" });
  await expect(dialog).toContainText(
    "Creates revision 23 with the data from revision 3. Earlier revisions are kept.",
  );
  await shot(page, "restore-confirmation");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await page.request.get(endpoint + "/version")).json()).version,
  ).toBe(22);
  await page
    .getByRole("button", { name: "Restore revision 3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create new revision", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Revision 23 created from revision 3" }),
  ).toBeVisible();
  await shot(page, "post-restore-revision");
  await closeDrawerIfOpen(page);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(
    page.getByText("Saved · Version 23", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "901.00", exact: true }),
  ).toBeVisible();
  const current = await (await page.request.get(endpoint + "/rows")).json();
  expect(current.rows[0].values).toEqual([
    "001",
    "901.00",
    "你好,quoted\nsecond line",
  ]);
  expect(current.rows[0].id).toBe(initial.rows[0].id);
  await page.reload();
  await expect(
    page.getByText("Saved · Version 23", {
      exact: true,
    }),
  ).toBeVisible();
});
test("archived datasets allow read-only history, and active analysis blocks revision restore", async ({
  page,
}) => {
  test.setTimeout(60000);
  const item = await upload(
    page,
    "PHASE4-readonly.csv",
    "account,revenue\n001,10\n002,20\n",
  );
  const endpoint = "/api/datasets/" + item.id;
  await page.goto("/#datasets");
  await selectGlobal(page, item.id);
  await page
    .getByRole("button", { name: "Ask", exact: true })
    .click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill("PHASE2 slow total");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".analyst-skeleton")).toBeVisible();
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await openVersionHistory(page);
  await expect(
    page.getByRole("button", { name: "Restore revision 1" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "A job is using this dataset. Wait for it to finish before restoring.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore revision 1" }),
  ).toBeEnabled();
  const archived = await page.request.post(endpoint + "/archive");
  expect(archived.status()).toBe(200);
  await page.reload();
  await page.getByLabel("Show archived").check();
  await page
    .locator("tr")
    .filter({ has: page.getByLabel(`Select ${item.name}`, { exact: true }) })
    .locator("button.dataset")
    .click();
  await openVersionHistory(page);
  await expect(
    page.getByText("Archived dataset — history is view only."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore revision 1" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Preview revision 1" }),
  ).toBeEnabled();
  await closeDrawerIfOpen(page);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Edit mode" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "001", exact: true }),
  ).toBeDisabled();
  await shot(page, "archived-view-only");
});
