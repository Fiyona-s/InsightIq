import { defineConfig } from "@playwright/test";

/** UI-CLEAN screenshot and layout checks: the current UI (5174) next to the UI as it was before the stage (BEFORE_DIR, 5178), one controlled backend (8001). */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["uiclean-*.spec.ts"],
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5174", channel: "chrome", reducedMotion: "reduce", screenshot: "only-on-failure",
    storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5174", localStorage: [{ name: "insightiq-default-currency-v1", value: "none" }] }, { origin: "http://127.0.0.1:5178", localStorage: [{ name: "insightiq-default-currency-v1", value: "none" }] }] } },
  webServer: [
    { command: "../.venv/bin/uvicorn tests.e2e_server:app --app-dir ../backend --host 127.0.0.1 --port 8001", url: "http://127.0.0.1:8001/api/health", reuseExistingServer: false },
    { command: "npm run dev -- --port 5174 --strictPort", url: "http://127.0.0.1:5174", env: { API_PROXY_TARGET: "http://127.0.0.1:8001" }, reuseExistingServer: false },
    ...(process.env.BEFORE_DIR ? [{ command: "npm run dev -- --port 5178 --strictPort", cwd: process.env.BEFORE_DIR, url: "http://127.0.0.1:5178", env: { API_PROXY_TARGET: "http://127.0.0.1:8001" }, reuseExistingServer: false }] : []),
  ],
});
