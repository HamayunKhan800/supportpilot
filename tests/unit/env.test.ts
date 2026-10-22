import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/platform/env";

const AUTH = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};
const valid = { DATABASE_URL: "postgres://user:pass@localhost:5432/db", ...AUTH };

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
    expect(() => parseEnv({ ...AUTH, DATABASE_URL: "postgresql://u:p@h/db" })).not.toThrow();
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
    expect(() => parseEnv({ ...AUTH, DATABASE_URL: "mysql://u:p@h/db" })).toThrowError(EnvValidationError);
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

describe("env: auth settings (FR-A1, T3/T4)", () => {
  const issues = (src: Record<string, string>) => {
    try {
      parseEnv(src);
      return [];
    } catch (e) {
      return (e as EnvValidationError).issues;
    }
  };

  it("requires an auth secret of at least 32 characters", () => {
    expect(issues({ ...valid, BETTER_AUTH_SECRET: "short" }).join()).toContain("BETTER_AUTH_SECRET");
    const { BETTER_AUTH_SECRET: _omit, ...withoutSecret } = valid;
    expect(issues(withoutSecret).join()).toContain("BETTER_AUTH_SECRET");
  });

  it("requires BETTER_AUTH_URL to be http(s)", () => {
    expect(issues({ ...valid, BETTER_AUTH_URL: "ftp://x" }).join()).toContain("BETTER_AUTH_URL");
  });

  it("requires https in production except on loopback", () => {
    const prod = { ...valid, NODE_ENV: "production" };
    expect(issues({ ...prod, BETTER_AUTH_URL: "http://app.example.com" }).join()).toContain("https");
    expect(issues({ ...prod, BETTER_AUTH_URL: "https://app.example.com" })).toEqual([]);
    expect(issues({ ...prod, BETTER_AUTH_URL: "http://localhost:3000" })).toEqual([]);
  });

  it("parses trusted origins and rejects non-https entries", () => {
    const env = parseEnv({ ...valid, AUTH_TRUSTED_ORIGINS: "https://a.example.com, https://b.example.com" });
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(parseEnv(valid).AUTH_TRUSTED_ORIGINS).toEqual([]);
    expect(issues({ ...valid, AUTH_TRUSTED_ORIGINS: "http://evil.example.com" }).join()).toContain(
      "AUTH_TRUSTED_ORIGINS",
    );
  });

  it("enables rate limiting by default and allows an explicit opt-out", () => {
    expect(parseEnv(valid).AUTH_RATE_LIMIT_ENABLED).toBe(true);
    expect(parseEnv({ ...valid, AUTH_RATE_LIMIT_ENABLED: "false" }).AUTH_RATE_LIMIT_ENABLED).toBe(false);
  });

  it("checks breached passwords by default, rejects anything but true/false", () => {
    expect(parseEnv(valid).AUTH_PASSWORD_BREACH_CHECK).toBe(true);
    expect(parseEnv({ ...valid, AUTH_PASSWORD_BREACH_CHECK: "false" }).AUTH_PASSWORD_BREACH_CHECK).toBe(
      false,
    );
    // A typo must not silently disable the check.
    expect(issues({ ...valid, AUTH_PASSWORD_BREACH_CHECK: "no" }).join()).toContain(
      "AUTH_PASSWORD_BREACH_CHECK",
    );
  });

  it("limits the portal by default and never trusts proxy headers unless told to", () => {
    const env = parseEnv(valid);
    expect(env.PORTAL_RATE_LIMIT_ENABLED).toBe(true);
    expect(env.TRUST_PROXY_HEADERS).toBe(false);
    expect(parseEnv({ ...valid, TRUST_PROXY_HEADERS: "true" }).TRUST_PROXY_HEADERS).toBe(true);
    expect(issues({ ...valid, TRUST_PROXY_HEADERS: "yes" }).join()).toContain("TRUST_PROXY_HEADERS");
  });

  it("requires GitHub OAuth credentials as a pair", () => {
    expect(issues({ ...valid, GITHUB_CLIENT_ID: "id" }).join()).toContain("GITHUB_CLIENT_ID");
    expect(issues({ ...valid, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "s" })).toEqual([]);
  });
});

describe("getEnv memoization", () => {
  it("reads process.env once and caches until reset", async () => {
    const { getEnv, resetEnvCache } = await import("@/server/platform/env");
    const original = process.env.DATABASE_URL;
    process.env.BETTER_AUTH_SECRET ??= AUTH.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_URL ??= AUTH.BETTER_AUTH_URL;
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
