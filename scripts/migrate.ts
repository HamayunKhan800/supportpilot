/**
 * Release step, run before new code receives traffic (docs/02-architecture.md §7):
 *  1. applies committed SQL migrations from ./drizzle;
 *  2. installs or upgrades pg-boss's job tables and applies the queue settings (ADR-0005).
 * Bundled to a single file (.build/migrate.mjs) for the production image.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { installJobs } from "@/server/platform/jobs/boss";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(JSON.stringify({ level: "fatal", msg: "DATABASE_URL is not set" }));
    process.exit(1);
  }
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  // Production sets a 10 s statement_timeout on the database role (Neon ignores it as a
  // connection setting; plan M8, Neon finding). A long migration (an index build) must not
  // be cut off half way, so this one session lifts it. Queries on a client run in order,
  // so this runs before the first migration statement.
  pool.on("connect", (client) => void client.query("SET statement_timeout = 0"));
  const started = Date.now();
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
  await installJobs(url);
  console.log(JSON.stringify({ level: "info", msg: "migrations applied", durationMs: Date.now() - started }));
}

main().catch((err: Error) => {
  // Message only. Connection errors can echo connection details in stacks.
  console.error(JSON.stringify({ level: "fatal", msg: "migration failed", error: err.message }));
  process.exit(1);
});
