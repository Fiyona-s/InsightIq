import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["card-visual.spec.ts"],
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    channel: "chrome",
    reducedMotion: "reduce",
    storageState:{cookies:[],origins:[{origin:'http://127.0.0.1:5174',localStorage:[{name:'insightiq-technical-details-v1',value:'true'},{name:'insightiq-default-currency-v1',value:'none'}]}]},
  },
  webServer: [
    {
      command:
        "../.venv/bin/uvicorn tests.e2e_server:app --app-dir ../backend --host 127.0.0.1 --port 8001",
      url: "http://127.0.0.1:8001/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      env: { API_PROXY_TARGET: "http://127.0.0.1:8001" },
      reuseExistingServer: false,
    },
  ],
});
