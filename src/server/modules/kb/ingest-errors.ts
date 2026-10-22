import { KB_MAX_EXTRACTED_CHARS, KB_MAX_PDF_PAGES, KB_MAX_UPLOAD_BYTES } from "./limits";

/**
 * Why a document could not be ingested. Stored in kb_document.error_code and shown to
 * admins in plain language. No server imports, so the UI can use the messages.
 *
 * `permanent` failures (the file itself is the problem) are not retried. Temporary ones
 * (the embedding service is busy or down, an unexpected error) are retried with backoff (D9).
 */
export const INGEST_ERRORS = {
  // Upload validation
  empty_file: { permanent: true, message: "The file is empty." },
  file_too_large: {
    permanent: true,
    message: `The file is larger than ${KB_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
  },
  invalid_filename: { permanent: true, message: "The file name is not allowed." },
  unsupported_type: { permanent: true, message: "Only .md, .txt and .pdf files are supported." },
  content_mismatch: {
    permanent: true,
    message: "The file's contents don't match its extension (for example, a renamed file).",
  },
  not_utf8: { permanent: true, message: "Text files must be saved as UTF-8." },
  // Extraction
  pdf_invalid: { permanent: true, message: "The PDF is damaged or not a valid PDF." },
  pdf_encrypted: {
    permanent: true,
    message: "The PDF is password-protected. Remove the password and upload it again.",
  },
  pdf_too_many_pages: { permanent: true, message: `The PDF has more than ${KB_MAX_PDF_PAGES} pages.` },
  pdf_no_text: {
    permanent: true,
    message: "The PDF has no extractable text. Scanned PDFs (images of text) are not supported.",
  },
  pdf_timeout: { permanent: true, message: "The PDF took too long to read and was stopped." },
  pdf_too_complex: { permanent: true, message: "The PDF needed too much memory to read and was stopped." },
  text_too_long: {
    permanent: true,
    message: `The document has more than ${KB_MAX_EXTRACTED_CHARS.toLocaleString("en-US")} characters of text. Split it into smaller documents.`,
  },
  no_content: { permanent: true, message: "The document has no text to index." },
  // Embedding
  embedding_unavailable: {
    permanent: false,
    message: "The embedding service was unavailable. Try again later.",
  },
  embedding_rejected: {
    permanent: true,
    message: "The embedding service rejected the request. Check the AI provider configuration.",
  },
  embedding_invalid: { permanent: true, message: "The embedding service returned an unexpected result." },
  // Anything else
  internal_error: { permanent: false, message: "Something went wrong while processing the document." },
} as const satisfies Record<string, { permanent: boolean; message: string }>;

export type IngestErrorCode = keyof typeof INGEST_ERRORS;

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly permanent: boolean;
  /** Extra facts for the document record (e.g. the page count of a too-long PDF). */
  readonly pageCount: number | null;

  constructor(code: IngestErrorCode, opts: { cause?: unknown; pageCount?: number | null } = {}) {
    super(INGEST_ERRORS[code].message, { cause: opts.cause });
    this.name = "IngestError";
    this.code = code;
    this.permanent = INGEST_ERRORS[code].permanent;
    this.pageCount = opts.pageCount ?? null;
  }
}

/** Plain-language reason for a stored error code (unknown codes get a generic message). */
export function ingestErrorMessage(code: string | null): string {
  return code && code in INGEST_ERRORS
    ? INGEST_ERRORS[code as IngestErrorCode].message
    : INGEST_ERRORS.internal_error.message;
}
