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
      exclude: ["src/server/platform/db/**"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
