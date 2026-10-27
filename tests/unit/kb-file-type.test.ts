import { describe, expect, it } from "vitest";

import {
  decodeUtf8Strict,
  detectFile,
  extensionOf,
  sanitizeFilename,
  titleFromFilename,
} from "@/server/modules/kb/file-type";
import { IngestError, ingestErrorMessage, type IngestErrorCode } from "@/server/modules/kb/ingest-errors";
import { KB_MAX_UPLOAD_BYTES } from "@/server/modules/kb/limits";

import { buildPdf } from "../support/pdf";

const utf8 = (s: string) => new TextEncoder().encode(s);
// First bytes of a real PNG file.
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function codeOf(fn: () => unknown): IngestErrorCode | "no error" {
  try {
    fn();
    return "no error";
  } catch (err) {
    if (err instanceof IngestError) return err.code;
    throw err;
  }
}

describe("sanitizeFilename", () => {
  it("keeps only the last path segment (fakepath and traversal attempts)", () => {
    expect(sanitizeFilename("C:\\fakepath\\guide.pdf")).toBe("guide.pdf");
    expect(sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("/abs/dir/notes.md")).toBe("notes.md");
  });

  it("removes control, zero-width and bidi-override characters", () => {
    // "invoice\u202Efdp.exe" would display as "invoiceexe.pdf".
    expect(sanitizeFilename("invoice\u202Efdp.md")).toBe("invoicefdp.md");
    expect(sanitizeFilename("a\u0000b\u0007c\u200b.txt")).toBe("abc.txt");
    expect(sanitizeFilename("  spaced.md  ")).toBe("spaced.md");
  });

  it("normalizes to NFC", () => {
    expect(sanitizeFilename("cafe\u0301.md")).toBe("caf\u00e9.md");
  });

  it.each(["", "   ", ".", "..", "a/", "\u202e", "doc.txt:hidden", "x".repeat(256)])("rejects %j", (name) => {
    expect(codeOf(() => sanitizeFilename(name))).toBe("invalid_filename");
  });
});

describe("titleFromFilename / extensionOf", () => {
  it("derives a readable title", () => {
    expect(titleFromFilename("Refund_policy-2026.md")).toBe("Refund policy 2026");
    expect(titleFromFilename("a.b.c.txt")).toBe("a.b.c");
    expect(titleFromFilename(".md")).toBe(".md");
    expect(titleFromFilename("___.md")).toBe("Untitled document");
    expect(titleFromFilename(`${"x".repeat(300)}.md`)).toHaveLength(200);
  });

  it("returns the lowercased last extension, or empty for dotfiles and no extension", () => {
    expect(extensionOf("Guide.PDF")).toBe(".pdf");
    expect(extensionOf("archive.pdf.exe")).toBe(".exe");
    expect(extensionOf(".md")).toBe("");
    expect(extensionOf("README")).toBe("");
  });
});

describe("decodeUtf8Strict", () => {
  it("decodes UTF-8 and strips a byte-order mark", () => {
    expect(decodeUtf8Strict(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("héllo")]))).toBe("héllo");
  });

  it("rejects invalid UTF-8 instead of replacing it", () => {
    expect(codeOf(() => decodeUtf8Strict(Uint8Array.from([0x68, 0xff, 0x69])))).toBe("not_utf8");
    // Latin-1 "é" on its own is not valid UTF-8.
    expect(codeOf(() => decodeUtf8Strict(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])))).toBe("not_utf8");
  });

  it("treats NUL bytes as binary content", () => {
    expect(codeOf(() => decodeUtf8Strict(Uint8Array.from([0x61, 0x00, 0x62])))).toBe("content_mismatch");
  });
});

describe("detectFile", () => {
  it("accepts Markdown, text and PDF by extension and content", () => {
    expect(detectFile("Guide.md", utf8("# Hi"))).toEqual({
      mimeType: "text/markdown",
      filename: "Guide.md",
      title: "Guide",
    });
    expect(detectFile("notes.markdown", utf8("x")).mimeType).toBe("text/markdown");
    expect(detectFile("faq.TXT", utf8("x")).mimeType).toBe("text/plain");
    expect(detectFile("manual.pdf", buildPdf()).mimeType).toBe("application/pdf");
  });

  it("rejects empty and oversized files", () => {
    expect(codeOf(() => detectFile("a.txt", new Uint8Array()))).toBe("empty_file");
    expect(codeOf(() => detectFile("a.txt", new Uint8Array(KB_MAX_UPLOAD_BYTES + 1).fill(0x61)))).toBe(
      "file_too_large",
    );
    expect(codeOf(() => detectFile("a.txt", new Uint8Array(KB_MAX_UPLOAD_BYTES).fill(0x61)))).toBe(
      "no error",
    );
  });

  it.each(["page.html", "script.js", "doc.docx", "image.svg", "archive.pdf.exe", "README"])(
    "rejects the extension of %s",
    (name) => {
      expect(codeOf(() => detectFile(name, utf8("hello")))).toBe("unsupported_type");
    },
  );

  it("rejects a PNG renamed to .pdf (signature check, Content-Type is never consulted)", () => {
    expect(codeOf(() => detectFile("photo.pdf", PNG))).toBe("content_mismatch");
    expect(codeOf(() => detectFile("fake.pdf", utf8("not really %PDF-1.7")))).toBe("content_mismatch");
  });

  it("rejects a PDF renamed to .txt or .md (polyglot)", () => {
    expect(codeOf(() => detectFile("notes.txt", buildPdf()))).toBe("content_mismatch");
    expect(codeOf(() => detectFile("notes.md", utf8("%PDF-1.4\nplain text after a fake header")))).toBe(
      "content_mismatch",
    );
  });

  it("rejects binary or non-UTF-8 data in text files", () => {
    expect(codeOf(() => detectFile("photo.txt", PNG))).toBe("content_mismatch");
    expect(codeOf(() => detectFile("legacy.md", Uint8Array.from([0x63, 0x61, 0x66, 0xe9])))).toBe("not_utf8");
  });

  it("validates the filename first", () => {
    expect(codeOf(() => detectFile("a:b.md", utf8("x")))).toBe("invalid_filename");
  });
});

describe("ingest error messages", () => {
  it("gives a plain-language reason and falls back for unknown codes", () => {
    expect(ingestErrorMessage("pdf_encrypted")).toMatch(/password-protected/);
    expect(ingestErrorMessage("file_too_large")).toMatch(/4 MB/);
    expect(ingestErrorMessage("text_too_long")).toMatch(/300,000/);
    expect(ingestErrorMessage("nonsense")).toBe(ingestErrorMessage("internal_error"));
    expect(ingestErrorMessage(null)).toBe(ingestErrorMessage("internal_error"));
  });

  it("marks only service and unexpected failures as retryable", () => {
    expect(new IngestError("embedding_unavailable").permanent).toBe(false);
    expect(new IngestError("internal_error").permanent).toBe(false);
    expect(new IngestError("pdf_timeout").permanent).toBe(true);
    expect(new IngestError("pdf_too_many_pages", { pageCount: 51 }).pageCount).toBe(51);
  });
});
