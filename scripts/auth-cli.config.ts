/**
 * Config entry point for the Better Auth CLI only (`pnpm auth:generate`), which needs
 * a module exporting `auth`. Uses placeholder values; never imported by the app.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { createAuth } from "../src/server/platform/auth/auth";
import * as schema from "../src/server/platform/db/schema";

export const auth = createAuth(drizzle.mock({ schema }), {
  NODE_ENV: "development",
  BETTER_AUTH_SECRET: "cli-placeholder-secret-not-used-at-runtime-0000",
  BETTER_AUTH_URL: "http://localhost:3000",
  AUTH_TRUSTED_ORIGINS: [],
  AUTH_RATE_LIMIT_ENABLED: true,
  AUTH_PASSWORD_BREACH_CHECK: true,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
  TRUST_PROXY_HEADERS: false,
  DEMO_EMAIL_DOMAIN: "demo.example.com",
});
