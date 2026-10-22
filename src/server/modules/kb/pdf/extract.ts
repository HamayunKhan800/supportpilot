import { Worker } from "node:worker_threads";

import { IngestError } from "../ingest-errors";
import { KB_MAX_EXTRACTED_CHARS, KB_MAX_PDF_PAGES, KB_PDF_MEMORY_MB, KB_PDF_TIMEOUT_MS } from "../limits";
import type { PdfThreadInput, PdfThreadResult } from "./protocol";

/**
 * Extracts text from a PDF in a separate thread with a heap cap and a hard timeout
 * (plan M4 D5). The calling event loop is never blocked by PDF parsing.
 */

export interface PdfExtractOptions {
  /** Thread script. Defaults to thread.ts next to this file; the bundled worker passes its own. */
  threadUrl?: URL;
  timeoutMs?: number;
  memoryMb?: number;
  maxPages?: number;
  maxChars?: number;
}

export interface ExtractedPdf {
  pageCount: number;
  /** Raw text per page (not yet normalized). */
  pages: string[];
}

const MAX_IMAGE_PIXELS = 16 * 1024 * 1024; // 16 megapixels

export const DEFAULT_PDF_THREAD_URL = new URL("./thread.ts", import.meta.url);

export function extractPdfText(bytes: Uint8Array, options: PdfExtractOptions = {}): Promise<ExtractedPdf> {
  const input: PdfThreadInput = {
    bytes,
    maxPages: options.maxPages ?? KB_MAX_PDF_PAGES,
    maxChars: options.maxChars ?? KB_MAX_EXTRACTED_CHARS,
    maxImagePixels: MAX_IMAGE_PIXELS,
  };
  const memoryMb = options.memoryMb ?? KB_PDF_MEMORY_MB;

  return new Promise<ExtractedPdf>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(options.threadUrl ?? DEFAULT_PDF_THREAD_URL, {
      workerData: input,
      resourceLimits: {
        maxOldGenerationSizeMb: memoryMb,
        maxYoungGenerationSizeMb: Math.max(8, Math.floor(memoryMb / 8)),
        stackSizeMb: 4,
      },
      stdout: true, // swallow anything the thread prints
      stderr: true,
    });
    // Discard captured output so it cannot accumulate in memory.
    worker.stdout.resume();
    worker.stderr.resume();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };

    const timer = setTimeout(
      () => settle(() => reject(new IngestError("pdf_timeout"))),
      options.timeoutMs ?? KB_PDF_TIMEOUT_MS,
    );

    worker.once("message", (result: PdfThreadResult) =>
      settle(() => {
        if (result.ok) resolve({ pageCount: result.pageCount, pages: result.pages });
        else reject(new IngestError(result.code, { pageCount: result.pageCount }));
      }),
    );
    worker.once("error", (err: Error & { code?: string }) =>
      settle(() =>
        reject(
          err.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? new IngestError("pdf_too_complex", { cause: err })
            : new IngestError("internal_error", { cause: err }),
        ),
      ),
    );
    worker.once("exit", (code) =>
      settle(() =>
        reject(new IngestError("internal_error", { cause: new Error(`PDF thread exited with ${code}`) })),
      ),
    );
  });
}
