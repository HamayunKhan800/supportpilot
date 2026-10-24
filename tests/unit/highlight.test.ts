import { describe, expect, it } from "vitest";
import { highlightSegments, queryTerms } from "@/lib/highlight";

describe("queryTerms", () => {
  it("keeps meaningful words, lower-cased, without stop words or short words", () => {
    expect(queryTerms("How long do refunds take?")).toEqual(["refund", "long", "take"]);
  });

  it("de-duplicates and stems light endings only when enough remains", () => {
    expect(queryTerms("Refunds refunded REFUND")).toEqual(["refund"]);
    expect(queryTerms("yes gas")).toEqual(["yes", "gas"]);
  });

  it("drops possessives and apostrophes", () => {
    expect(queryTerms("Nimbus's plan can't change")).toEqual(["change", "nimbu", "plan"]);
  });

  it("returns nothing for an empty or stop-word-only question", () => {
    expect(queryTerms("")).toEqual([]);
    expect(queryTerms("how do I do this?")).toEqual([]);
  });

  it("caps the number of terms", () => {
    expect(queryTerms("alpha bravo charlie delta echo foxtrot", 3)).toHaveLength(3);
  });

  it("handles non-Latin letters", () => {
    expect(queryTerms("Rückerstattung dauert")).toEqual(["rückerstattung", "dauert"]);
  });
});

describe("highlightSegments", () => {
  const join = (s: { text: string }[]) => s.map((x) => x.text).join("");

  it("marks whole words that start with a term, case-insensitively", () => {
    const text = "Refunds are paid within 5 days. A refund needs approval.";
    const segs = highlightSegments(text, ["refund"]);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["Refunds", "refund"]);
    expect(join(segs)).toBe(text);
  });

  it("does not match inside a word", () => {
    const segs = highlightSegments("prerefund and refund", ["refund"]);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["refund"]);
  });

  it("treats terms as text, not regex", () => {
    // "." is not a wildcard: "a.c" must not match "abc".
    expect(highlightSegments("abc xyz", ["a.c", "(x"]).some((s) => s.match)).toBe(false);
    expect(highlightSegments("see a.c now", ["a.c"]).filter((s) => s.match)).toEqual([
      { text: "a.c", match: true },
    ]);
  });

  it("returns the text unchanged when there are no terms", () => {
    expect(highlightSegments("plain", [])).toEqual([{ text: "plain", match: false }]);
    expect(highlightSegments("", ["x"])).toEqual([]);
  });

  it("round-trips arbitrary text", () => {
    const text = "Line one\n\n**Bold** — billing › refunds; 30-day window.";
    expect(join(highlightSegments(text, queryTerms("billing window refunds")))).toBe(text);
  });
});
