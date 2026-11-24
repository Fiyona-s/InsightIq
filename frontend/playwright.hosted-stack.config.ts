import { defineConfig } from "@playwright/test";

/**
 * Accounts A5: the hosted browser suite run THROUGH the proxy of a real stack (Caddy over HTTPS with its own test CA, the built
 * front-end, the production-configured app). HOSTED_STACK_URL is the stack's public address (for example https://tstb.localhost:9443),
 * HOSTED_E2E_OWNERS_FILE the owners file written by deploy/tests/prepare_hook.sh. No dev server, no Vite proxy. Controlled AI provider only.
 * Any Content-Security-Policy violation fails the test that caused it (see e2e/hosted-helpers.ts).
 */
const url = process.env.HOSTED_STACK_URL;
if (!url) throw new Error("Set HOSTED_STACK_URL to the stack's public address (see deploy/tests/run_stacks.py).");
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["hosted-*.spec.ts"],
  workers: 1,
  reporter: "list",
  use: { baseURL: url, channel: "chrome", reducedMotion: "reduce", actionTimeout: 15000, ignoreHTTPSErrors: true },   // the test CA is not in the browser's store
});
