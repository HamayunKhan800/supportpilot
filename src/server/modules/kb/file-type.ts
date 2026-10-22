import type { KbMimeType } from "@/server/platform/db/schema";

import { IngestError } from "./ingest-errors";
import { KB_MAX_FILENAME_LENGTH, KB_MAX_TITLE_LENGTH, KB_MAX_UPLOAD_BYTES } from "./limits";

/**
 * Upload validation (plan M4 D6, OWASP File Upload Cheat Sheet):
 *  - extension allowlist (the browser-supplied Content-Type is ignored);
 *  - the content must match the extension: PDFs start with the `%PDF-` signature, text
 *    files are strict UTF-8 with no NUL bytes and are not PDFs in disguise;
 *  - the filename is only ever used as a display title. It is never a storage path.
 *
 * Only pure checks live here; size limits are also enforced while streaming the request.
 */

const EXTENSION_TO_MIME: Record<string, KbMimeType> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
};

/** Accepted file extensions (the upload form's `accept` list must match; unit-tested). */
export const KB_ALLOWED_EXTENSIONS = Object.keys(EXTENSION_TO_MIME);

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// C0/C1 control characters and the Unicode bidi/zero-width "format" characters that can
// make a name display differently from what it is (e.g. "invoice\u202Efdp.exe").
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Returns a display-safe file name: the last path segment (browsers on some platforms send
 * "C:\\fakepath\\x.pdf"), without unsafe characters or surrounding whitespace.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = base.normalize("NFC").replace(UNSAFE_NAME_CHARS, "").trim();
  // A colon can address alternate data streams on Windows file systems; "." and ".." are
  // path segments. None of them is a legitimate document name.
  if (cleaned === "" || cleaned === "." || cleaned === ".." || cleaned.includes(":")) {
    throw new IngestError("invalid_filename");
  }
  if (cleaned.length > KB_MAX_FILENAME_LENGTH) throw new IngestError("invalid_filename");
  return cleaned;
}

/** "Refund_policy-2026.md" becomes "Refund policy 2026". */
export function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const title = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (title === "") return "Untitled document";
  return title.length > KB_MAX_TITLE_LENGTH ? title.slice(0, KB_MAX_TITLE_LENGTH).trimEnd() : title;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

function startsWithPdfSignature(bytes: Uint8Array): boolean {
  return PDF_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Decodes strict UTF-8 text: invalid sequences throw instead of becoming U+FFFD, and a
 * leading byte-order mark is removed.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new IngestError("content_mismatch"); // binary data
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new IngestError("not_utf8", { cause });
  }
}

export interface DetectedFile {
  mimeType: KbMimeType;
  filename: string;
  title: string;
}

/**
 * Validates an uploaded file and decides its type from the extension and its content.
 * Throws IngestError with a permanent code when the file must be rejected.
 */
export function detectFile(rawFilename: string, bytes: Uint8Array): DetectedFile {
  const filename = sanitizeFilename(rawFilename);
  if (bytes.byteLength === 0) throw new IngestError("empty_file");
  if (bytes.byteLength > KB_MAX_UPLOAD_BYTES) throw new IngestError("file_too_large");

  const mimeType = EXTENSION_TO_MIME[extensionOf(filename)];
  if (!mimeType) throw new IngestError("unsupported_type");

  if (mimeType === "application/pdf") {
    if (!startsWithPdfSignature(bytes)) throw new IngestError("content_mismatch");
  } else {
    // A PDF renamed to .txt would be indexed as unreadable binary-ish text.
    if (startsWithPdfSignature(bytes)) throw new IngestError("content_mismatch");
    decodeUtf8Strict(bytes);
  }
  return { mimeType, filename, title: titleFromFilename(filename) };
}
