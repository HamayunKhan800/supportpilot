/**
 * Message contract between the PDF supervisor (extract.ts) and the parsing thread
 * (thread.ts). Types only: the thread imports it with `import type`, which is erased, so
 * the thread stays a self-contained file that Node can run directly.
 */

export interface PdfThreadInput {
  bytes: Uint8Array;
  maxPages: number;
  /** Stop extracting once the raw text passes this many characters. */
  maxChars: number;
  /** Largest image (width × height) PDF.js may decode. */
  maxImagePixels: number;
}

export type PdfThreadFailure = "pdf_invalid" | "pdf_encrypted" | "pdf_too_many_pages" | "text_too_long";

export type PdfThreadResult =
  | { ok: true; pageCount: number; pages: string[] }
  | { ok: false; code: PdfThreadFailure; pageCount: number | null; detail?: string };
