import { describe, expect, it } from "vitest";
import { normalizeFrameAncestors, securityHeaders } from "@/server/platform/security-headers";

describe("security headers (NFR-SEC5)", () => {
  it("denies framing by default", () => {
    const h = securityHeaders({ isProduction: false });
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("adds HSTS only in production", () => {
    expect(securityHeaders({ isProduction: false })["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders({ isProduction: true })["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  it("allows an explicit https origin allowlist and drops X-Frame-Options", () => {
    const h = securityHeaders({ isProduction: true, frameAncestors: "'self' https://*.e2b.app" });
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
