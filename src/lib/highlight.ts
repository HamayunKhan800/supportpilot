/**
 * Highlights a search question's words in a passage (test search, design step 4). Display-only
 * and approximate: it marks words that start with a question word (so "refund" marks "refunds"),
 * ignoring short and very common words. Retrieval itself ranks by meaning, so a passage can be
 * found without any of these words; the UI says so.
 */

const STOP_WORDS = new Set(
  (
    "the and for are but not you your yours with this that these those from have has had was were " +
    "will would can could should what when where which who whom why how does did doing done its " +
    "into onto about than then them they their there here our ours out get got any all can't don't " +
    "i'm i've it's we're they're also just very much more most some such only own same too"
  ).split(" "),
);

/** Lower-cased, de-duplicated question words worth marking (3+ letters, not a stop word), longest first. */
export function queryTerms(query: string, max = 12): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? [];
  const terms = new Set<string>();
  for (const raw of words) {
    const word = raw.replace(/['’]s$/u, "").replace(/['’]/gu, "");
    if (word.length < 3 || STOP_WORDS.has(word) || STOP_WORDS.has(raw.replace(/’/gu, "'"))) continue;
    // A light stem so "refunds"/"refunded" also mark "refund…": drop a common ending if enough remains.
    const stem = word.replace(/(?:ing|ed|es|s)$/u, "");
    terms.add(stem.length >= 3 ? stem : word);
    if (terms.size >= max) break;
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

export interface Segment {
  text: string;
  match: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits `text` into plain and matching segments; joined, the segments equal `text` exactly. */
export function highlightSegments(text: string, terms: string[]): Segment[] {
  if (terms.length === 0 || text.length === 0) return text ? [{ text, match: false }] : [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join("|")})[\\p{L}\\p{N}]*`, "giu");
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index;
    if (start > last) out.push({ text: text.slice(last, start), match: false });
    out.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}
