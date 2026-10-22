// Control characters other than tab and newline, plus invisible "format" characters
// (zero-width, bidi overrides/isolates, BOM). The invisible ones can hide text from a human
// reviewer while the model still reads it (threat T9), so they are removed before indexing.
const STRIP = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Canonical text for chunking and search: NFC, LF line endings, no control or invisible
 * characters, no trailing spaces, at most one blank line in a row.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n\n")
    .replace(STRIP, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rough token count used for chunk sizing and cost estimates (about 4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
