import {openResultData,openResultTechnical} from "./ui";
import { openAnalysisTypes } from "./ui";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("dataset edits persist after refresh and export the saved version", async ({
  page,
}) => {
  await page.goto("/#datasets");
  const name = `editor-${Date.now()}.csv`;
  await page.getByLabel("Upload CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from("name,amount\nalpha,10\nbeta,20\ngamma,30\n"),
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `${name} imported successfully.` }),
  ).toBeVisible();
  await page.getByRole('switch',{name:'Edit mode',exact:true}).click();
  await page
    .getByRole("button", { name: "Use suggested types", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm types", exact: true })
    .click();
  await page.getByRole("cell", { name: "alpha", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Row 1, name", exact: true })
    .fill('你好,"saved"');
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Add Row", exact: true }).click();
  await page
    .locator('table[aria-label="Editable dataset"] tbody tr')
    .last()
    .getByRole("button", { name: "NULL", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Row 4, name", exact: true })
    .fill("delta");
  await page.keyboard.press("Enter");
  await page
    .locator('table[aria-label="Editable dataset"] tbody tr')
    .last()
    .getByRole("button", { name: "NULL", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Row 4, amount", exact: true })
    .fill("40");
  await page.keyboard.press("Enter");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete row 2", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /\d+ unsaved changes/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved successfully.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Saved · Version 2", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: '你好,"saved"', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "beta", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "delta", exact: true }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.locator("tr.selected").getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Download CSV" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toContain("_updated.csv");
  const text = fs.readFileSync((await download.path())!, "utf-8");
  expect(text).toBe(
    'name,amount\r\n"你好,""saved""",10\r\ngamma,30\r\ndelta,40\r\n',
  );
});

// Real HTTP/DuckDB persistence; only the provider boundary is controlled by e2e_server.
test("click existing revenue, preserve account 001 and row count, save revision 2, export and query in Analyst", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/#datasets");
  const imported = page.waitForResponse(
    (r) => r.url().endsWith("/api/datasets") && r.request().method() === "POST",
  );
  await page.getByLabel("Upload CSV file").setInputFiles({
    name: "SYNTHETIC-existing-cell-example.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "account,revenue,day,note\n001,1240.50,2026-01-01,alpha\n002,20.00,2026-01-02,beta\n",
    ),
  });
  const dataset = await (await imported).json();
  const before = await (
    await page.request.get(`/api/datasets/${dataset.id}/rows`)
  ).json();
  await page.getByRole("cell", { name: "1240.50", exact: true }).click();
  const field = page.getByRole("textbox", {
    name: "Row 1, revenue",
    exact: true,
  });
  await field.fill("1500.00");
  await field.press("Enter");
  await expect(
    page.getByText("1 unsaved change", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Original: 1240.50", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Edited: 1500.00", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("td[data-modified]")).toHaveCount(1);
  await page
    .getByLabel("Type for revenue", { exact: true })
    .selectOption("DOUBLE");
  await page.getByLabel("Type for day", { exact: true }).selectOption("DATE");
  await page
    .getByRole("button", { name: "Confirm types", exact: true })
    .click();
  const saving = page.waitForRequest(
    (r) => r.url().endsWith("/edits") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const sent = (await saving).postDataJSON();
  expect(sent.updates).toEqual([
    { id: before.rows[0].id, values: { revenue: "1500.00" } },
  ]);
  expect(sent.additions).toEqual([]);
  expect(sent.deletions).toEqual([]);
  await expect(page.getByText("Changes saved successfully.")).toBeVisible();
  await expect(
    page.getByText("Saved · Version 2", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("td[data-modified]")).toHaveCount(0);
  const after = await (
    await page.request.get(`/api/datasets/${dataset.id}/rows`)
  ).json();
  expect(after.total).toBe(2);
  expect(after.rows.map((r: { id: string }) => r.id)).toEqual(
    before.rows.map((r: { id: string }) => r.id),
  );
  expect(after.rows[0].values).toEqual([
    "001",
    "1500.00",
    "2026-01-01",
    "alpha",
  ]);
  const downloading = page.waitForEvent("download");
  await page.locator("tr.selected").getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Download CSV" }).click();
  expect(fs.readFileSync((await (await downloading).path())!, "utf-8")).toBe(
    "account,revenue,day,note\r\n001,1500.00,2026-01-01,alpha\r\n002,20.00,2026-01-02,beta\r\n",
  );
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "1500.00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved · Version 2", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.getByRole("checkbox").check();
  await page.getByRole('textbox',{name:'Your question',exact:true}).fill("What is the total revenue?");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await openResultData(page);
  await expect(
    page.getByRole("cell", { name: "1,520", exact: true }),
  ).toBeVisible();
});

test("existing cell batches survive sorted pages, invalid input, Escape, Undo, NULL and Cancel", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/#datasets");
  const imported = page.waitForResponse(
    (r) => r.url().endsWith("/api/datasets") && r.request().method() === "POST",
  );
  const csv =
    "account,revenue,day,note\n" +
    Array.from(
      { length: 30 },
      (_, i) =>
        `${String(i + 1).padStart(3, "0")},${i ? `${i + 1}.00` : "1240.50"},2026-01-01,note-${i + 1}`,
    ).join("\n") +
    "\n";
  await page.getByLabel("Upload CSV file").setInputFiles({
    name: "SYNTHETIC-paged-cell-edits.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const dataset = await (await imported).json();
  const endpoint = `/api/datasets/${dataset.id}`;
  const before = await (
    await page.request.get(endpoint + "/rows?limit=100")
  ).json();
  await page.getByRole("cell", { name: "1240.50", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Row 1, revenue", exact: true })
    .fill("1500.00");
  await page.keyboard.press("Enter");
  await page
    .getByLabel("Type for revenue", { exact: true })
    .selectOption("DOUBLE");
  await page.getByLabel("Type for day", { exact: true }).selectOption("DATE");
  await page
    .getByRole("button", { name: "Confirm types", exact: true })
    .click();
  await page.getByRole("button", { name: "Next rows", exact: true }).click();
  const last = page.locator(`tr[data-row-id="${before.rows[29].id}"]`);
  await last.getByRole("button", { name: "30.00", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Row 30, revenue", exact: true })
    .fill("3000.00");
  await page.keyboard.press("Tab");
  const day = page.getByRole("textbox", { name: "Row 30, day", exact: true });
  await expect(day).toBeFocused();
  await day.fill("2026-02-03");
  await day.press("Enter");
  await page.getByLabel("Sort editor rows").selectOption("revenue");
  const tenth = page.locator(`tr[data-row-id="${before.rows[9].id}"]`);
  await tenth.getByRole("button", { name: "note-10", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Row 1, note", exact: true });
  await text.fill("reviewed");
  await text.press("Enter");
  await expect(
    page.getByText("4 unsaved changes", { exact: true }),
  ).toBeVisible();
  const first = page.locator(`tr[data-row-id="${before.rows[0].id}"]`);
  await first.getByRole("button", { name: "1500.00", exact: true }).click();
  await page.locator(".editor-scroll textarea").fill("invalid-number");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "invalid for confirmed type DOUBLE",
  );
  await expect(
    first.getByRole("button", { name: "invalid-number", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(endpoint + "/version")).json()).version,
  ).toBe(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "1500.00", exact: true }),
  ).toBeVisible();
  await tenth.getByRole("button", { name: "reviewed", exact: true }).click();
  await page.locator(".editor-scroll textarea").fill("discard this input");
  await page.keyboard.press("Escape");
  await expect(
    tenth.getByRole("button", { name: "reviewed", exact: true }),
  ).toBeVisible();
  await tenth.getByRole("button", { name: "2026-01-01", exact: true }).click();
  await page
    .getByRole("button", { name: "Set row 1 day to NULL", exact: true })
    .click();
  await expect(
    page.getByText("5 unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Saved · Version 2", {
      exact: true,
    }),
  ).toBeVisible();
  const after = await (
    await page.request.get(endpoint + "/rows?limit=100")
  ).json();
  expect(after.total).toBe(30);
  expect(after.rows.map((r: { id: string }) => r.id)).toEqual(
    before.rows.map((r: { id: string }) => r.id),
  );
  expect(after.rows[0].values).toEqual([
    "001",
    "1500.00",
    "2026-01-01",
    "note-1",
  ]);
  expect(after.rows[29].values).toEqual([
    "030",
    "3000.00",
    "2026-02-03",
    "note-30",
  ]);
  expect(after.rows[9].values).toEqual(["010", "10.00", null, "reviewed"]);
  const exported = await (await page.request.get(endpoint + "/export")).text();
  expect(exported).toContain("010,10.00,,reviewed\r\n");
  await page.reload();
  await page.getByRole("cell", { name: "1500.00", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Row 1, revenue", exact: true })
    .fill("9999.00");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "1500.00", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(endpoint + "/version")).json()).version,
  ).toBe(2);
  await page.screenshot({
    path: "test-results/module1-cell-edit-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/module1-cell-edit-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
