import { estimateTokens } from "./text";

/**
 * Heading-aware chunking (plan M4 D8).
 *
 * A document is first split into sections (Markdown headings, or one section per PDF page).
 * Each section is then packed into chunks of about `targetTokens`. Paragraphs are kept
 * whole when they fit, and long paragraphs are split at sentence boundaries, then at word
 * boundaries. Neighbouring chunks inside a section share about `overlapRatio` of text
 * (whole trailing sentences), so a fact that straddles a boundary is still retrievable.
 * Chunks never overlap across sections, because a new heading means a new topic.
 */

export interface Section {
  /** Heading trail, outermost first; empty for text before the first heading. */
  headingPath: string[];
  text: string;
}

export interface TextChunk {
  /** Heading trail joined with " › " (empty string when there is none). */
  headingPath: string;
  content: string;
  tokenEstimate: number;
}

export interface ChunkOptions {
  targetTokens: number;
  overlapRatio: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { targetTokens: 500, overlapRatio: 0.15 };

export const HEADING_SEPARATOR = " › ";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * Splits Markdown into sections at ATX headings ("# Title"). Headings inside fenced code
 * blocks are ignored. Setext headings ("Title\n====") are kept as body text, because
 * "---" is ambiguous with a thematic break.
 */
export function parseMarkdownSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: string[] = [];
  let path: string[] = [];
  let body: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const text = body.join("\n").trim();
    if (text !== "") sections.push({ headingPath: path, text });
    body = [];
  };

  for (const line of markdown.split("\n")) {
    const fenceMatch = FENCE.exec(line);
    if (fence === null && fenceMatch) {
      fence = fenceMatch[1]!;
    } else if (
      fence !== null &&
      fenceMatch &&
      fenceMatch[1]![0] === fence[0] &&
      fenceMatch[1]!.length >= fence.length
    ) {
      fence = null;
    } else if (fence === null) {
      const heading = ATX_HEADING.exec(line);
      const title = heading?.[2]?.trim();
      if (heading && title) {
        flush();
        const level = heading[1]!.length;
        stack.length = level - 1;
        stack[level - 1] = title;
        path = stack.filter((h) => h !== undefined && h !== "");
        continue;
      }
    }
    body.push(line);
  }
  flush();
  return sections;
}

/** Splits text into blocks at blank lines, keeping fenced code blocks intact. */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) fence = null;
    }
    if (fence === null && line.trim() === "") {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Cuts a too-long piece at whitespace (or anywhere, if it has none) into parts of at most maxChars. */
function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const cut = window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

/** A packing unit and the separator that joins it to the previous unit. */
interface Unit {
  text: string;
  sep: "\n\n" | " " | "\n";
}

/**
 * Breaks a block into units: the whole block if it fits, otherwise its sentences (or
 * lines, for code), hard-split if a single one is still too long.
 */
function blockUnits(block: string, maxChars: number): Unit[] {
  if (block.length <= maxChars) return [{ text: block, sep: "\n\n" }];
  const isCode = FENCE.test(block);
  const parts = (isCode ? block.split("\n") : splitSentences(block)).flatMap((u) =>
    u.length > maxChars ? hardSplit(u, maxChars) : [u],
  );
  return parts.map((text, i) => ({ text, sep: i === 0 ? "\n\n" : isCode ? "\n" : " " }));
}

/** Trailing whole sentences of `text` totalling at most overlapChars. */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0) return "";
  const sentences = splitSentences(text.replace(/\s+/g, " "));
  let tail = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = tail === "" ? sentences[i]! : `${sentences[i]} ${tail}`;
    if (candidate.length > overlapChars) break;
    tail = candidate;
  }
  return tail;
}

export function chunkSections(
  sections: Section[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TextChunk[] {
  if (options.targetTokens < 1 || options.overlapRatio < 0 || options.overlapRatio >= 0.5) {
    throw new RangeError("Invalid chunk options");
  }
  const maxChars = options.targetTokens * 4;
  const overlapChars = Math.floor(maxChars * options.overlapRatio);
  const chunks: TextChunk[] = [];

  for (const section of sections) {
    const headingPath = section.headingPath.join(HEADING_SEPARATOR);
    const units = splitBlocks(section.text).flatMap((b) => blockUnits(b, maxChars));
    let current = "";
    // Overlap text is only ever added together with a new unit, so every chunk has new text.
    const emit = () => chunks.push({ headingPath, content: current, tokenEstimate: estimateTokens(current) });

    for (const unit of units) {
      if (current === "") {
        current = unit.text;
      } else if (current.length + unit.sep.length + unit.text.length <= maxChars) {
        current += unit.sep + unit.text;
      } else {
        emit();
        // Code continues line by line without sentence overlap.
        const tail = unit.sep === "\n" ? "" : overlapTail(current, overlapChars);
        current =
          tail !== "" && tail.length + unit.sep.length + unit.text.length <= maxChars
            ? tail + unit.sep + unit.text
            : unit.text;
      }
    }
    if (current !== "") emit();
  }
  return chunks;
}
