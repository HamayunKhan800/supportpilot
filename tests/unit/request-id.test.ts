import { describe, expect, it } from "vitest";
import { resolveRequestId } from "@/server/platform/request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request id", () => {
  it("keeps a safe incoming id", () => {
    expect(resolveRequestId("abc_DEF-12345")).toBe("abc_DEF-12345");
  });
  it.each([
    ["missing", null],
    ["too short", "abc"],
    ["too long", "a".repeat(65)],
    ["log injection", "abcdefgh\nlevel=fatal"],
    ["special chars", "<script>alert(1)</script>"],
  ])("replaces %s id with a UUID", (_label, value) => {
    expect(resolveRequestId(value)).toMatch(UUID);
  });
});
