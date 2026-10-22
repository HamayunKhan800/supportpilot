import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Note: staying on ESLint 9 until eslint-plugin-jsx-a11y / react / import declare
// ESLint 10 support (checked 2026-10-20 via `pnpm peers check`).
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "no-console": ["error", { allow: ["error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The PDF thread is run directly by Node (type stripping) inside a worker_thread, so it
    // must not depend on path aliases or other project modules at runtime (plan M4 D5).
    files: ["src/server/modules/kb/pdf/thread.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "./*", "../*"],
              allowTypeImports: true,
              message: "The PDF thread may import only Node built-ins, unpdf, and types.",
            },
          ],
        },
      ],
    },
  },
  {
    // CLI scripts write structured JSON to stdout by design.
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Architecture rule (docs/02-architecture.md §2): route handlers and UI must go
    // through services and never touch the database layer directly. Health probes are the
    // documented exception.
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/api/ready/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/platform/db/*", "**/repository", "**/repositories/*"],
              message: "Use a service from src/server/modules instead of the DB layer.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", ".build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
