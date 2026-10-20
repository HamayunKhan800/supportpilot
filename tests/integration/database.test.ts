import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "@/server/platform/db/client";
import { checkDatabase } from "@/server/platform/health";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");

let pool: Pool;

beforeAll(() => {
  pool = createPool(url, { max: 2, statementTimeoutMs: 5_000 });
});
afterAll(async () => {
  await pool.end();
});

describe("database migrations (real PostgreSQL)", () => {
  const migrationsFolder = path.resolve(__dirname, "../../drizzle");

  it("applies all migrations and enables pgvector", async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    const { rows } = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    expect(rows).toHaveLength(1);
  });

  it("is idempotent when re-run", async () => {
    await expect(migrate(drizzle(pool), { migrationsFolder })).resolves.not.toThrow();
  });

  it("supports vector similarity operators", async () => {
    const { rows } = await pool.query("SELECT ('[1,0,0]'::vector <=> '[1,0,0]'::vector) AS d");
    expect(Number(rows[0].d)).toBe(0);
  });

  it("enforces the statement timeout from pool config", async () => {
    const short = createPool(url, { max: 1, statementTimeoutMs: 200 });
    try {
      await expect(short.query("SELECT pg_sleep(2)")).rejects.toThrow(/statement timeout/);
    } finally {
      await short.end();
    }
  });
});

describe("readiness check (real PostgreSQL)", () => {
  it("is ok against a live database", async () => {
    expect((await checkDatabase(pool)).ok).toBe(true);
  });

  it("fails fast against an unreachable database", async () => {
    const bad = new Pool({
      connectionString: "postgres://x:y@127.0.0.1:1/none",
      connectionTimeoutMillis: 500,
    });
    try {
      const r = await checkDatabase(bad, 2_000);
      expect(r.ok).toBe(false);
    } finally {
      await bad.end();
    }
  });
});
