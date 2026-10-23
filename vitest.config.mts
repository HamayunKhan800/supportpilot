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
        // Same for the demo knowledge base: 5 tests in tests/integration/kb-demo-seed.test.ts
        // (idempotency, concurrent runs, queued jobs, limits), mutation-checked.
        "src/server/modules/kb/demo-seed.ts",
        // Re-embedding orchestration over the DB (locks, races, resumability); 5 tests in
        // tests/integration/kb-reembed.test.ts, mutation-checked.
        "src/server/modules/kb/reembed.ts",
        // SQL only (constraints, composite tenant FK, lifecycle guards, cascades); 20 tests
        // in tests/integration/kb-repository.test.ts, mutation-checked.
        "src/server/modules/kb/repository.ts",
        // Runs inside a worker_thread, which v8 coverage does not instrument. Exercised for
        // real (valid, 50/51-page, encrypted, scanned, truncated PDFs) by
        // tests/unit/kb-pdf-and-prepare.test.ts; key checks mutation-tested.
        "src/server/modules/kb/pdf/thread.ts",
        // Job orchestration over the DB (locks, transactions, retries, races); 12 tests in
        // tests/integration/kb-ingest-job.test.ts, mutation-checked.
        "src/server/modules/kb/ingest-job.ts",
        // Orchestration over the DB (upload transaction, caps, locks, hybrid search, audit);
        // 29 tests in tests/integration/kb-api.test.ts plus the generated API suite,
        // 20 deliberate breaks all caught.
        "src/server/modules/kb/service.ts",
        // pg-boss wiring (install, transactional enqueue); exercised end to end against
        // PostgreSQL in tests/integration/kb-ingest-job.test.ts.
        "src/server/platform/jobs/boss.ts",
        // SQL only (budget sum, atomic daily-cap upsert, usage insert); tested against
        // PostgreSQL in tests/integration/ai-ledger.test.ts, including concurrent reservations.
        "src/server/modules/ai/repository.ts",
        // Triage job and its SQL (locks, idempotency, overrides, audit-based "human set");
        // 26 tests in tests/integration/triage-job.test.ts, 16 deliberate breaks all caught.
        "src/server/modules/triage/{job,repository}.ts",
        // Draft engine and actions over the DB (retrieval, refusal gate, streaming, row and ticket
        // locks, audit); 34 tests in tests/integration/drafts.test.ts plus the generated API suite,
        // mutation-checked. The pure parts (prompt, citations, mock responder, serializer) are
        // unit-tested and stay included.
        "src/server/modules/drafts/{service,actions,repository}.ts",
        // AI settings over the DB (version-checked update, per-field audit, usage sums); 32 tests
        // in tests/integration/settings.test.ts, 6 deliberate breaks all caught. Limits and the
        // request schema are unit-tested and stay included.
        "src/server/modules/settings/{service,repository}.ts",
        // Review page (M6): SQL and the session/allowlist guard around it are covered by
        // tests/integration/eval-review.test.ts; the pure parts (nextUnreviewed, allowlist
        // parsing, schemas, content) are unit-tested and stay included.
        "src/server/modules/eval-review/{repository,service}.ts",
        // Database-only: covered by tests/integration/eval-runner.test.ts (the runner's store).
        "src/server/modules/eval/repository.ts",
        // Analytics SQL and its role check (counts, nearest-rank percentiles, UTC windows, tenant
        // filters); 12 tests in tests/integration/analytics.test.ts, 8 deliberate breaks all caught.
        // The pure parts (periods, summary reading, formatting, chart geometry) are unit-tested.
        "src/server/modules/analytics/{repository,service}.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
