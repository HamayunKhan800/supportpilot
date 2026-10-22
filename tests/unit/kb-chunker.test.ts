import { describe, expect, it } from "vitest";

import { chunkSections, DEFAULT_CHUNK_OPTIONS, parseMarkdownSections } from "@/server/modules/kb/chunker";
import { estimateTokens, normalizeText } from "@/server/modules/kb/text";

describe("normalizeText", () => {
  it("normalizes line endings, NFC, trailing spaces and blank-line runs", () => {
    expect(normalizeText("a\r\nb\rc  \n\n\n\nd\t\n")).toBe("a\nb\nc\n\nd");
    expect(normalizeText("cafe\u0301")).toBe("caf\u00e9");
    expect(normalizeText("page1\fpage2")).toBe("page1\n\npage2");
  });

  it("removes control and invisible characters that could hide instructions (T9)", () => {
    expect(normalizeText("\ufeffre\u200bfund\u0000 po\u202elicy\u2066x\u2069")).toBe("refund policyx");
    expect(normalizeText("tab\tkept")).toBe("tab\tkept");
  });

  it("estimates tokens at about four characters each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("parseMarkdownSections", () => {
  it("tracks the heading trail and drops empty sections", () => {
    const md = [
      "Intro text.",
      "# Billing",
      "## Refunds",
      "Refunds take 5 days.",
      "### Exceptions ###",
      "Gift cards are final.",
      "## Invoices",
      "Sent monthly.",
      "# Shipping",
      "#### Deep",
      "Skipped levels work.",
      "# Empty",
    ].join("\n");
    expect(parseMarkdownSections(md)).toEqual([
      { headingPath: [], text: "Intro text." },
      { headingPath: ["Billing", "Refunds"], text: "Refunds take 5 days." },
      { headingPath: ["Billing", "Refunds", "Exceptions"], text: "Gift cards are final." },
      { headingPath: ["Billing", "Invoices"], text: "Sent monthly." },
      { headingPath: ["Shipping", "Deep"], text: "Skipped levels work." },
    ]);
  });

  it("ignores headings inside fenced code blocks (``` and ~~~, longer closers)", () => {
    const md = [
      "# Setup",
      "```bash",
      "# not a heading",
      "~~~",
      "still code",
      "````",
      "After code.",
      "~~~",
      "# nope",
      "~~~",
    ].join("\n");
    const sections = parseMarkdownSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.headingPath).toEqual(["Setup"]);
    expect(sections[0]!.text).toContain("# not a heading");
    expect(sections[0]!.text).toContain("# nope");
  });

  it("requires a space after the hashes and treats '#' alone as text", () => {
    const sections = parseMarkdownSections("#hashtag\n#\n####### seven\nbody");
    expect(sections).toEqual([{ headingPath: [], text: "#hashtag\n#\n####### seven\nbody" }]);
  });
});

describe("chunkSections", () => {
  const sentence = (i: number) => `Sentence number ${i} explains one specific fact about the product.`; // ~66 chars

  it("keeps a small section as one chunk with its heading trail", () => {
    const chunks = chunkSections([
      { headingPath: ["Billing", "Refunds"], text: "Refunds take 5 days.\n\nCall us." },
    ]);
    expect(chunks).toEqual([
      { headingPath: "Billing › Refunds", content: "Refunds take 5 days.\n\nCall us.", tokenEstimate: 8 },
    ]);
  });

  it("splits long text at sentence boundaries within the size limit, with overlap", () => {
    const text = Array.from({ length: 60 }, (_, i) => sentence(i)).join(" ");
    const options = { targetTokens: 100, overlapRatio: 0.2 }; // 400 chars, 80 overlap
    const chunks = chunkSections([{ headingPath: [], text }], options);

    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(400);
      expect(c.content.trim()).toMatch(/\.$/); // never cut mid-sentence
    }
    // Each chunk after the first starts with the last sentence of the previous one.
    for (let i = 1; i < chunks.length; i++) {
      const prevLast = chunks[i - 1]!.content.split(/(?<=\.)\s+/).pop()!;
      expect(chunks[i]!.content.startsWith(prevLast)).toBe(true);
    }
    // Every sentence survives.
    const all = chunks.map((c) => c.content).join(" ");
    for (let i = 0; i < 60; i++) expect(all).toContain(sentence(i));
  });

  it("overlaps only whole sentences: none when the last sentence exceeds the overlap budget", () => {
    const text = Array.from({ length: 12 }, (_, i) => sentence(i)).join(" "); // 64-char sentences
    const tight = chunkSections([{ headingPath: [], text }], { targetTokens: 100, overlapRatio: 0.15 }); // 60
    expect(tight).toHaveLength(2);
    expect(tight[1]!.content.startsWith(sentence(6))).toBe(true);
    expect(tight[0]!.content).not.toContain(sentence(6));
  });

  it("does not overlap across sections", () => {
    const chunks = chunkSections(
      [
        { headingPath: ["A"], text: "Alpha fact." },
        { headingPath: ["B"], text: "Beta fact." },
      ],
      { targetTokens: 100, overlapRatio: 0.15 },
    );
    expect(chunks.map((c) => c.content)).toEqual(["Alpha fact.", "Beta fact."]);
  });

  it("hard-splits a single overlong word-run at whitespace, and unbroken text anywhere", () => {
    const words = Array.from({ length: 200 }, () => "word").join(" "); // 999 chars, no sentence ends
    const chunks = chunkSections([{ headingPath: [], text: words }], { targetTokens: 50, overlapRatio: 0 });
    expect(chunks.every((c) => c.content.length <= 200 && !c.content.includes("wor d"))).toBe(true);
    expect(chunks.map((c) => c.content).join(" ")).toBe(words);

    const blob = "x".repeat(450);
    const blobChunks = chunkSections([{ headingPath: [], text: blob }], {
      targetTokens: 50,
      overlapRatio: 0,
    });
    expect(blobChunks.map((c) => c.content.length)).toEqual([200, 200, 50]);
  });

  it("keeps fenced code blocks together and splits huge ones by line", () => {
    const code = ["```", ...Array.from({ length: 40 }, (_, i) => `line ${i}`), "", "still code", "```"].join(
      "\n",
    );
    const small = chunkSections([{ headingPath: [], text: "```\na\n\nb\n```" }]);
    expect(small).toHaveLength(1);
    expect(small[0]!.content).toBe("```\na\n\nb\n```");

    const big = chunkSections([{ headingPath: [], text: code }], { targetTokens: 30, overlapRatio: 0 });
    expect(big.length).toBeGreaterThan(1);
    expect(big.every((c) => c.content.length <= 120)).toBe(true);
    expect(big.map((c) => c.content).join("\n")).toContain("line 39");
  });

  it("skips overlap when it would push a chunk past the limit", () => {
    const para = "A".repeat(395) + ".";
    const chunks = chunkSections([{ headingPath: [], text: `Short one. ${para}\n\n${para}` }], {
      targetTokens: 100,
      overlapRatio: 0.15,
    });
    expect(chunks.every((c) => c.content.length <= 400)).toBe(true);
  });

  it("uses about 500-token chunks with 15% overlap by default and validates options", () => {
    expect(DEFAULT_CHUNK_OPTIONS).toEqual({ targetTokens: 500, overlapRatio: 0.15 });
    expect(() => chunkSections([], { targetTokens: 0, overlapRatio: 0.1 })).toThrow(RangeError);
    expect(() => chunkSections([], { targetTokens: 10, overlapRatio: 0.5 })).toThrow(RangeError);
    expect(() => chunkSections([], { targetTokens: 10, overlapRatio: -0.1 })).toThrow(RangeError);
    expect(chunkSections([])).toEqual([]);
  });
});
