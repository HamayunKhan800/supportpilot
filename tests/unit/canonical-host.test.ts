import { describe, expect, it } from "vitest";

import { canonicalRedirect } from "@/server/platform/canonical-host";

const prod = (host: string | null, pathAndQuery = "/", canonicalUrl = "https://supportpilot.example.com") =>
  canonicalRedirect({ host, pathAndQuery, canonicalUrl, isProduction: true })?.toString() ?? null;

describe("one public address (plan M8 step 2)", () => {
  it("sends the run.app address to the same path on the real domain", () => {
    expect(prod("supportpilot-abc123-ew.a.run.app", "/p/nimbus-demo?x=1")).toBe(
      "https://supportpilot.example.com/p/nimbus-demo?x=1",
    );
    expect(prod("SUPPORTPILOT-ABC123-EW.A.RUN.APP:443", "/sign-in")).toBe(
      "https://supportpilot.example.com/sign-in",
    );
  });

  it("leaves the real domain, local runs, probes and other hosts alone", () => {
    expect(prod("supportpilot.example.com")).toBeNull();
    expect(prod("supportpilot.example.com:443")).toBeNull();
    expect(prod("localhost:3000")).toBeNull();
    expect(prod("10.0.0.5:8080")).toBeNull();
    expect(prod("evil.test")).toBeNull();
    expect(prod(null)).toBeNull();
  });

  it("leaves a staging service alone when its own address is the run.app URL", () => {
    expect(prod("staging-abc-ew.a.run.app", "/", "https://staging-abc-ew.a.run.app")).toBeNull();
  });

  it("only in production, and only with a valid app URL", () => {
    expect(
      canonicalRedirect({
        host: "x.a.run.app",
        pathAndQuery: "/",
        canonicalUrl: "https://supportpilot.example.com",
        isProduction: false,
      }),
    ).toBeNull();
    expect(prod("x.a.run.app", "/", "not a url")).toBeNull();
  });

  it("can't be steered to another site by the path", () => {
    expect(prod("x.a.run.app", "//evil.test/a")).toBe("https://supportpilot.example.com//evil.test/a");
    expect(prod("x.a.run.app", "@evil.test")).toBe("https://supportpilot.example.com/@evil.test");
  });
});
