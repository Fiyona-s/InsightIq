import { defineConfig } from "@playwright/test";

/**
 * Accounts A3: browser tests of HOSTED mode (AUTH_MODE=on): sign-in, the three roles, expired session, sign-out, first-login
 * password change. A throwaway API (tests/hosted_e2e_server.py on 8003, prepared by hosted_e2e_prepare.py) and the dev
 * frontend on 5176. Controlled provider only; no live AI. The local-mode suites are unchanged (playwright.analyst.config.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["hosted-*.spec.ts"],
  testIgnore: ["**/hosted-stack-*.spec.ts"],
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5176", channel: "chrome", reducedMotion: "reduce", actionTimeout: 15000 },
  webServer: [
    {
      command: "../.venv/bin/python ../backend/tests/hosted_e2e_prepare.py && ../.venv/bin/uvicorn tests.hosted_e2e_server:app --app-dir ../backend --host 127.0.0.1 --port 8003",
      url: "http://127.0.0.1:8003/api/health",
      reuseExistingServer: false,
      timeout: 180000,
    },
    { command: "npm run dev -- --port 5176 --strictPort", url: "http://127.0.0.1:5176", env: { API_PROXY_TARGET: "http://127.0.0.1:8003" }, reuseExistingServer: false },
  ],
});
