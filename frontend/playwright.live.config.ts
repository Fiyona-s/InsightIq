import { defineConfig } from "@playwright/test";

/**
 * Live walkthrough against the REAL app (default http://127.0.0.1:8080) with the real AI.
 * It works inside its own project "QA walkthrough - keep" and never deletes anything.
 *   npx playwright test --config playwright.live.config.ts            (records video)
 *   npx playwright test --config playwright.live.config.ts --headed   (watch it click)
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "qa-live-walkthrough.spec.ts",
  workers: 1,
  reporter: "list",
  timeout: 1_200_000,
  outputDir: "../docs/stage3/qa/test-results",
  use: {
    baseURL: process.env.LIVE_BASE_URL || "http://127.0.0.1:8080",
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    video: { mode: "on", size: { width: 1280, height: 800 } },
    launchOptions: { slowMo: 250 },
    reducedMotion: "reduce",
  },
});
