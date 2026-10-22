/**
 * Pure scoring for the retrieval eval (plan M4 step 6). No database, no AI: the harness in
 * scripts/lib/retrieval-eval.ts runs the real pipeline and hands the rankings to these.
 *
 * Gold labels are evidence phrases, not chunk ids, so the same question set works for every
 * chunk size: the gold passages for a question are the chunks of its article that contain
 * the phrase. Matching ignores case, whitespace and Markdown emphasis, because PDF text
 * extraction and Markdown parsing change line breaks and formatting but not the words.
 */

export interface EvidenceTarget {
  /** Corpus file name, e.g. "refunds.md". */
  article: string;
  evidence: string;
}

export interface EvalChunk {
  id: string;
  article: string;
  content: string;
}

export interface GoldSet {
  ids: Set<string>;
  /**
   * True when a target's phrase is not wholly inside any chunk of its article (chunking cut
   * it in two). The chunks holding its first or last words count as gold instead, and the
   * report shows how often this happened, so the fallback is visible rather than silent.
   */
  split: boolean;
  /** Targets whose words are not in their article at all: a broken label. */
  missing: EvidenceTarget[];
}

/** Lowercase, straight quotes, no `*`/backticks, no whitespace at all. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[*`]/g, "")
    .replace(/\s+/g, "");
}

const EDGE_WORDS = 4;

function edgePhrases(evidence: string): string[] {
  const words = evidence.trim().split(/\s+/);
  if (words.length <= EDGE_WORDS) return [];
  return [words.slice(0, EDGE_WORDS).join(" "), words.slice(-EDGE_WORDS).join(" ")].map(normalizeForMatch);
}

export function goldChunks(chunks: readonly EvalChunk[], targets: readonly EvidenceTarget[]): GoldSet {
  const ids = new Set<string>();
  let split = false;
  const missing: EvidenceTarget[] = [];
  for (const target of targets) {
    const own = chunks.filter((c) => c.article === target.article);
    const phrase = normalizeForMatch(target.evidence);
    const whole = own.filter((c) => normalizeForMatch(c.content).includes(phrase));
    if (whole.length > 0) {
      whole.forEach((c) => ids.add(c.id));
      continue;
    }
    const edges = edgePhrases(target.evidence);
    const partial = own.filter((c) => {
      const text = normalizeForMatch(c.content);
      return edges.some((e) => text.includes(e));
    });
    if (partial.length > 0) {
      split = true;
      partial.forEach((c) => ids.add(c.id));
    } else {
      missing.push(target);
    }
  }
  return { ids, split, missing };
}

export interface RankScore {
  /** 1-based rank of the first gold chunk within the top k, or null. */
  firstGoldRank: number | null;
  hit: boolean;
  reciprocalRank: number;
}

export function scoreRanking(rankedIds: readonly string[], gold: ReadonlySet<string>, k: number): RankScore {
  const index = rankedIds.slice(0, k).findIndex((id) => gold.has(id));
  if (index === -1) return { firstGoldRank: null, hit: false, reciprocalRank: 0 };
  return { firstGoldRank: index + 1, hit: true, reciprocalRank: 1 / (index + 1) };
}

/** Nearest-rank percentile (p in 0..100) of a non-empty list; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  if (p < 0 || p > 100) throw new RangeError("p must be between 0 and 100");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export interface RankingSummary {
  questions: number;
  recallAtK: number;
  mrrAtK: number;
}

/** recall@k = share of questions with a gold chunk in the top k; MRR@k = mean of 1/rank. */
export function summarizeScores(scores: readonly RankScore[]): RankingSummary {
  const n = scores.length;
  if (n === 0) return { questions: 0, recallAtK: 0, mrrAtK: 0 };
  return {
    questions: n,
    recallAtK: scores.filter((s) => s.hit).length / n,
    mrrAtK: scores.reduce((sum, s) => sum + s.reciprocalRank, 0) / n,
  };
}
