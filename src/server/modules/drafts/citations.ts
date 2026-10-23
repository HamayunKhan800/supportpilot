/**
 * Citation markers in drafts (M5 D8, D9). No imports, so the browser uses the same rules for
 * the customer preview as the server uses when sending.
 */

/** `[1]`, `[ 2 ]`, `[1, 3]`, `[1,2,3]`. Ranges like `[1-3]` are left as plain text. */
const MARKER = /( ?)\[(\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*)*)\]/g;

/** Stands in for a removed marker until the spacing around a run of removals is tidied. */
const REMOVED = "\uE000";

/**
 * Drops removed markers. A run of them followed by punctuation, a space or the end takes the
 * space before it too ("days [7][9]." → "days."); otherwise one space stays between words.
 * Only spots where a marker was removed change, so the model's own spacing (e.g. French
 * "Merci !") is kept.
 */
function tidyRemoved(text: string): string {
  return text.replace(/(?: ?\uE000)+/g, (run: string, offset: number, whole: string) => {
    const next = whole[offset + run.length];
    if (next === undefined || /[\s.,;:!?)]/.test(next)) return "";
    return run.startsWith(" ") ? " " : "";
  });
}

export interface CitationCheck {
  text: string;
  /** Valid passage numbers cited, ascending, without repeats. */
  cited: number[];
  /** Numbers that pointed at no passage and were removed. */
  invalidCount: number;
}

/**
 * Keeps markers that point at one of `passageCount` passages and removes the rest (D8). A list
 * like `[1, 9]` becomes `[1]`; a removed marker takes its leading space with it when it sat
 * before punctuation or the end, so "days [9]." becomes "days.".
 */
export function validateCitations(text: string, passageCount: number): CitationCheck {
  const cited = new Set<number>();
  let invalidCount = 0;
  const out = text.replaceAll(REMOVED, "").replace(MARKER, (_match, space: string, list: string) => {
    const valid: number[] = [];
    for (const raw of list.split(",")) {
      const n = Number(raw.trim());
      if (Number.isInteger(n) && n >= 1 && n <= passageCount) {
        if (!valid.includes(n)) valid.push(n);
      } else invalidCount++;
    }
    for (const n of valid) cited.add(n);
    if (valid.length > 0) return space + valid.map((n) => `[${n}]`).join("");
    return space + REMOVED;
  });
  return { text: tidyRemoved(out), cited: [...cited].sort((a, b) => a - b), invalidCount };
}

/**
 * What the customer receives (D9): every marker removed, since customers can't open internal
 * passages. Spaces left at line ends are trimmed.
 */
export function customerCopy(text: string): string {
  return tidyRemoved(text.replaceAll(REMOVED, "").replace(MARKER, (_match, space: string) => space + REMOVED))
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export type DraftSegment = { type: "text"; text: string } | { type: "citation"; marker: number };

/** Splits a draft into text and single-number citations, for rendering markers as buttons. */
export function splitCitations(text: string): DraftSegment[] {
  const segments: DraftSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const start = m.index + m[1]!.length;
    if (start > last) segments.push({ type: "text", text: text.slice(last, start) });
    for (const raw of m[2]!.split(",")) segments.push({ type: "citation", marker: Number(raw.trim()) });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

/**
 * How much the agent changed the draft before sending, from 0 (sent as written) to 1
 * (rewritten): word-level edit distance divided by the longer text's word count. Measured on
 * customer copies, so removed markers don't count as edits.
 */
export function editRatio(draft: string, sent: string): number {
  const a = customerCopy(draft).split(/\s+/).filter(Boolean);
  const b = customerCopy(sent).split(/\s+/).filter(Boolean);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return Math.round((prev[b.length]! / longest) * 1000) / 1000;
}
