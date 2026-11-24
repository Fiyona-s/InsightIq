import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "workspace.spec.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:8080",
    channel: "chrome",
    reducedMotion: "reduce",
  },
  workers: 1,
  reporter: "list",
});
