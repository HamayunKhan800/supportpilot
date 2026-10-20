import { connection } from "next/server";
import { withRoute } from "@/server/platform/http";

/**
 * Liveness probe: the process is up and serving requests. It deliberately does
 * NOT touch the database, so a DB outage doesn't cause restart loops.
 * `connection()` opts out of build-time prerendering (Cache Components),
 * so this always reflects the live process.
 */
export const GET = withRoute("health", async () => {
  await connection();
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
});
