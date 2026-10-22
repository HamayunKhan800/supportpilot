import type { KbMimeType } from "@/server/platform/db/schema";

import {
  type ChunkOptions,
  chunkSections,
  DEFAULT_CHUNK_OPTIONS,
  parseMarkdownSections,
  type Section,
  type TextChunk,
} from "./chunker";
import { decodeUtf8Strict } from "./file-type";
import { IngestError } from "./ingest-errors";
import { extractPdfText, type PdfExtractOptions } from "./pdf/extract";
import { KB_MAX_EXTRACTED_CHARS } from "./limits";
import { normalizeText } from "./text";

/**
 * Turns stored document bytes into chunks ready for embedding (plan M4 step 2). The worker
 * (step 3) calls this, embeds the chunks and saves them. Text files are decoded strictly
 * again here, as defence in depth against blobs that bypassed upload validation.
 */

export interface PreparedDocument {
  chunks: TextChunk[];
  pageCount: number | null;
  charCount: number;
}

export interface PrepareOptions {
  chunk?: ChunkOptions;
  pdf?: PdfExtractOptions;
}

async function toSections(mimeType: KbMimeType, bytes: Uint8Array, options: PrepareOptions) {
  if (mimeType === "application/pdf") {
    const { pageCount, pages } = await extractPdfText(bytes, options.pdf);
    const sections: Section[] = pages
      .map((raw, i) => ({ headingPath: [`Page ${i + 1}`], text: normalizeText(raw) }))
      .filter((s) => s.text !== "");
    if (sections.length === 0) throw new IngestError("pdf_no_text", { pageCount });
    return { sections, pageCount };
  }
  const text = normalizeText(decodeUtf8Strict(bytes));
  if (text === "") throw new IngestError("no_content");
  const sections = mimeType === "text/markdown" ? parseMarkdownSections(text) : [{ headingPath: [], text }];
  return { sections, pageCount: null };
}

export async function prepareDocument(
  mimeType: KbMimeType,
  bytes: Uint8Array,
  options: PrepareOptions = {},
): Promise<PreparedDocument> {
  const { sections, pageCount } = await toSections(mimeType, bytes, options);
  const charCount = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (charCount > KB_MAX_EXTRACTED_CHARS) throw new IngestError("text_too_long", { pageCount });
  const chunks = chunkSections(sections, options.chunk ?? DEFAULT_CHUNK_OPTIONS);
  if (chunks.length === 0) throw new IngestError("no_content", { pageCount });
  return { chunks, pageCount, charCount };
}
