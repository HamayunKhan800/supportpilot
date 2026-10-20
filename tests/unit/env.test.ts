import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/platform/env";

const valid = { DATABASE_URL: "postgres://user:pass@localhost:5432/db" };

describe("env (NFR config fail-fast)", () => {
  it("parses a minimal valid environment and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(10_000);
  });

  it("coerces numeric strings", () => {
    expect(parseEnv({ ...valid, DATABASE_POOL_MAX: "5" }).DATABASE_POOL_MAX).toBe(5);
  });

  it("accepts postgresql:// scheme", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgresql://u:p@h/db" })).not.toThrow();
  });

  it("rejects a missing DATABASE_URL with the variable name", () => {
    expect(() => parseEnv({})).toThrowError(EnvValidationError);
    try {
      parseEnv({});
    } catch (e) {
      expect((e as EnvValidationError).issues.join()).toContain("DATABASE_URL");
    }
  });

  it("rejects non-postgres URLs", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@h/db" })).toThrowError(EnvValidationError);
  });

  it("rejects out-of-range pool size", () => {
    expect(() => parseEnv({ ...valid, DATABASE_POOL_MAX: "500" })).toThrowError(EnvValidationError);
  });

  it("never echoes secret values in the error message", () => {
    const secret = "sup3r-s3cret-pa55";
    try {
      parseEnv({ DATABASE_URL: `mysql://admin:${secret}@db/x`, DATABASE_POOL_MAX: secret });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });
});

describe("getEnv memoization", () => {
  it("reads process.env once and caches until reset", async () => {
    const { getEnv, resetEnvCache } = await import("@/server/platform/env");
    const original = process.env.DATABASE_URL;
    try {
      resetEnvCache();
      process.env.DATABASE_URL = "postgres://a:b@host1/db";
      expect(getEnv().DATABASE_URL).toBe("postgres://a:b@host1/db");
      process.env.DATABASE_URL = "postgres://a:b@host2/db";
      expect(getEnv().DATABASE_URL).toBe("postgres://a:b@host1/db");
      resetEnvCache();
      expect(getEnv().DATABASE_URL).toBe("postgres://a:b@host2/db");
    } finally {
      process.env.DATABASE_URL = original;
      resetEnvCache();
    }
  });
});
