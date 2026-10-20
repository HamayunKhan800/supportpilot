import { connection } from "next/server";
import { getDb } from "@/server/platform/db/client";
import { Errors } from "@/server/platform/errors";
import { checkDatabase } from "@/server/platform/health";
import { withRoute } from "@/server/platform/http";

/** Readiness probe: can this instance serve traffic (DB reachable)? */
export const GET = withRoute("ready", async (_req, { log }) => {
  await connection();
  const db = await checkDatabase(getDb().pool);
  if (!db.ok) {
    log.error({ check: "database", error: db.error, latencyMs: db.latencyMs }, "readiness check failed");
    throw Errors.serviceUnavailable("A required dependency is unavailable.");
  }
  return Response.json(
    { status: "ready", checks: { database: { status: "ok", latencyMs: db.latencyMs } } },
    { headers: { "cache-control": "no-store" } },
  );
});
