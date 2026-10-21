import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/safe-redirect";

describe("safeRedirect (open-redirect protection)", () => {
  it.each(["/app", "/app/members", "/invite/abc123?x=1", "/app#top"])("keeps same-site path %s", (p) => {
    expect(safeRedirect(p)).toBe(p);
  });

  it.each([
    ["absolute URL", "https://evil.example.com"],
    ["protocol-relative", "//evil.example.com"],
    ["backslash trick", "/\\evil.example.com"],
    ["embedded backslash", "/app\\..\\//evil.example.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative without slash", "app"],
    ["control characters", "/\t/evil.example.com"],
    ["empty", ""],
  ])("rejects %s", (_label, p) => {
    expect(safeRedirect(p)).toBe("/app");
  });

  it("uses the given fallback", () => {
    expect(safeRedirect(null, "/")).toBe("/");
    expect(safeRedirect(undefined)).toBe("/app");
  });
});
