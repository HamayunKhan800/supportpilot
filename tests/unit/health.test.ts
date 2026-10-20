import { describe, expect, it } from "vitest";
import { checkDatabase } from "@/server/platform/health";

describe("checkDatabase", () => {
  it("reports ok when the query succeeds", async () => {
    const r = await checkDatabase({ query: async () => ({ rows: [{ "?column?": 1 }] }) } as never);
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports failure when the query rejects", async () => {
    const r = await checkDatabase({ query: async () => Promise.reject(new Error("ECONNREFUSED")) } as never);
    expect(r).toMatchObject({ ok: false, error: "ECONNREFUSED" });
  });

  it("times out a hung query", async () => {
    const r = await checkDatabase({ query: () => new Promise(() => {}) } as never, 50);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout/);
    expect(r.latencyMs).toBeLessThan(1_000);
  });
});

describe("checkDatabase error reporting", () => {
  it("falls back to the error code when the message is empty (e.g. ECONNREFUSED)", async () => {
    const err = Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
    const r = await checkDatabase({ query: async () => Promise.reject(err) } as never);
    expect(r.error).toBe("ECONNREFUSED");
  });
});
