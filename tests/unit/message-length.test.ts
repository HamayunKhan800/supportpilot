import { describe, expect, it } from "vitest";
import { isLongMessage, LONG_MESSAGE } from "@/lib/message-length";

describe("long ticket messages start collapsed", () => {
  it("leaves ordinary messages alone", () => {
    expect(isLongMessage("Hi, which payment methods do you accept?")).toBe(false);
    expect(isLongMessage("a".repeat(LONG_MESSAGE.chars))).toBe(false);
    expect(isLongMessage(Array(LONG_MESSAGE.lines).fill("line").join("\n"))).toBe(false);
  });

  it("collapses a message over either limit", () => {
    expect(isLongMessage("a".repeat(LONG_MESSAGE.chars + 1))).toBe(true);
    expect(
      isLongMessage(
        Array(LONG_MESSAGE.lines + 1)
          .fill("log line")
          .join("\n"),
      ),
    ).toBe(true);
  });
});
