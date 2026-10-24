import { describe, expect, it } from "vitest";
import { initials } from "@/lib/initials";

describe("initials (avatars in the user menu and on the Members page)", () => {
  it("takes the first and last word", () => {
    expect(initials("Olivia Owner")).toBe("OO");
    expect(initials("  Mary  Ann   Smith ")).toBe("MS");
  });
  it("uses two letters of a single name, and never returns an empty string", () => {
    expect(initials("plato")).toBe("PL");
    expect(initials("Q")).toBe("Q");
    expect(initials("   ")).toBe("?");
  });
});
