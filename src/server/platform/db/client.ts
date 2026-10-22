import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseEnv } from "../env";
import { logger } from "../logger";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

interface DbHandles {
  pool: Pool;
  db: Database;
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __spDb?: DbHandles };

export function createPool(
  connectionString: string,
  opts: { max: number; statementTimeoutMs: number },
): Pool {
  const pool = new Pool({
    connectionString,
    max: opts.max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: opts.statementTimeoutMs,
    application_name: "supportpilot",
  });
  // An idle client error must not crash the process. Log it, and pg will discard the client.
  pool.on("error", (err) => logger.error({ err: { message: err.message } }, "postgres pool error"));
  return pool;
}

export function getDb(): DbHandles {
  if (!globalForDb.__spDb) {
    // Database settings only, so the worker can use the pool without web-app secrets.
    const env = getDatabaseEnv();
    const pool = createPool(env.DATABASE_URL, {
      max: env.DATABASE_POOL_MAX,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    });
    globalForDb.__spDb = { pool, db: drizzle(pool, { schema }) };
  }
  return globalForDb.__spDb;
}
