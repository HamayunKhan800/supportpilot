import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/server/platform/env";
import { clientIp, rateLimitKey, windowStart } from "@/server/platform/rate-limit";

describe("rate limiting helpers (D7)", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    resetEnvCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("aligns fixed windows", () => {
    expect(windowStart(new Date("2026-01-01T00:09:59Z"), 600).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(windowStart(new Date("2026-01-01T00:10:00Z"), 600).toISOString()).toBe("2026-01-01T00:10:00.000Z");
  });

  it("never stores raw identifiers in keys", () => {
    const key = rateLimitKey("portal-ip", "ws1", "203.0.113.7");
    expect(key).toMatch(/^portal-ip:[A-Za-z0-9_-]{32}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(rateLimitKey("portal-ip", "ws1", "203.0.113.7")).toBe(key);
    expect(rateLimitKey("portal-ip", "ws2", "203.0.113.7")).not.toBe(key);
  });

  it("ignores X-Forwarded-For unless proxy headers are trusted", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" });
    expect(clientIp(h, false)).toBe("unknown");
    // Behind one trusted proxy, the rightmost entry is what that proxy saw; the left
    // part is client-controlled and spoofable.
    expect(clientIp(h, true)).toBe("203.0.113.7");
    expect(clientIp(new Headers(), true)).toBe("unknown");
  });
});
