import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { editDashboard } from "./ui";

/**
 * Live QA walkthrough: every module, real browser, real AI, in the project "QA walkthrough - keep".
 * Each step records what happened (and a screenshot) in docs/stage3/qa/qa-log.json. A step that fails
 * is logged as a PROBLEM and the walkthrough continues, so one run shows everything that needs fixing.
 */
const OUT = "../docs/stage3/qa";
const PROJECT = "QA walkthrough - keep";
const log: { step: string; status: "ok" | "problem"; note: string; shot?: string }[] = [];
let n = 0;

async function shot(page: Page, name: string) {
  n += 1;
  const file = `shots/${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  return file;
}
async function step(page: Page, name: string, body: () => Promise<string | void>) {
  try {
    const note = (await body()) || "";
    log.push({ step: name, status: "ok", note, shot: await shot(page, name.replace(/\W+/g, "-").toLowerCase()) });
  } catch (e) {
    log.push({ step: name, status: "problem", note: String(e).split("\n")[0].slice(0, 300), shot: await shot(page, "PROBLEM-" + name.replace(/\W+/g, "-").toLowerCase()).catch(() => undefined) });
  }
  fs.writeFileSync(`${OUT}/qa-log.json`, JSON.stringify(log, null, 2));
}

async function nav(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).click(); }

/** Ask a question and report exactly what the owner sees: the answer sentence or the error. */
async function ask(page: Page, question: string, retried = false): Promise<string> {
  await page.waitForTimeout(7000); // the AI provider is on a free plan with a low request limit: be polite between questions
  const box = page.getByRole("textbox", { name: "Your question", exact: true });
  await box.fill(question);
  await expect(page.getByRole("button", { name: "Analyze" })).toBeEnabled();
  await box.press("Enter");
  const card = page.getByRole("region", { name: "Result insights" });
  const failure = page.getByRole("alert").filter({ hasText: /couldn.t finish|failed|error/i });
  const clarify = page.getByText(/A little more context will help/);
  await expect(card.or(failure).or(clarify).first()).toBeVisible({ timeout: 90000 });
  if (await card.isVisible().catch(() => false)) return "ANSWER: " + (await card.locator(".answer-sentence").innerText()).replace(/\s+/g, " ");
  if (await clarify.isVisible().catch(() => false)) return "CLARIFICATION asked: " + (await page.locator(".analyst-clarification").innerText()).replace(/\s+/g, " ").slice(0, 200);
  const text = (await failure.first().innerText()).replace(/\s+/g, " ").slice(0, 200);
  if (/rate or credit limit/i.test(text)) {
    // The provider limit is outside the app: wait once and retry, then skip cleanly instead of failing the walkthrough.
    if (!retried) { await page.waitForTimeout(60000); return ask(page, question, true).catch(() => "SKIPPED: AI provider rate limit (not an app problem)"); }
    return "SKIPPED: AI provider rate limit (not an app problem)";
  }
  return "ERROR shown: " + text;
}

test("live QA walkthrough of every module", async ({ page }) => {
  fs.mkdirSync(`${OUT}/shots`, { recursive: true });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => log.push({ step: "browser page error", status: "problem", note: e.message.slice(0, 300) }));

  await step(page, "1 Open the app", async () => {
    await page.goto("/#overview");
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  });

  await step(page, "2 Projects: create or open the QA project", async () => {
    await page.locator(".project-trigger").click();
    const existing = page.getByRole("menuitemradio", { name: PROJECT });
    if (await existing.count()) { await existing.click(); return "reused the existing QA project"; }
    await page.getByRole("menuitem", { name: /New project/ }).click();
    await page.getByLabel("Project name").fill(PROJECT);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page.locator(".project-trigger")).toContainText("QA walkthrough");
    return "created the QA project";
  });

  await step(page, "3 Home of an empty project", async () => {
    await nav(page, "Home");
    const empty = await page.getByRole("heading", { name: "Add your data to get started" }).isVisible().catch(() => false);
    return empty ? "welcome card shown" : "project already has data (kept from an earlier run)";
  });

  await step(page, "4 Datasets: upload the shop file (nothing is marked as money until you confirm)", async () => {
    await nav(page, "Datasets");
    const present = await page.getByRole("button", { name: /^Actions for shop-sales-2026/ }).count();
    if (present) return "shop-sales-2026.csv already in this project";
    await page.getByLabel("Upload CSV file").setInputFiles("../docs/demo/shop-sales-2026.csv");
    await expect(page.getByRole("status").filter({ hasText: "imported successfully" })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Money columns:/)).toBeVisible();
    return "currency line: " + (await page.locator(".dataset-currency").innerText()).replace(/\s+/g, " ");
  });

  await step(page, "5 Datasets: data quality details and Columns tab", async () => {
    await page.getByRole("button", { name: "Details", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Data quality details" })).toBeVisible();
    await shot(page, "quality-drawer");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Columns", exact: true }).click();
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
  });

  await step(page, "6 Datasets: row menu and version history", async () => {
    await page.getByRole("button", { name: /^Actions for/ }).first().click();
    await page.getByRole("menuitem", { name: "Version history" }).click();
    await expect(page.getByRole("dialog", { name: "Version history" })).toBeVisible();
    await shot(page, "history-drawer");
    await page.keyboard.press("Escape");
  });

  await step(page, "7 Ask: confirm column types (first visit in this project)", async () => {
    await nav(page, "Ask");
    const types = page.locator("details.type-settings");
    if (!(await types.evaluate((el: HTMLDetailsElement) => el.open))) await types.locator("summary").click();
    await page.getByRole("button", { name: "Use suggested types" }).click();
    const units = (await page.locator(".unit-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join(" | ");
    await page.getByRole("checkbox", { name: /I confirm these types/ }).check();   // confirms the types and the number choices together
    await page.waitForTimeout(1500);
    return `number choices offered (name hints are only suggestions): ${units || "none"}; analyze enabled: ` + (await page.getByRole("button", { name: "Analyze" }).isEnabled());
  });

  await step(page, "8 Ask: typo question 'which region have highest revnue'", async () => ask(page, "which region have highest revnue"));
  await step(page, "9 Ask: follow-up 'and which is the lowest?'", async () => ask(page, "and which is the lowest?"));
  await step(page, "10 Ask: new question 'what is the highest product by revenue'", async () => {
    await page.getByRole("button", { name: "New question" }).click();
    return ask(page, "what is the highest product by revenue");
  });
  await step(page, "11 Ask: follow-up 'which region?' (the case you asked about)", async () => ask(page, "which region?"));
  await step(page, "12 Ask: follow-up 'how much did it make there?'", async () => ask(page, "how much did it make there?"));
  await step(page, "13 Ask: new question 'total revenue by region' (chart)", async () => {
    await page.getByRole("button", { name: "New question" }).click();
    return ask(page, "total revenue by region");
  });
  await step(page, "14 Ask: plain count 'how many orders are there?'", async () => {
    await page.getByRole("button", { name: "New question" }).click();
    return ask(page, "how many orders are there?");
  });
  await step(page, "15 Ask: average with a condition 'average revenue per order in the North region'", async () => {
    await page.getByRole("button", { name: "New question" }).click();
    return ask(page, "average revenue per order in the North region");
  });

  await step(page, "15b Ask: percentage column 'what is the average discount percentage?' (shows % only because discount_pct was confirmed as a percentage)", async () => {
    await page.getByRole("button", { name: "New question" }).click();
    return ask(page, "what is the average discount percentage?");
  });

  await step(page, "15c Ask: reopen a good saved answer (no AI call) so details and pinning do not depend on the provider", async () => {
    await page.getByText("Recent questions", { exact: false }).first().click();
    await page.getByRole("button", { name: /total revenue by region/i }).first().click();
    await expect(page.getByRole("region", { name: "Result insights" })).toBeVisible();
  });

  await step(page, "16 Ask: details tabs, menu, currency note", async () => {
    const card = page.getByRole("region", { name: "Result insights" });
    await card.getByText("Show details", { exact: true }).click();
    const tabs = (await card.getByRole("tab").allInnerTexts()).join(" | ");
    await card.getByRole("button", { name: "More result actions" }).click();
    const items = (await page.getByRole("menuitem").allInnerTexts()).join(" | ");
    await page.keyboard.press("Escape");
    return `tabs: ${tabs}; menu: ${items}; currency note: ${(await card.getByText(/Amounts are in/).count()) ? "shown" : "not shown"}`;
  });

  await step(page, "17 Ask: pin to a new dashboard", async () => {
    const card = page.getByRole("region", { name: "Result insights" });
    await card.getByRole("button", { name: "Pin to dashboard", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pin to dashboard" });
    await expect(dialog).toBeVisible();
    const select = dialog.getByRole("combobox", { name: "Dashboard", exact: true });
    if ((await select.inputValue()) === "__new__") await dialog.getByLabel("New dashboard name").fill("QA dashboard");
    await dialog.getByRole("button", { name: "Pin", exact: true }).click();
    // A second run pins the same question again: the app notices the duplicate and offers Replace (the older snapshot stays in history).
    const duplicate = page.getByRole("dialog", { name: "Possible duplicate" });
    const replaced = await duplicate.waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (replaced) await duplicate.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.getByText(/Pinned to your dashboard/)).toBeVisible();
    return replaced ? "the dashboard already had this chart: the duplicate check offered Replace and the older snapshot was kept in history" : "pinned as a new tile";
  });

  await step(page, "18 Ask: answers survive a page reload (saved answers)", async () => {
    await page.reload();
    await page.getByText("Recent questions", { exact: false }).first().click();
    await page.getByRole("button", { name: /total revenue by region/i }).first().click();
    const kept = await page.getByRole("region", { name: "Result insights" }).isVisible().catch(() => false);
    const old = await page.getByText(/asked before answers were kept/).isVisible().catch(() => false);
    return kept ? "answer shown again after reload" : old ? "shows the older-question notice" : "NO answer and no notice";
  });

  await step(page, "19 Dashboards: view, tile menu and details", async () => {
    await nav(page, "Dashboards");
    await expect(page.locator(".dashboard-widget").first()).toBeVisible();
    const titles = (await page.locator(".dashboard-widget h2").allInnerTexts()).join(" | ");
    await page.locator(".dashboard-widget").first().getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Details", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Details$/ })).toBeVisible();
    await shot(page, "tile-details");
    await page.keyboard.press("Escape");
    return "tiles: " + titles;
  });

  await step(page, "19b Dashboards: keep one tile per title (older duplicates from earlier QA runs are removed, the newest stays)", async () => {
    const tiles = page.locator(".dashboard-widget");
    let removed = 0;
    for (let guard = 0; guard < 10; guard++) {
      const titles = await page.locator(".dashboard-widget h2").allInnerTexts();
      const older = titles.findIndex((t, i) => titles.lastIndexOf(t) > i);   // a title that appears again later
      if (older < 0) break;
      await editDashboard(page);
      await page.getByRole("button", { name: `Delete widget ${older + 1}` }).click();
      await page.getByRole("dialog", { name: "Delete widget" }).getByRole("button", { name: "Delete widget", exact: true }).click();
      await expect(tiles).toHaveCount(titles.length - 1);
      removed++;
    }
    const done = page.getByRole("button", { name: "Done editing", exact: true });
    if (await done.isVisible().catch(() => false)) await done.click();
    return `removed ${removed} older duplicate tile(s); tiles now: ` + (await page.locator(".dashboard-widget h2").allInnerTexts()).join(" | ");
  });

  await step(page, "20 Dashboards: export the PDF", async () => {
    const pdfLink = page.getByRole("link", { name: "Export PDF", exact: true });
    const response = await page.request.get((await pdfLink.getAttribute("href"))!);
    expect(response.ok()).toBe(true);
    fs.writeFileSync(`${OUT}/qa-dashboard.pdf`, await response.body());
    return `pdf bytes: ${(await response.body()).length}`;
  });

  await step(page, "21 Business definitions: tabs, currency and a description", async () => {
    await nav(page, "Business definitions");
    const tabs = (await page.getByRole("tab").allInnerTexts()).join(" | ");
    await page.getByLabel("Dataset description").fill("Sales orders of a small shop: one row per order.");
    await page.getByRole("button", { name: "Save definitions", exact: true }).click();
    const impact = page.getByRole("dialog", { name: "Currency dependency impact" });
    if (await impact.isVisible().catch(() => false)) { await impact.getByRole("checkbox").check(); await impact.getByRole("button", { name: "Save confirmed change" }).click(); }
    await expect(page.getByRole("status").filter({ hasText: "Definitions saved" })).toBeVisible();
    return "tabs: " + tabs;
  });

  await step(page, "22 Business definitions: Draft with AI (real AI)", async () => {
    await page.getByRole("tab", { name: "AI drafts", exact: true }).click();
    await page.getByRole("button", { name: "Draft with AI" }).click();
    await page.getByRole("dialog", { name: "Draft data sharing" }).getByRole("button", { name: "Confirm and draft" }).click();
    await expect(page.locator(".knowledge-draft").first()).toBeVisible({ timeout: 90000 });
    return `${await page.locator(".knowledge-draft").count()} drafts proposed (nothing is applied until approved)`;
  });

  await step(page, "23 Business definitions: Advanced (search and verified examples)", async () => {
    await page.getByRole("tab", { name: "Advanced", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What Ask can find" })).toBeVisible();
  });

  await step(page, "24 Predictions: predict a category (region)", async () => {
    await nav(page, "Predictions");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: /Predict a category/ }).click();
    await page.getByLabel("Target column").selectOption("region");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    const warning = await page.getByRole("note", { name: "Leakage warning" }).innerText();
    for (const f of ["product", "quantity", "unit_price", "discount_pct"]) {
      const cb = page.getByLabel("Use feature " + f, { exact: true });
      if ((await cb.count()) && (await cb.isEnabled())) await cb.check();
    }
    await page.getByRole("checkbox", { name: /I confirm selected predictors/ }).check();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Train local models", exact: true }).click();
    await expect(page.getByRole("region", { name: "AutoML experiment results" })).toBeVisible({ timeout: 150000 });
    const plain = await page.locator(".ml-plain").innerText().catch(() => "no plain summary");
    return `before-training warning shown: ${warning.slice(0, 60)}…; summary: ${plain.replace(/\s+/g, " ")}`;
  });

  await step(page, "25 Settings and Menu", async () => {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const items = (await page.getByRole("menuitem").allInnerTexts()).join(" | ");
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByLabel("Currency offered for money columns")).toBeVisible();
    return "menu: " + items;
  });

  await step(page, "26 Admin tools (shown on purpose, labelled as not protected)", async () => {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: /Show admin tools/ }).click();
    await page.keyboard.press("Escape");
    for (const name of ["Accuracy check", "Performance & errors", "Execution traces"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await shot(page, "admin-" + name.replace(/\W+/g, "-").toLowerCase());
    }
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: /Show admin tools/ }).click(); // back off
    await page.keyboard.press("Escape");
  });

  await step(page, "27 Projects page with counts", async () => {
    await page.goto("/#projects");
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    return (await page.locator("table").first().innerText()).replace(/\s+/g, " ").slice(0, 300);
  });

  const problems = log.filter((l) => l.status === "problem");
  console.log(`QA finished: ${log.length - problems.length} steps ok, ${problems.length} problems`);
  for (const p of problems) console.log("PROBLEM:", p.step, "-", p.note);
  expect(log.length).toBeGreaterThan(20);
});
