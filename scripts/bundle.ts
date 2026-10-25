/**
 * Bundles the Node entry points that run outside Next.js into self-contained files in
 * .build/ (plan M4 D13). The Next.js standalone output only contains what the web server
 * needs, so the worker and the migration script carry their own dependencies.
 *
 *   .build/migrate.mjs     release step: SQL migrations + pg-boss install
 *   .build/worker.mjs      background worker
 *   .build/pdf-thread.mjs  PDF parsing thread, started by the worker (separate file by design)
 *   .build/start.mjs       container launcher: web server + worker in one container (plan M8 D2)
 *   .build/seed-demo.mjs   demo workspace seed and daily reset (plan M8 step 2)
 */
import { build } from "esbuild";

build({
  entryPoints: {
    migrate: "scripts/migrate.ts",
    worker: "src/worker/index.ts",
    "pdf-thread": "src/server/modules/kb/pdf/thread.ts",
    start: "scripts/start-container.ts",
    "seed-demo": "scripts/seed-demo.ts",
  },
  outdir: ".build",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Optional native driver that `pg` only loads on request.
  external: ["pg-native"],
  // Some bundled CommonJS dependencies call require(); give ESM output a real one. The import
  // is aliased because bundled ESM code (Sentry's SDK) imports createRequire at top level too,
  // and a second top-level binding of the same name stops the file from loading (M6 step 4).
  banner: {
    js: "import { createRequire as __spCreateRequire } from 'node:module'; const require = __spCreateRequire(import.meta.url);",
  },
  define: { __SP_PDF_THREAD_FILE__: JSON.stringify("pdf-thread.mjs") },
  logLevel: "warning",
}).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
