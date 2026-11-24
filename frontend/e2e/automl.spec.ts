import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
async function shot(page: Page, name: string) {
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({
    path: "../docs/phase7/after/" + name + ".png",
    fullPage: true,
  });
  fs.mkdirSync('../docs/product-stage6/after',{recursive:true});
  fs.copyFileSync('../docs/phase7/after/'+name+'.png','../docs/product-stage6/after/'+name+'.png');
}
async function upload(page: Page, name: string, csv: string) {
  await page.goto("/#datasets");
  await page
    .getByLabel("Upload CSV file")
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(
    page.getByRole("status").filter({ hasText: "imported successfully" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Predictions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What do you want to predict?", exact: true }),
  ).toBeVisible();
  await shot(page, "dataset");
}
async function task(page: Page, name: RegExp, target?: string) {
  await page
    .getByRole("navigation", { name: "Model workflow" })
    .getByRole("button", { name: /1\s*What do you want to predict/ })
    .click();
  await shot(page, "task-suggestions-blocker");
  await page.getByRole("button", { name }).click();
  if (target) await page.getByLabel("Target column").selectOption(target);
  await page.getByRole("button", { name: "Next: check and train", exact: true }).click();
}
async function train(page: Page, title?: string) {
  await shot(page, "configure");
  await page.getByText("Advanced settings", { exact: true }).click();
  if (title) await page.getByLabel("Experiment title").fill(title);
  await shot(page, "advanced");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(
    page.getByRole("button", { name: "Train local models", exact: true }),
  ).toBeEnabled();
  await shot(page, "train");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/automl/experiments") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Train local models", exact: true })
    .click();
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  const { id } = await accepted.json();
  await expect(
    page.getByRole("region", { name: "AutoML experiment results" }),
  ).toBeVisible({ timeout: 45000 });
  const job = await (
    await page.request.get("/api/automl/experiments/" + id)
  ).json();
  expect(job.status).toBe("completed");
  expect(job.result).not.toBeNull();
  return job;
}
async function selectFeatures(page: Page, all: string[], selected: string[]) {
  await expect(
    page.getByRole("heading", { name: "Check and train", exact: true }),
  ).toBeVisible();
  for (const name of all) {
    const checkbox = page.getByLabel("Use feature " + name, { exact: true });
    if ((await checkbox.count()) && (await checkbox.isEnabled()))
      await checkbox.setChecked(selected.includes(name));
  }
}
test("local regression, registry reload, single/batch prediction and real CSV export", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const paths: string[] = [];
  page.on("request", (r) => paths.push(r.method() + " " + r.url()));
  const csv =
    "record_id,x,region,amount\n" +
    Array.from({ length: 160 }, (_, i) => {
      const x = Math.sin(i) * 3 + i * 0.11;
      return `ID${i},${x.toFixed(6)},${i % 2 ? "North" : "South"},${(x * 2.5 + (i % 2) * 3 + Math.cos(i) * 0.05).toFixed(6)}`;
    }).join("\n") +
    "\n";
  await upload(page, "SYNTHETIC-AUTOML-REGRESSION.csv", csv);
  await task(page, /Predict a number/, "amount");
  await expect(
    page.getByRole("heading", { name: "Check and train", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Use feature record_id")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Train local models", exact: true }),
  ).toBeDisabled();
  const job = await train(page, "Synthetic regression — browser proof");
  expect(job.result.leaderboard).toHaveLength(5);
  expect(
    job.result.leaderboard.filter(
      (r: { test_metrics: unknown }) => r.test_metrics !== null,
    ),
  ).toHaveLength(1);
  expect(job.result.split.test.count).toBeGreaterThan(0);
  await expect(
    page.getByRole("region", { name: "AutoML experiment results" }),
  ).toContainText("Selection: rmse on validation");
  await expect(
    page.locator(".ml-chart-canvas .recharts-surface").first(),
  ).toBeVisible();
  await shot(page, "regression-baseline");
  await shot(page, "predict");
  await page.getByLabel("Prediction feature x").fill("2.5");
  await page.getByLabel("Prediction feature region").selectOption("North");
  const inference = page.waitForResponse(
    (r) => r.url().endsWith("/predict") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Predict with saved model", exact: true })
    .click();
  const predicted = await (await inference).json();
  expect(Number.isFinite(predicted.rows[0].prediction)).toBe(true);
  await expect(
    page.getByRole("region", { name: "ML prediction results" }),
  ).toBeVisible();
  const csvResponse = await page.request.get(
    "/api/automl/predictions/" + predicted.id + "/export.csv",
  );
  expect(csvResponse.ok()).toBe(true);
  expect(await csvResponse.text()).toContain(
    String(predicted.rows[0].prediction),
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", {name:"Export prediction CSV", exact:true}).click();
  const downloaded = await downloading;
  expect(fs.readFileSync((await downloaded.path())!, "utf-8")).toBe(await csvResponse.text());
  await page.getByLabel("Prediction input").selectOption("batch");
  await page
    .getByLabel("Batch prediction dataset")
    .selectOption(job.dataset_id);
  const batchResponse = page.waitForResponse((r) =>
    r.url().endsWith("/predict"),
  );
  await page
    .getByRole("button", { name: "Predict with saved model", exact: true })
    .click();
  const batch = await (await batchResponse).json();
  expect(batch.row_count).toBe(160);
  expect(batch.scope).toContain("not held-out");
  const full = await page.request.get(
    "/api/automl/predictions/" + batch.id + "/export.csv",
  );
  expect((await full.text()).trim().split("\n")).toHaveLength(161);
  const globalBefore = await page
    .getByRole("button", { name: /^Active dataset/ })
    .getAttribute("title");
  await page
    .getByLabel("Upload batch CSV")
    .setInputFiles({
      name: "phase7-rejected-batch.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("x,region\ninvalid,North\n2,South\n"),
    });
  await expect(
    page.getByText(
      "CSV registered for batch prediction. Global dataset unchanged.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Predict with saved model", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Input validation results" }),
  ).toContainText("1 rejected rows");
  await expect(
    page.getByRole("region", { name: "Input validation results" }),
  ).toContainText("Row 1 · x");
  await shot(page, "rejected-batch");
  expect(
    await page
      .getByRole("button", { name: /^Active dataset/ })
      .getAttribute("title"),
  ).toBe(globalBefore);

  await page.screenshot({
    path: "test-results/phase6-automl-regression-desktop.png",
    fullPage: true,
  });
  const trainingPostsBeforeRecovery=paths.filter(p=>p.startsWith('POST ')&&new URL(p.slice(5)).pathname==='/api/automl/experiments').length;
  expect(trainingPostsBeforeRecovery).toBe(1);
  await page.reload();
  await page
    .getByRole("button", { name: "Predictions", exact: true })
    .click();
  await page.getByText(/Earlier experiments/).click();   // past experiments are one click away
  await expect(
    page.getByText("Synthetic regression — browser proof", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect experiment", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "AutoML experiment results" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect(
    page.locator(".ml-chart-canvas .recharts-surface").first(),
  ).toBeVisible();
  await shot(page, "mobile");
  expect(paths.filter(p=>p.startsWith('POST ')&&new URL(p.slice(5)).pathname==='/api/automl/experiments')).toHaveLength(trainingPostsBeforeRecovery);
  expect(
    paths.some(
      (p) =>
        p.startsWith("POST ") &&
        (p.includes("/api/analyst/runs") || p.includes("/knowledge/retrieve")),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
test("classification, customer RFM, anomaly scores and chronological forecasting use real local models", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const names = [
    "order_id",
    "value",
    "region",
    "quantity",
    "order_date",
    "customer_id",
    "net_revenue_inr",
    "label",
  ];
  const rows = Array.from({ length: 180 }, (_, i) => {
    const value = Math.sin(i) * 3 + i * 0.012,
      day = new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 2)))
        .toISOString()
        .slice(0, 10);
    return `O${i},${value.toFixed(6)},${["North", "South", "West"][i % 3]},${(i % 5) + 1},${day},C${i % 30},${(60 + Math.sin(i) * 10 + Math.floor(i / 2) * 0.3).toFixed(4)},${value > 1 ? "high" : "low"}`;
  });
  await upload(
    page,
    "SYNTHETIC-AUTOML-MULTITASK.csv",
    names.join(",") + "\n" + rows.join("\n") + "\n",
  );
  await task(page, /Predict a category/, "label");
  await selectFeatures(page, names, ["value", "quantity", "region"]);
  let job = await train(page);
  expect(job.result.leaderboard).toHaveLength(4);
  await expect(
    page.getByRole("heading", {
      name: "Where it was wrong: actual (rows) against predicted (columns)",
    }),
  ).toBeVisible();
  await shot(page, "classification-confusion");
  await page.getByLabel("Prediction feature value", { exact: true }).fill("2");
  await page
    .getByLabel("Prediction feature quantity", { exact: true })
    .fill("3");
  await page
    .getByLabel("Prediction feature region", { exact: true })
    .selectOption("North");
  let inference = page.waitForResponse((r) => r.url().endsWith("/predict"));
  await page
    .getByRole("button", { name: "Predict with saved model", exact: true })
    .click();
  expect((await (await inference).json()).row_count).toBe(1);
  await page.getByLabel("Prediction input").selectOption("batch");
  await page
    .getByLabel("Batch prediction dataset")
    .selectOption(job.dataset_id);
  inference = page.waitForResponse((r) => r.url().endsWith("/predict"));
  await page
    .getByRole("button", { name: "Predict with saved model", exact: true })
    .click();
  const classified = await (await inference).json();
  expect(classified.row_count).toBe(180);
  expect(
    (
      await page.request.get(
        "/api/automl/predictions/" + classified.id + "/export.csv",
      )
    ).ok(),
  ).toBe(true);

  await task(page, /Group similar records/);
  await page.getByLabel("Clustering features").selectOption("rfm");
  await page.getByLabel("Customer identifier").selectOption("customer_id");
  await page.getByLabel("Transaction date").selectOption("order_date");
  await page.getByLabel("Monetary value").selectOption("net_revenue_inr");
  await page.getByLabel("Order identifier (optional)").selectOption("order_id");
  job = await train(page);
  expect(job.result.rows_used).toBe(30);
  expect(
    job.result.details.cluster_profiles.reduce(
      (n: number, p: { count: number }) => n + p.count,
      0,
    ),
  ).toBe(30);
  await expect(
    page.getByRole("heading", {
      name: "Cluster characteristics — original feature summaries",
    }),
  ).toBeVisible();
  await expect(page.getByText("Cluster 0", { exact: true })).toBeVisible();
  await task(page, /Find unusual records/);
  await selectFeatures(page, names, ["value", "quantity"]);
  job = await train(page);
  expect(job.result.details.fraud_accuracy).toBeNull();
  expect(
    job.result.plots.anomaly_distribution.reduce(
      (n: number, b: { count: number }) => n + b.count,
      0,
    ),
  ).toBe(180);
  await expect(
    page.getByText(/No fraud accuracy is measured/).first(),
  ).toBeVisible();
  await task(page, /Forecast future values/);
  await page.getByLabel("Time column").selectOption("order_date");
  await page.getByLabel("Forecast measure").selectOption("net_revenue_inr");
  await page.getByLabel("Forecast horizon").fill("7");
  job = await train(page);
  expect(job.result.selection_split).toBe("earlier chronological backtests");
  expect(
    job.result.details.backtests.every(
      (b: { train_end: string; evaluation_start: string }) =>
        b.train_end < b.evaluation_start,
    ),
  ).toBe(true);
  const predict = page.waitForResponse((r) => r.url().endsWith("/predict"));
  await page
    .getByRole("button", { name: "Predict with saved model", exact: true })
    .click();
  expect((await (await predict).json()).row_count).toBe(7);
  await page.screenshot({
    path: "test-results/phase6-automl-forecast-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("keyboard-only wizard navigation, suggestions never auto-apply and Advanced reset", async ({
  page,
}) => {
  const csv =
    "x,amount\n" +
    Array.from(
      { length: 100 },
      (_, i) => `${Math.sin(i)},${i * 0.1 + Math.cos(i)}`,
    ).join("\n");
  await upload(page, "phase7-keyboard.csv", csv);
  async function activate(name: string | RegExp) {
    const locator = page.getByRole("button", {
      name,
      exact: typeof name === "string",
    });
    for (let i = 0; i < 100; i++) {
      if (await locator.evaluate((el) => el === document.activeElement)) {
        await page.keyboard.press("Enter");
        return;
      }
      await page.keyboard.press("Tab");
    }
    throw Error("Keyboard could not reach " + name);
  }
  await expect(
    page.getByRole("heading", { name: "What do you want to predict?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Predict a number/ }).click();   // choosing a task is explicit
  await expect(page.getByLabel("Target column")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Next: check and train", exact: true }),
  ).toBeDisabled();
  // Expand optional suggestions and apply one using keyboard alone.
  const suggestions=page.locator('details.ml-profile-suggestions > summary');
  for(let i=0;i<100;i++){if(await suggestions.evaluate(el=>el===document.activeElement)){await page.keyboard.press('Enter');break}await page.keyboard.press('Tab')}
  const use = page.getByRole("button", { name: "Use suggestion" }).first();
  for (let i = 0; i < 100; i++) {
    if (await use.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Target column")).not.toHaveValue("");
  await activate("Next: check and train");
  await expect(
    page.getByRole("heading", { name: "Check and train", exact: true }),
  ).toBeFocused();
  await activate("Back");
  await expect(page.getByLabel("Target column")).not.toHaveValue("");
  await shot(page, "keyboard-task");
  await activate("Next: check and train");
  const consent = page.getByRole("checkbox", { name: /I confirm/ });
  for (let i = 0; i < 100; i++) {
    if (await consent.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Train local models", exact: true }),
  ).toBeEnabled();
  await activate("Train local models");
  await expect(
    page.getByRole("region", { name: "AutoML experiment results" }),
  ).toBeVisible({ timeout: 45000 });
  const field = page
    .getByRole("spinbutton", { name: /Prediction feature/ })
    .first();
  for (let i = 0; i < 100; i++) {
    if (await field.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.type("1");
  await activate("Predict with saved model");
  await expect(
    page.getByRole("region", { name: "ML prediction results" }),
  ).toBeVisible();
  await shot(page, "keyboard-predict");
});
test("negative R² and omitted importance use an actual temporary no-signal model", async ({
  page,
}) => {
  const csv =
    "x,amount_inr\n" +
    Array.from(
      { length: 160 },
      (_, i) => `${Math.sin(i * 0.71)},${Math.sin(i * 19.723) * 100}`,
    ).join("\n");
  await upload(page, "phase7-negative-r2.csv", csv);
  await task(page, /Predict a number/, "amount_inr");
  await selectFeatures(page, ["x"], ["x"]);
  const job = await train(page);
  const selected = job.result.leaderboard.find(
    (c: { selected: boolean }) => c.selected,
  );
  expect(selected.test_metrics.r2).toBeLessThan(0);
  await expect(page.getByText(/Negative held-out R²/)).toBeVisible();
  fs.writeFileSync(
    "../docs/phase7/negative-r2-measurement.json",
    JSON.stringify(
      {
        throwaway: true,
        task: job.task,
        algorithm: selected.algorithm,
        test_metrics: selected.test_metrics,
        split: job.result.split,
      },
      null,
      2,
    ),
  );
  await expect(page.getByText("Loading result charts…", {exact:true})).toHaveCount(0);
  await shot(page, "negative-r2");
  if (!job.result.feature_importance.values.length) {
    await expect(
      page.getByText("Feature importance not recorded for this model."),
    ).toBeVisible();
    await shot(page, "importance-omitted");
  }
});
