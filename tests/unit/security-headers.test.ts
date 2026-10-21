import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  createNonce,
  normalizeFrameAncestors,
  securityHeaders,
} from "@/server/platform/security-headers";

const nonce = "dGVzdC1ub25jZS0xMjM0NQ==";
const csp = (o: Partial<Parameters<typeof contentSecurityPolicy>[0]> = {}) =>
  contentSecurityPolicy({ nonce, isDevelopment: false, isProduction: true, ...o });
const directive = (policy: string, name: string) =>
  policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("security headers (NFR-SEC5)", () => {
  it("denies framing by default", () => {
    const h = securityHeaders({ nonce, isProduction: false });
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("adds HSTS only in production", () => {
    expect(securityHeaders({ nonce, isProduction: false })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders({ nonce, isProduction: true })["Strict-Transport-Security"]).toMatch(
      /max-age=\d+/,
    );
  });

  it("allows an explicit https origin allowlist and drops X-Frame-Options", () => {
    const h = securityHeaders({ nonce, isProduction: true, frameAncestors: "'self' https://*.e2b.app" });
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'self' https://*.e2b.app");
    expect(h["X-Frame-Options"]).toBeUndefined();
  });

  it.each(["'none'; script-src *", "*", "http://insecure.example", "https://ok.example; default-src *"])(
    "rejects unsafe frame-ancestors value %s",
    (value) => {
      expect(normalizeFrameAncestors(value)).toBe("'none'");
    },
  );
});

describe("nonce-based CSP (T11 XSS)", () => {
  it("allows scripts only via the per-request nonce with strict-dynamic", () => {
    const p = csp();
    expect(directive(p, "script-src")).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(directive(p, "style-src")).toBe(`style-src 'self' 'nonce-${nonce}'`);
  });

  it("never allows unsafe-inline, and unsafe-eval only in development", () => {
    expect(csp()).not.toContain("unsafe-inline");
    expect(csp()).not.toContain("unsafe-eval");
    expect(directive(csp({ isDevelopment: true, isProduction: false }), "script-src")).toContain(
      "'unsafe-eval'",
    );
    expect(csp({ isDevelopment: true, isProduction: false })).not.toContain("unsafe-inline");
  });

  it("locks down defaults, base URI, forms and plugins", () => {
    const p = csp();
    for (const d of ["default-src 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"]) {
      expect(p).toContain(d);
    }
    expect(p).toContain("upgrade-insecure-requests");
    expect(csp({ isProduction: false })).not.toContain("upgrade-insecure-requests");
  });

  it("rejects a malformed nonce instead of emitting a broken policy", () => {
    expect(() => csp({ nonce: "short" })).toThrow();
    expect(() => csp({ nonce: "abc'; script-src *; x='0123456789" })).toThrow();
  });

  it("creates a fresh 128-bit nonce each time", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(() => csp({ nonce: a })).not.toThrow();
  });
});
