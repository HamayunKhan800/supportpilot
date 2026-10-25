import { describe, expect, it } from "vitest";
import { stripNul, stripNulDeep } from "@/server/platform/text";

describe("NUL removal (M7-19)", () => {
  it("removes NUL from strings and from every string inside parsed JSON, keys included", () => {
    expect(stripNul("a\u0000b\u0000")).toBe("ab");
    expect(
      stripNulDeep({ "n\u0000ote": "x\u0000", list: ["\u0000y", 1, null, true], deep: { z: "\u0000" } }),
    ).toEqual({
      note: "x",
      list: ["y", 1, null, true],
      deep: { z: "" },
    });
  });
});
