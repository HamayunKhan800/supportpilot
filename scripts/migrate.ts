/**
 * Applies committed SQL migrations from ./drizzle.
 * Run as a release step before new code receives traffic (docs/02-architecture.md §7).
 * Bundled to a single file (.build/migrate.mjs) for the production image.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(JSON.stringify({ level: "fatal", msg: "DATABASE_URL is not set" }));
    process.exit(1);
  }
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const started = Date.now();
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(
      JSON.stringify({ level: "info", msg: "migrations applied", durationMs: Date.now() - started }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  // Message only. Connection errors can echo connection details in stacks.
  console.error(JSON.stringify({ level: "fatal", msg: "migration failed", error: err.message }));
  process.exit(1);
});
