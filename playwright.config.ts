import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (strict CSP, no dev-only relaxations).
 * Locally: `pnpm build && pnpm test:e2e` (starts the standalone server).
 * Rate limiting is disabled for this server only: one IP creates several accounts within
 * a minute. Rate limiting itself is covered by tests/integration/auth.test.ts.
 * The background worker runs too (from source, with the mock AI provider), so uploaded
 * documents really get processed; the bundled worker is covered by the smoke tests.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  // Visual regression baselines (tests/e2e/visual.spec.ts): one folder per project, no OS suffix
  // (local runs and CI both use Linux and the bundled Chromium). A small tolerance absorbs
  // anti-aliasing noise; a real layout or colour change is far larger.
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /(accessibility|drafts|settings|review|analytics|theme|shell|visual)\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "node scripts/start-standalone.mjs",
      url: `${baseURL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(PORT),
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        AI_PROVIDER: "mock",
        BETTER_AUTH_URL: baseURL,
        AUTH_RATE_LIMIT_ENABLED: "false",
        PORTAL_RATE_LIMIT_ENABLED: "false",
        AUTH_PASSWORD_BREACH_CHECK: "false",
        // The evaluation Review page (M6), for the reviewers tests/e2e/review.spec.ts signs in as.
        EVAL_REVIEWER_EMAILS: "reviewer-desktop@e2e.test,reviewer-mobile@e2e.test",
      },
    },
    {
      name: "worker",
      command: "pnpm -s worker",
      // No port: ready once it logs that it has started (Playwright `wait.stdout`).
      wait: { stdout: /worker started/ },
      timeout: 60_000,
      env: { NODE_ENV: "production", AI_PROVIDER: "mock" },
    },
  ],
});
