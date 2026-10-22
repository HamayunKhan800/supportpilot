import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src") } },
  test: {
    environment: "node",
    env: { NODE_ENV: "test", LOG_LEVEL: "silent" },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/support/global-setup.ts"],
          setupFiles: ["tests/integration/support/env.ts"],
          // Integration tests share one real database. Run files serially.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: { name: "smoke", include: ["tests/smoke/**/*.test.ts"], testTimeout: 15_000 },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts"],
      // Covered by integration/smoke tests instead (need a real DB / server).
      exclude: [
        "src/server/platform/db/**",
        // Wiring around Better Auth + Postgres; exercised by tests/integration/*.
        "src/server/platform/auth/{auth,index,context,workspace-settings}.ts",
        // Thin DB queries + auth wiring; tested against PostgreSQL in
        // tests/integration/workspace-service.test.ts (tenant isolation, roles, paging).
        "src/server/modules/workspaces/{repository,service}.ts",
        // SQL only (constraints, locking, search, keyset paging); tested against PostgreSQL
        // in tests/integration/tickets-repository.test.ts.
        "src/server/modules/tickets/repository.ts",
        // Orchestration over the DB (transactions, locks, audit); 26 tests in
        // tests/integration/tickets-service.test.ts, mutation-checked.
        "src/server/modules/tickets/service.ts",
        // Inserts the demo data in one transaction; tested against PostgreSQL in
        // tests/integration/demo-seed.test.ts. The data itself is unit-tested.
        "src/server/modules/tickets/demo/seed.ts",
        // SQL only (constraints, composite tenant FK, lifecycle guards, cascades); 20 tests
        // in tests/integration/kb-repository.test.ts, mutation-checked.
        "src/server/modules/kb/repository.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
