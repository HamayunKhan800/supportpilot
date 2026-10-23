/**
 * Turns the Review page's verdicts into the file committed under eval/review/ (M6 D2): the
 * record of what the project owner checked, how much they agreed with, and every note.
 * No user IDs or email addresses are written; the file only says what was decided.
 */
import { formatRate, wilson, type Rate } from "../../src/server/modules/eval/stats";
import { REVIEW_SET_INFO, type ReviewSet } from "../../src/server/modules/eval-review/content";

export interface ReviewRowLike {
  itemKey: string;
  contentHash: string;
  verdict: "agree" | "disagree" | null;
  note: string | null;
  reviewedAt: Date | null;
}

export interface ReviewExport {
  set: ReviewSet;
  title: string;
  total: number;
  reviewed: number;
  agreed: number;
  /** Share of reviewed items marked correct, with a 95% Wilson interval. */
  agreement: Rate;
  summary: string;
  items: {
    key: string;
    verdict: "agree" | "disagree" | null;
    note: string | null;
    reviewedAt: string | null;
    contentHash: string;
  }[];
}

export function summariseReview(set: ReviewSet, rows: readonly ReviewRowLike[]): ReviewExport {
  const reviewed = rows.filter((r) => r.verdict).length;
  const agreed = rows.filter((r) => r.verdict === "agree").length;
  const agreement = wilson(agreed, reviewed);
  const pending = rows.length - reviewed;
  return {
    set,
    title: REVIEW_SET_INFO[set].title,
    total: rows.length,
    reviewed,
    agreed,
    agreement,
    summary:
      `${reviewed} of ${rows.length} checked; marked correct: ${formatRate(agreement)}` +
      (pending ? `; ${pending} still to check` : ""),
    items: rows.map((r) => ({
      key: r.itemKey,
      verdict: r.verdict,
      note: r.note,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      contentHash: r.contentHash,
    })),
  };
}
