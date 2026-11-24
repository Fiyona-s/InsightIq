import { test } from "@playwright/test";
import fs from "node:fs";

/**
 * Stage 7 tooling (not part of the suites): captures the same states of Home, Ask, Datasets and Dashboards into
 * $CARD_OUT so the screenshots taken before and after adopting the shared Card can be compared pixel by pixel.
 * Run with: CARD_OUT=/path npx playwright test --config playwright.card.config.ts
 */
const out = process.env.CARD_OUT!;
test.use({ storageState: { cookies: [], origins: [] } });

test("capture panels", async ({ page }) => {
  test.setTimeout(240000);
  fs.mkdirSync(out, { recursive: true });
  const styles: Record<string, unknown> = {};
  const dump = async (tag: string) => {
    styles[tag] = await page.evaluate(() => Object.fromEntries([".question-composer", ".setup-guide", ".home-welcome", ".analyst-empty", ".premium-empty", ".dashboard-manager"].map((sel) => {
      const el = document.querySelector(sel); if (!el) return [sel, null];
      const c = getComputedStyle(el);
      return [sel, Object.fromEntries(["paddingTop", "paddingLeft", "borderTopWidth", "borderTopStyle", "borderTopColor", "borderTopLeftRadius", "backgroundColor", "boxShadow", "marginBottom", "display"].map((k) => [k, (c as any)[k]]))];
    })));
  };
  const shoot = async (hash: string, name: string) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/#" + hash);
      await page.reload();
      await page.waitForTimeout(900);
      await page.addStyleTag({ content: "*{caret-color:transparent!important;animation:none!important;transition:none!important}" });
      await page.mouse.move(2, 2);
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
      if (width === 1280) await dump(name);
    }
  };
  await page.goto("/#overview");
  await page.evaluate(() => localStorage.setItem("insightiq-technical-details-v1", "false"));
  await shoot("overview", "home-empty");
  await shoot("analyst", "ask-empty");
  await shoot("datasets", "datasets-empty");
  await shoot("dashboards", "dashboards-empty");
  const r = await page.request.post("/api/datasets", { multipart: { file: { name: "visual-fixture.csv", mimeType: "text/csv", buffer: Buffer.from("id,revenue,region\n001,1250,North\n002,20,South\n003,300,East\n") } } });
  const d = await r.json();
  await shoot("overview", "home-setup");
  await shoot("datasets", "datasets-one");
  await shoot("analyst", "ask-ready");
  const run = await (await page.request.post("/api/analyst/runs", { data: { dataset_id: d.id, question: "What is the total revenue?", type_mapping: { revenue: "DOUBLE" } } })).json();
  for (let i = 0; i < 40; i++) { const s = (await (await page.request.get(`/api/analyst/runs/${run.id}`)).json()).status; if (s === "succeeded") break; await page.waitForTimeout(250); }
  const chart = await (await page.request.post("/api/saved-charts", { data: { run_id: run.id, title: "Visual total", persist_snapshot_confirmed: true } })).json();
  const doc = await (await page.request.post("/api/dashboards", { data: { title: "Visual board" } })).json();
  await page.request.put(`/api/dashboards/${doc.id}`, { data: { title: "Visual board", description: "", revision: doc.revision, filters: [], widgets: [{ chart_id: chart.id, kind: "chart", title: "Visual total", width: 6, height: 4 }] } });
  await shoot("overview", "home-active");
  await shoot("dashboards", "dashboards-board");
  fs.writeFileSync(`${out}/styles.json`, JSON.stringify(styles, null, 1));
});
