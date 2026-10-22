import { describe, expect, it } from "vitest";

import { IngestError, type IngestErrorCode } from "@/server/modules/kb/ingest-errors";
import { KB_MAX_EXTRACTED_CHARS } from "@/server/modules/kb/limits";
import { extractPdfText } from "@/server/modules/kb/pdf/extract";
import { prepareDocument } from "@/server/modules/kb/prepare";

import { buildPdf, manyPages } from "../support/pdf";

const utf8 = (s: string) => new TextEncoder().encode(s);
const thread = (name: string) => new URL(`./fixtures/pdf-threads/${name}.ts`, import.meta.url);

async function failure(
  promise: Promise<unknown>,
): Promise<{ code: IngestErrorCode | "no error"; pageCount: number | null }> {
  try {
    await promise;
    return { code: "no error", pageCount: null };
  } catch (err) {
    if (err instanceof IngestError) return { code: err.code, pageCount: err.pageCount };
    throw err;
  }
}

describe("extractPdfText (real PDF.js in a worker thread)", () => {
  it("extracts text per page, keeping line breaks and escaped characters", async () => {
    const pdf = buildPdf({
      pages: [["Refunds take 5 days.", "Contact (billing) support."], ["Second page."]],
    });
    const result = await extractPdfText(pdf);
    expect(result.pageCount).toBe(2);
    expect(result.pages[0]).toContain("Refunds take 5 days.\nContact (billing) support.");
    expect(result.pages[1]).toContain("Second page.");
  });

  it("accepts 50 pages and refuses 51 before parsing any page", async () => {
    expect((await extractPdfText(manyPages(50))).pageCount).toBe(50);
    expect(await failure(extractPdfText(manyPages(51)))).toEqual({
      code: "pdf_too_many_pages",
      pageCount: 51,
    });
  });

  it("reports password-protected PDFs", async () => {
    expect((await failure(extractPdfText(buildPdf({ userPassword: "s3cret" })))).code).toBe("pdf_encrypted");
  });

  it("reports truncated, garbage and disguised files as invalid PDFs", async () => {
    const good = buildPdf();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    const garbage = new Uint8Array([...utf8("%PDF-1.7\n"), ...new Uint8Array(500).fill(7)]);
    for (const bytes of [good.subarray(0, Math.floor(good.length / 2)), garbage, png]) {
      expect((await failure(extractPdfText(bytes))).code).toBe("pdf_invalid");
    }
  });

  it("stops early when the raw text passes the character cap", async () => {
    const pdf = buildPdf({ pages: [["x".repeat(80)], ["y".repeat(80)]] });
    expect(await failure(extractPdfText(pdf, { maxChars: 100 }))).toEqual({
      code: "text_too_long",
      pageCount: 2,
    });
  });
});

describe("PDF thread isolation (hostile-parser simulations)", () => {
  it("kills a thread that runs past the timeout while the main event loop keeps running", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const started = Date.now();
    const result = await failure(extractPdfText(buildPdf(), { threadUrl: thread("spin"), timeoutMs: 300 }));
    clearInterval(timer);
    expect(result.code).toBe("pdf_timeout");
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(ticks).toBeGreaterThanOrEqual(10); // the main thread was never blocked
  });

  it("stops a thread that exceeds its memory cap", async () => {
    const result = await failure(
      extractPdfText(buildPdf(), { threadUrl: thread("oom"), memoryMb: 32, timeoutMs: 20_000 }),
    );
    expect(result.code).toBe("pdf_too_complex");
  }, 30_000);

  it("treats a crashing or silent thread as an internal (retryable) error", async () => {
    for (const name of ["crash", "silent-exit"]) {
      const err = await extractPdfText(buildPdf(), { threadUrl: thread(name) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IngestError);
      expect(err).toMatchObject({ code: "internal_error", permanent: false });
    }
  });
});

describe("prepareDocument", () => {
  it("chunks Markdown by heading and records no page count", async () => {
    const md = "# Billing\n\n## Refunds\n\nRefunds take 5 days.\n\n# Shipping\n\nWe ship worldwide.";
    const result = await prepareDocument("text/markdown", utf8(md));
    expect(result.pageCount).toBeNull();
    expect(result.chunks.map((c) => [c.headingPath, c.content])).toEqual([
      ["Billing › Refunds", "Refunds take 5 days."],
      ["Shipping", "We ship worldwide."],
    ]);
  });

  it("treats plain text as one section, even if it contains '#' lines", async () => {
    const result = await prepareDocument("text/plain", utf8("\ufeff# not a heading\r\nline two\u200b"));
    expect(result.chunks).toEqual([
      { headingPath: "", content: "# not a heading\nline two", tokenEstimate: 6 },
    ]);
  });

  it("labels PDF chunks by page and skips empty pages", async () => {
    const pdf = buildPdf({ pages: [["Page one fact."], [], ["Page three fact."]] });
    const result = await prepareDocument("application/pdf", pdf);
    expect(result.pageCount).toBe(3);
    expect(result.chunks.map((c) => c.headingPath)).toEqual(["Page 1", "Page 3"]);
  });

  it("rejects a scanned PDF with no text layer, keeping its page count", async () => {
    expect(await failure(prepareDocument("application/pdf", buildPdf({ imageOnly: true })))).toEqual({
      code: "pdf_no_text",
      pageCount: 1,
    });
  });

  it("re-validates text bytes (defence in depth) and rejects empty content", async () => {
    expect((await failure(prepareDocument("text/plain", Uint8Array.from([0x61, 0xff])))).code).toBe(
      "not_utf8",
    );
    expect((await failure(prepareDocument("text/markdown", utf8(" \n\u200b\n\t")))).code).toBe("no_content");
    expect(
      (await failure(prepareDocument("text/markdown", utf8("# Only a heading\n## And another")))).code,
    ).toBe("no_content");
  });

  it("enforces the 300,000-character cap after normalization", async () => {
    const atLimit = "a".repeat(KB_MAX_EXTRACTED_CHARS);
    await expect(prepareDocument("text/plain", utf8(atLimit))).resolves.toBeDefined();
    expect((await failure(prepareDocument("text/plain", utf8(`${atLimit}b`)))).code).toBe("text_too_long");
    // Removed invisible characters do not count towards the cap.
    await expect(prepareDocument("text/plain", utf8(`${atLimit}\u200b\u200b`))).resolves.toBeDefined();
  });

  it("applies custom chunk options", async () => {
    const text = Array.from({ length: 30 }, (_, i) => `Fact ${i} is here.`).join(" ");
    const result = await prepareDocument("text/plain", utf8(text), {
      chunk: { targetTokens: 20, overlapRatio: 0 },
    });
    expect(result.chunks.length).toBeGreaterThan(5);
    expect(result.charCount).toBe(text.length);
  });
});
