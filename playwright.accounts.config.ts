import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the account emails (docs/plans/accounts-and-email.md): sign-up with a
 * verification code, forgot and reset password, and the Google/GitHub buttons. A separate
 * server with email on (in-memory outbox) and placeholder provider keys, so the main suite
 * keeps testing the default setup (email off). Run after `pnpm build`: `pnpm test:e2e:accounts`.
 * The provider keys are fake: the tests stop at the provider's address and never call it.
 */
const PORT = Number(process.env.E2E_ACCOUNTS_PORT ?? 3101);
const baseURL = `http://localhost:${PORT}`;
export const OUTBOX_TOKEN = process.env.E2E_OUTBOX_TOKEN ?? "e2e-outbox-token-placeholder-not-a-secret";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /accounts\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-accounts" }]]
    : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "accounts-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "accounts-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
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
      AUTH_PASSWORD_BREACH_CHECK: "false",
      EMAIL_PROVIDER: "outbox",
      EMAIL_FROM: "SupportPilot <no-reply@example.com>",
      EMAIL_OUTBOX_TOKEN: OUTBOX_TOKEN,
      GOOGLE_CLIENT_ID: "e2e-google-client-id",
      GOOGLE_CLIENT_SECRET: "e2e-google-placeholder",
      GITHUB_CLIENT_ID: "e2e-github-client-id",
      GITHUB_CLIENT_SECRET: "e2e-github-placeholder",
    },
  },
});
