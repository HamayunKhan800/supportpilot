import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { installJobs } from "../../../src/server/platform/jobs/boss";

/** Applies all migrations and installs the job queues in the test database once. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  } finally {
    await pool.end();
  }
  await installJobs(url);
}
