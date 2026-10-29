import { describe, expect, it } from "vitest";
import { demoEmail, demoErrorFor, isSameOrigin, parseDemoRole } from "@/server/platform/auth/demo-sign-in";

describe("demo sign-in", () => {
  it("accepts only the three demo roles", () => {
    expect(parseDemoRole("agent")).toBe("agent");
    expect(parseDemoRole("owner")).toBe("owner");
    for (const bad of ["", "Agent", "root", "agent@x.com", null, undefined, 1])
      expect(parseDemoRole(bad)).toBeNull();
  });

  it("builds the demo address on the configured domain", () => {
    expect(demoEmail("admin", "demo.example.com")).toBe("admin@demo.example.com");
  });

  it("refuses cross-site and missing origins", () => {
    const app = "https://app.example.com";
    expect(isSameOrigin(new Headers({ origin: "https://app.example.com" }), app)).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example" }), app)).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "http://app.example.com" }), app)).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "null" }), app)).toBe(false);
    expect(isSameOrigin(new Headers(), app)).toBe(false);
  });

  it("maps a rate limit to a wait message and anything else to a retry", () => {
    expect(demoErrorFor(429)).toBe("busy");
    expect(demoErrorFor(401)).toBe("unavailable");
    expect(demoErrorFor(500)).toBe("unavailable");
  });
});
