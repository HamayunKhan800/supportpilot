/**
 * Knowledge-base limits (FR-K1, plan M4 D7). Plain constants with no server imports, so
 * client components (upload form hints) can import them too.
 */

/**
 * 4 MB: on AWS Lambda a request is at most 6 MB and Function URLs send uploads base64-encoded
 * (4/3 larger), so 4 MB (about 5.3 MB encoded, plus form overhead) is the most that fits
 * (plan M8 revision 2; it was 5 MB before).
 */
export const KB_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const KB_MAX_PDF_PAGES = 50;
/** About 75k tokens: bounds embedding cost and free-tier quota per document. */
export const KB_MAX_EXTRACTED_CHARS = 300_000;
export const KB_MAX_DOCUMENTS_PER_WORKSPACE = 100;
export const KB_MAX_WORKSPACE_BYTES = 50 * 1024 * 1024;
/** Hard kill for the PDF parsing thread (D5, T12). */
export const KB_PDF_TIMEOUT_MS = 30_000;
/** Heap cap for the PDF parsing thread. */
export const KB_PDF_MEMORY_MB = 256;

export const KB_ALLOWED_EXTENSIONS = [".md", ".markdown", ".txt", ".pdf"] as const;
export const KB_MAX_FILENAME_LENGTH = 255;
export const KB_MAX_TITLE_LENGTH = 200;

/** Test-search questions (characters, after trimming). */
export const KB_MAX_QUERY_LENGTH = 500;
