/**
 * PDF text extraction thread (plan M4 D5, threat T12).
 *
 * Runs inside a worker_thread started by extract.ts with a heap cap and a hard timeout, so
 * a hostile or pathological PDF cannot block the worker's event loop or exhaust its memory.
 *
 * Constraints (enforced by ESLint): this file is executed directly by Node (type
 * stripping), so it may only import Node built-ins and `unpdf`, and other project modules
 * only with `import type`. Use no TypeScript-only runtime syntax (enums, namespaces).
 *
 * Security notes:
 *  - CVE-2024-4367 (arbitrary JS via crafted fonts) affected PDF.js ≤ 4.1.392. unpdf 1.9.1
 *    bundles PDF.js 6.4, which contains no eval/new Function code path at all (checked
 *    with grep on dist/pdfjs.mjs, 2026-10-22).
 *  - Fonts, XFA forms, streaming and system fonts are disabled; images are size-capped.
 *  - The page count is checked before any page is parsed.
 */
import { parentPort, workerData } from "node:worker_threads";

import { getDocumentProxy } from "unpdf";

import type { PdfThreadInput, PdfThreadResult } from "./protocol";

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

async function extract(input: PdfThreadInput): Promise<PdfThreadResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(input.bytes, {
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      disableStream: true,
      disableAutoFetch: true,
      isOffscreenCanvasSupported: false,
      maxImageSize: input.maxImagePixels,
      verbosity: 0,
    });
  } catch (err) {
    if (errorName(err) === "PasswordException") return { ok: false, code: "pdf_encrypted", pageCount: null };
    return { ok: false, code: "pdf_invalid", pageCount: null, detail: errorName(err) };
  }

  const pageCount = pdf.numPages;
  if (pageCount > input.maxPages) return { ok: false, code: "pdf_too_many_pages", pageCount };

  const pages: string[] = [];
  let totalChars = 0;
  try {
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
      }
      page.cleanup();
      totalChars += text.length;
      if (totalChars > input.maxChars) return { ok: false, code: "text_too_long", pageCount };
      pages.push(text);
    }
  } catch (err) {
    return { ok: false, code: "pdf_invalid", pageCount, detail: errorName(err) };
  }
  return { ok: true, pageCount, pages };
}

if (parentPort) {
  const port = parentPort;
  void extract(workerData as PdfThreadInput).then((result) => port.postMessage(result));
}
