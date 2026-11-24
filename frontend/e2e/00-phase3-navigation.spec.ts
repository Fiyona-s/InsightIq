import {openEvaluationSetup, goAdmin } from './ui';
import { test, expect, type Page } from "@playwright/test";
import { selectGlobal, openAdmin, openAnalysisTypes } from "./ui";
import fs from "node:fs";
const folder = "../docs/phase3/after";
const csv =
  "account,x,revenue,region\n" +
  Array.from(
    { length: 80 },
    (_, i) =>
      `${String(i + 1).padStart(3, "0")},${Math.sin(i) * 3 + i * 0.1},${i + 1},${i % 2 ? "East" : "West"}`,
  ).join("\n") +
  "\n";
async function upload(page: Page, name: string) {
  const r = await page.request.post("/api/datasets", {
    multipart: {
      file: { name, mimeType: "text/csv", buffer: Buffer.from(csv) },
    },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function shot(page: Page, name: string) {
  await page.evaluate(()=>{window.scrollTo(0,0);const focused=document.activeElement;if(focused instanceof HTMLElement&&focused.matches(".skip-link"))focused.blur()});
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}
async function ask(page: Page, question = "What is total revenue?") {
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await page.locator(".confirm-types input").check();
  await page
    .getByRole("textbox", { name: "Your question", exact: true })
    .fill(question);
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
}
test("empty workspace setup uses real progress and shared dataset across all work pages", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect(await (await page.request.get("/api/datasets")).json()).toHaveLength(
    0,
  );
  await page.goto("/#overview");
  const guide = page.getByRole("region", { name: "Setup guide" });
  await expect(guide).toHaveCount(0);        // P3: an empty workspace shows one path (upload or sample), no checklist
  await expect(page.getByRole("button", { name: "Try sample data" })).toBeVisible();
  await shot(page, "first-run-empty");
  await shot(page, "sidebar-collapsed");
  await page.getByRole("button", { name: "Datasets", exact: true }).click();        // the Home welcome path lands on Ask (see uiclean-firstrun); this test follows the Datasets page path
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles({
      name: "phase3-orders.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  const id = (await (await page.request.get("/api/datasets")).json())[0].id;
  await page.getByRole("button", { name: "Predictions", exact: true }).click();        // the dataset picker is in the page (Predictions, Business definitions, Ask); the top bar has none
  await page
    .getByRole("button", { name: /^Active dataset/ })
    .click();
  await expect(
    page.getByRole("listbox", { name: "Active datasets" }).getByRole("option"),
  ).toContainText("80 rows · 4 columns");
  await shot(page, "selector-open");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /^Active dataset/ }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(guide).toContainText("1 of 4 done");
  await shot(page, "overview-renamed-cards");
  await guide.getByRole("button", { name: "Review the profile" }).click();
  await expect(page.getByRole("tab", { name: "Columns" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await shot(page, "breadcrumb-datasets");
  await openAdmin(page);await page
    .getByRole("button", { name: "Business definitions", exact: true })
    .click();
  await expect(page.locator(".active-dataset-label")).toContainText(
    "phase3-orders.csv",
  );
  await page
    .getByRole("button", { name: "Predictions", exact: true })
    .click();
  await expect(page.locator(".active-dataset-label")).toContainText(
    "phase3-orders.csv",
  );
  await page.getByRole("button", { name: "Dashboards", exact: true }).click();
  await expect(page.locator(".main > header .dataset-trigger")).toHaveCount(0);      // the top bar is the project switcher and Menu only
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(guide).toContainText("2 of 4 done");
  await guide.getByRole("button", { name: "Ask a question" }).click();
  // The Ask page no longer repeats the dataset in its own card: the question box names it and so does the top bar.
  await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toHaveAttribute("placeholder", /phase3-orders\.csv/);
  await expect(page.getByRole("button", { name: /^Active dataset/ })).toHaveAttribute("title", "phase3-orders.csv");
  await ask(page);
  await expect(page.locator(".answer-sentence")).toHaveText(
    "Your total revenue is 3,240.",
  );
  await shot(page, "breadcrumb-ask");
  const dashboard = await (
    await page.request.post("/api/dashboards", {
      data: { title: "Phase3 first dashboard", description: "" },
    })
  ).json();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(guide).toHaveCount(0);        // P6: the setup guide is gone after the first answer
  await page
    .getByRole("button", { name: "Ask", exact: true })
    .click();
  await page.getByRole("button", { name: /What is total revenue/ }).click();
  await page
    .getByRole("button", { name: "Pin to dashboard", exact: true })
    .click();
  const pin = page.getByRole("dialog", { name: "Pin to dashboard" });
  await pin.getByRole("combobox", { name: "Dashboard", exact: true }).selectOption(dashboard.id);
  
  await pin.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByText(/Pinned to your dashboard/)).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(guide).toHaveCount(0);
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("insightiq-active-dataset-v1"),
      )) || "{}",
    ).id,
  ).toBe(id);
  expect(errors).toEqual([]);
});
test("dataset switches guard editor drafts, reset AutoML, retain running source and recover from archive", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const a = await upload(page, "phase3-switch-a.csv"),
    b = await upload(page, "phase3-switch-b.csv");
  await page.goto("/#datasets");
  await selectGlobal(page, a.id);
  await page.getByRole("button", { name: "001", exact: true }).click();
  const cell = page.getByRole("textbox", { name: "Row 1, account" });
  await expect(cell).toBeEnabled();
  await cell.fill("099");
  await page.keyboard.press("Enter");
  await selectGlobal(page, b.id);
  let dialog = page.getByRole("dialog", { name: "Unsaved dataset changes" });
  await expect(dialog).toBeVisible();
  await shot(page, "editor-switch-guard");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "099", exact: true }),
  ).toBeVisible();
  await selectGlobal(page, b.id);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "001", exact: true }),
  ).toBeVisible();
  await selectGlobal(page, a.id);
  await page.getByRole("button", { name: "001", exact: true }).click();
  const edited = page.getByRole("textbox", { name: "Row 1, account" });
  await expect(edited).toBeEnabled();
  await edited.fill("010");
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Use suggested types", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm types", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await selectGlobal(page, b.id);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "001", exact: true }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/datasets/${a.id}/rows?offset=0&limit=25`)
      ).json()
    ).rows[0].values[0],
  ).toBe("010");
  await page
    .getByRole("button", { name: "Predictions", exact: true })
    .click();
  await page.getByRole("button",{name:/Predict a number/}).click();
  await page.getByLabel("Target column").selectOption("revenue");
  await page.getByRole("button", { name: "Next: check and train", exact: true }).click();
  await page.getByText("Advanced settings", { exact: true }).click();        // the experiment title now lives under Advanced
  await page.getByLabel("Experiment title").fill("Unsaved controlled configuration");
  await selectGlobal(page, a.id);
  dialog = page.getByRole("dialog", { name: "Reset AutoML configuration?" });
  await expect(dialog).toBeVisible();
  await shot(page, "automl-reset-guard");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Experiment title")).toHaveValue("Unsaved controlled configuration");   // Cancel keeps the configuration
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Target column")).toHaveValue("revenue");
  await selectGlobal(page, a.id);
  await page
    .getByRole("button", { name: "Reset and switch", exact: true })
    .click();
  await expect(page.getByLabel("Target column")).toHaveValue("");           // reset: no target any more
  await page.getByRole("button",{name:/Predict a number/}).click();
  await page.getByLabel("Target column").selectOption("revenue");
  await page.getByRole("button", { name: "Next: check and train", exact: true }).click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await expect(page.getByLabel("Experiment title")).toHaveValue("");        // reset: the typed title is gone too
  await selectGlobal(page, b.id);                                           // leave a clean slate again: switch away (reset) and back
  await page.getByRole("button", { name: "Reset and switch", exact: true }).click();
  await selectGlobal(page, a.id);
  await page
    .getByRole("button", { name: "Ask", exact: true })
    .click();
  await ask(page, "PHASE2 slow total");
  await expect(page.locator(".analyst-skeleton")).toBeVisible();
  await selectGlobal(page, b.id);
  dialog = page.getByRole("dialog", { name: "A job is still running" });
  await expect(dialog).toContainText(a.name);
  await shot(page, "running-job-guard");
  await dialog
    .getByRole("button", { name: "Switch dataset", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your question", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /^Active dataset/ }),
  ).toHaveAttribute("title", b.name);
  await openAnalysisTypes(page);
  await page.getByLabel("Analysis type for revenue").selectOption("DOUBLE");
  await expect(page.locator(".confirm-types input")).not.toBeChecked();
  await expect
    .poll(async () => {
      const runs = await (
        await page.request.get(`/api/analyst/runs?dataset_id=${a.id}`)
      ).json();
      return runs.find((r: any) => r.question === "PHASE2 slow total")?.status;
    })
    .toBe("succeeded");
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await page.getByLabel(`Actions for ${b.name}`, { exact: true }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your previous dataset is no longer available" }),
  ).toBeVisible();
  await expect(
    page.locator('tr[aria-selected="true"] [title="' + a.name + '"]').first(),
  ).toBeVisible();        // Datasets selects by row; the top-bar picker is not on this page any more
  await dialog.getByRole("button",{name:"Done",exact:true}).click();
  await shot(page, "archived-active-fallback");
  await openAdmin(page);
  await shot(page, "sidebar-expanded");
  await goAdmin(page,"Accuracy check");
  await expect(
    page.getByRole("region", { name: "Evaluation dataset" }),
  ).toContainText("Evaluation uses the controlled retail benchmark dataset");
  await openEvaluationSetup(page);await page.getByText("Setup and verification",{exact:true}).click();
  await page
    .getByRole("button", { name: "Install controlled benchmark", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use benchmark for this page only" }),
  ).toBeVisible();
  await shot(page, "evaluation-incompatible");
  const activeId = () => page.evaluate(() => JSON.parse(localStorage.getItem("insightiq-active-dataset-v1") || "{}").id);
  const before = await activeId();        // the top bar has no picker any more: the remembered selection is the source of truth
  await page
    .getByRole("button", { name: "Use benchmark for this page only" })
    .click();
  await expect(page.getByText(/Global selection is unchanged/)).toBeVisible();
  expect(await activeId()).toBe(before);
  for (const [route, title, crumb] of [
    ["data-workspace", "Datasets", "Datasets"],
    ["ai-analyst", "Ask your data", "Ask"],
    ["evaluation-center", "Accuracy check", "Accuracy check"],
    ["run-analytics", "Performance & errors", "Performance & errors"],
  ]) {
    await page.goto("/#" + route);
    await expect(page.locator("main h1")).toHaveText(title);
  }
  expect(errors).toEqual([]);
});
test("selector and admin disclosure support keyboard search, persistence and responsive layout", async ({
  page,
}) => {
  const a = await upload(page, "phase3-keyboard.csv");
  await page.goto("/#overview");
  // Admin tools: hidden by default, switched on from the keyboard via the top-bar Menu, and remembered.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Accuracy check", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemcheckbox", { name: /Show admin tools/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemcheckbox", { name: /Show admin tools/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Accuracy check", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name: /^Active dataset/})).toBeEnabled();
  await page.getByRole("button", { name: /^Active dataset/ }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "Search active datasets" })
    .fill(a.name);
  await expect(page.getByRole("listbox",{name:"Active datasets"}).getByRole("option")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /^Active dataset/ }),
  ).toHaveAttribute("title", a.name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Active dataset/ }).click();
  await shot(page, "selector-mobile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('AutoML running job keeps its original source after a confirmed dataset switch',async({page})=>{
 test.setTimeout(90000);const a=await upload(page,'phase3-model-source.csv'),b=await upload(page,'phase3-model-next.csv');await page.goto('/#automl');await selectGlobal(page,a.id);await page.getByRole('button',{name:/Predict a number/}).click();await page.getByLabel('Target column').selectOption('revenue');await page.getByRole('button',{name:'Next: check and train',exact:true}).click();await expect(page.getByRole('heading',{name:'Check and train',exact:true})).toBeVisible();await page.getByText('Advanced settings',{exact:true}).click();await page.getByLabel('Experiment title').fill('Phase3 controlled source model');await page.getByText('Advanced settings',{exact:true}).click();await page.getByRole('checkbox',{name:/I confirm/}).check();await expect(page.getByRole('button',{name:'Train local models',exact:true})).toBeEnabled();const accepted=page.waitForResponse(r=>r.url().endsWith('/api/automl/experiments')&&r.request().method()==='POST');await page.getByRole('button',{name:'Train local models',exact:true}).click();const job=await (await accepted).json();await expect(page.getByRole('region',{name:'ML training progress'})).toBeVisible();await selectGlobal(page,b.id);await page.getByRole('dialog',{name:'Reset AutoML configuration?'}).getByRole('button',{name:'Reset and switch'}).click();const warning=page.getByRole('dialog',{name:'A job is still running'});await expect(warning).toContainText(a.name);await shot(page,'automl-running-job-guard');await warning.getByRole('button',{name:'Switch dataset'}).click();await expect(page.getByRole('button',{name: /^Active dataset/})).toHaveAttribute('title',b.name);await expect(page.getByLabel('Target column')).toHaveCount(0);await expect.poll(async()=>{const result=await (await page.request.get('/api/automl/experiments/'+job.id)).json();expect(result.dataset_id).toBe(a.id);return result.status},{timeout:45000}).toBe('completed');await expect(page.getByRole('region',{name:'AutoML experiment results'})).toContainText(a.name);
});
