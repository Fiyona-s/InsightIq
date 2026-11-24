import {openEvaluationSetup} from './ui';
import { test, expect, type Page } from "@playwright/test";

// Admin tools are hidden from owners by default; these specs exercise Admin pages directly.
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('insightiq-admin-tools-v1','true'))});

const shot = async (page: Page, name: string) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/phase8/after/" + name + ".png",
    fullPage: !(await page.getByRole("dialog").count()),
  });
};
async function finish(page: Page, id: string) {
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/evaluations/" + id)).json())
          .status,
      { timeout: 60000 },
    )
    .toBe("completed");
  return await (await page.request.get("/api/evaluations/" + id)).json();
}
test("results-first offline replay, failure diff, comparison, partial scope and keyboard/mobile review", async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#evaluation");
  await expect(
    page.getByText("No evaluation results yet", { exact: true }),
  ).toBeVisible();
  await shot(page, "empty");
  await openEvaluationSetup(page);
  const setup = page.getByText("Setup and verification", { exact: true });
  await expect(setup.locator("..")).not.toHaveAttribute("open", "");
  await shot(page, "setup-collapsed");
  await setup.click();
  await page
    .getByRole("button", {
      name: /^(Install controlled benchmark|Check installation)$/,
    })
    .click();
  await expect(
    page.getByText(
      "Controlled benchmark explicitly installed. Uploaded datasets are not assumed compatible.",
    ),
  ).toBeVisible();
  const override = page.getByRole("button", {
    name: "Use benchmark for this page only",
  });
  if (await override.count()) await override.click();
  await page
    .getByRole("button", { name: "Verify benchmark references", exact: true })
    .click();
  await expect(
    page.getByText("45 / 45 verified · 0 pending", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await shot(page, "setup-expanded");
  await setup.click();
  const benchmark = await (await page.request.get("/api/benchmarks")).json();
  // Controlled fixture generation crosses the test server's MockTransport only.
  const seeded = await page.request.post("/api/evaluations", {
    data: {
      dataset_id: benchmark.dataset_id,
      version: benchmark.version,
      case_ids: ["q05", "q06"],
      pipeline: "agentic",
      confirm_paid_calls: true,
      max_spend_usd: 1,
      max_total_tokens: 100000,
    },
  });
  expect(seeded.status()).toBe(202);
  const source = await finish(page, (await seeded.json()).id);
  expect(source.metrics.accuracy).toBe(0.5);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Stored evaluation summary" }),
  ).toBeVisible();
  if (await override.count()) await override.click();
  await openEvaluationSetup(page);await page.getByLabel("Saved prediction source").selectOption(source.id);
  async function replay() {
    const accepted = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/evaluations/offline") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Start offline replay", exact: true })
      .click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    const job = await finish(page, (await response.json()).id);
    await expect(
      page.locator(`a[href="/api/evaluations/${job.id}/report.json"]`),
    ).toHaveCount(1);
    await expect(page.getByLabel("Current evaluation state")).toHaveText(
      "completed",
    );
    expect(job.provider_calls).toBe(0);
    return job;
  }
  const first = await replay();
  expect(first.metrics.correct_count).toBe(1);
  expect(first.metrics.incorrect_count).toBe(1);
  expect(first.metrics.missing_predictions).toBe(43);
  const summary = page.getByRole("region", {
    name: "Stored evaluation summary",
  });
  await expect(summary).toContainText("50.0% · 1 correct / 2 scored");
  await expect(summary).toContainText("43 unscored");
  await shot(page, "summary-breakdowns");
  await page
    .getByLabel("Filter outcome", { exact: true })
    .selectOption("Incorrect");
  await expect(
    page
      .getByRole("table", { name: "Evaluation questions" })
      .locator("tbody tr"),
  ).toHaveCount(1);
  await shot(page, "failures-filtered");
  await page.getByRole("button", { name: "Inspect q05", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Expected result");
  await expect(drawer).toContainText("Actual result");
  await expect(drawer).toContainText("Unmatched");
  await expect(drawer.getByRole("heading", {name:"Predicted SQL",exact:true})).toBeVisible();
  await expect(drawer.locator("pre").first()).toContainText("SELECT");
  await shot(page, "detail-diff");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Inspect q05", exact: true }),
  ).toBeFocused();
  const second = await replay();
  await page.getByLabel("Earlier run", { exact: true }).selectOption(first.id);
  await page.getByLabel("Later run", { exact: true }).selectOption(second.id);
  await expect(
    page.getByRole("region", { name: "Run comparison" }),
  ).toContainText("Unchanged: 2");
  await expect(
    page.getByRole("region", { name: "Run comparison" }),
  ).toContainText("Unscored in one or both runs: 43");
  await shot(page, "comparable");
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page
    .locator(".benchmark-case")
    .filter({ hasText: /q05 ·/ })
    .getByRole("checkbox")
    .check();
  await page
    .locator(".benchmark-case")
    .filter({ hasText: /q06 ·/ })
    .getByRole("checkbox")
    .check();
  const partial = await replay();
  expect(partial.case_ids).toHaveLength(2);
  await expect(summary).toContainText("Partial run: 2 of 45 questions");
  await expect(
    summary.getByRole("heading", { name: "Partial-run accuracy" }),
  ).toBeVisible();
  await shot(page, "partial");
  await page.getByLabel("Later run", { exact: true }).selectOption(partial.id);
  await expect(
    page.getByText(/Not comparable: Question sets differ/),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Per-question changes" }),
  ).toHaveCount(0);
  await shot(page, "not-comparable");
  await page.getByLabel("Compare overlapping questions only").check();
  await expect(
    page.getByText("Overlapping questions only: 2 of 45 / 2."),
  ).toBeVisible();
  await openEvaluationSetup(page);
  await page
    .getByLabel("Evaluation mode", { exact: true })
    .selectOption("paid");
  await expect(
    page.getByRole("button", { name: "Run evaluation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Runs the AI on every selected question/),
  ).toBeVisible();
  await shot(page, "live-budget");
  await page
    .getByLabel(
      "I authorize paid provider calls within these displayed limits.",
    )
    .check();
  await expect(
    page.getByRole("button", { name: "Run evaluation", exact: true }),
  ).toBeEnabled();
  await openEvaluationSetup(page);
  await page
    .getByLabel("Evaluation mode", { exact: true })
    .selectOption("offline");
  await shot(page, "offline-label");
  // Keyboard-only filter, drawer open, trap and close pass after setup.
  async function focus(target: ReturnType<Page["getByRole"]>) {
    for (let i = 0; i < 220; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw Error("Unreachable keyboard control");
  }
  const search = page.getByRole("searchbox", { name: "Search questions" });
  await focus(search);
  await page.keyboard.type("q05");
  const inspect = page.getByRole("button", {
    name: "Inspect q05",
    exact: true,
  });
  await focus(inspect);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Close details" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByText("Technical details", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close details" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspect).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await shot(page, "mobile");
  expect(errors).toEqual([]);
  for (const id of [first.id, second.id, partial.id, source.id])
    expect(
      (
        await page.request.delete("/api/evaluations/" + id + "/record")
      ).status(),
    ).toBe(204);
});
