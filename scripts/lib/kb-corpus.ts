/**
 * Loads the synthetic Nimbus help centre (eval/corpus/nimbus) and the retrieval questions
 * (eval/retrieval/questions.json). Shared by the retrieval eval, its CI guard and the demo
 * seed, so all three use exactly the same documents.
 *
 * Articles marked "pdf" in the manifest are turned into PDFs here, in code, rather than
 * committed as binaries: the files stay reviewable, and the eval still measures the PDF
 * path (text extraction, page sections) that real uploads go through.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { detectFile } from "../../src/server/modules/kb/file-type";
import type { KbMimeType } from "../../src/server/modules/kb/repository";
import { buildPdf } from "../../tests/support/pdf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CORPUS_DIR = path.join(ROOT, "eval/corpus/nimbus");
export const QUESTIONS_FILE = path.join(ROOT, "eval/retrieval/questions.json");

const manifestSchema = z.object({
  version: z.literal(1),
  articles: z
    .array(
      z.object({
        file: z.string().regex(/^[a-z0-9-]+\.md$/),
        title: z.string().min(1).max(200),
        format: z.enum(["md", "pdf"]),
      }),
    )
    .min(1),
});

const target = z.object({ article: z.string().min(1), evidence: z.string().min(3) });
const questionsSchema = z.object({
  version: z.literal(1),
  questions: z
    .array(
      z.object({
        id: z.string().regex(/^q\d{3}$/),
        question: z.string().min(5).max(500),
        article: z.string().min(1),
        evidence: z.string().min(3),
        alsoAccept: z.array(target).optional(),
      }),
    )
    .min(1),
});

export type EvalQuestion = z.infer<typeof questionsSchema>["questions"][number];

export interface CorpusArticle {
  /** Source file, e.g. "refunds.md"; questions refer to articles by this name. */
  file: string;
  title: string;
  format: "md" | "pdf";
  /** Name the file is "uploaded" as (.md or .pdf). */
  filename: string;
  mimeType: KbMimeType;
  bytes: Buffer;
  sha256: string;
  /** The Markdown source, for label validation. */
  source: string;
}

// --- Markdown to PDF ----------------------------------------------------------------------

/** 12 pt Helvetica on a US Letter page with 1-inch margins fits about 85 characters. */
const PDF_LINE_CHARS = 80;
const PDF_LINES_PER_PAGE = 46;

function wrap(line: string, width: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && current.length + 1 + word.length > width) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  out.push(current);
  return out;
}

/**
 * Plain-text pages from Markdown: heading markers and emphasis removed, lines wrapped. The
 * PDF writer encodes Latin-1, so anything else is refused rather than silently garbled.
 */
export function markdownToPdfPages(markdown: string): string[][] {
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(markdown)) {
    throw new Error("PDF articles must be plain ASCII");
  }
  const lines: string[] = [];
  for (const raw of markdown.split("\n")) {
    const text = raw
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*/g, "")
      .trimEnd();
    if (text === "") {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
      continue;
    }
    lines.push(...wrap(text, PDF_LINE_CHARS));
  }
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PDF_LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + PDF_LINES_PER_PAGE));
  }
  return pages;
}

// --- Loading ------------------------------------------------------------------------------

export function loadCorpus(dir = CORPUS_DIR): CorpusArticle[] {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
  const seen = new Set<string>();
  return manifest.articles.map((a) => {
    if (seen.has(a.file)) throw new Error(`Duplicate article in manifest: ${a.file}`);
    seen.add(a.file);
    const source = readFileSync(path.join(dir, a.file), "utf8");
    const bytes =
      a.format === "pdf" ? buildPdf({ pages: markdownToPdfPages(source) }) : Buffer.from(source, "utf8");
    const filename = a.format === "pdf" ? a.file.replace(/\.md$/, ".pdf") : a.file;
    // The same detection as a real upload: signature and extension must agree.
    const detected = detectFile(filename, bytes);
    return {
      file: a.file,
      title: a.title,
      format: a.format,
      filename: detected.filename,
      mimeType: detected.mimeType,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      source,
    };
  });
}

export function loadQuestions(file = QUESTIONS_FILE): EvalQuestion[] {
  const { questions } = questionsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id: ${q.id}`);
    ids.add(q.id);
  }
  return questions;
}

/** Every evidence target of a question: its own article plus any equally good passages. */
export const questionTargets = (q: EvalQuestion) => [
  { article: q.article, evidence: q.evidence },
  ...(q.alsoAccept ?? []),
];
