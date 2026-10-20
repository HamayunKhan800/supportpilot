import type { Pool } from "pg";

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Runs `SELECT 1` with a hard timeout so a hung DB cannot hang the readiness probe. */
export async function checkDatabase(pool: Pick<Pool, "query">, timeoutMs = 2_000): Promise<CheckResult> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    // Error text is for logs only and is not returned to clients. Node network
    // errors (e.g. AggregateError ECONNREFUSED) often have an empty message, so fall
    // back to the error code (verified M1: an empty message was logged during a DB outage).
    const e = err as Error & { code?: string };
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: e.message || e.code || e.name || "unknown error",
    };
  } finally {
    clearTimeout(timer);
  }
}
