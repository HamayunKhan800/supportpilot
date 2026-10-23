import { z } from "zod";

/**
 * What the evaluation Review page shows (M6 D2): items from the evaluation datasets that the
 * project owner checks by hand. Kept free of server imports, so scripts and the database
 * schema can both use it. Client components import ./constants instead (no Zod).
 *
 * An item's content is generic (a title, labelled fields and one yes/no question), so a new
 * kind of review needs a builder in scripts/lib/review-items.ts, not new UI.
 */

import type { ReviewSet } from "./constants";

export * from "./constants";

export interface ReviewSetInfo {
  title: string;
  /** One or two sentences: what to check and why it matters. */
  description: string;
}

export const REVIEW_SET_INFO: Record<ReviewSet, ReviewSetInfo> = {
  "label-changes": {
    title: "Proposed label changes",
    description:
      "Changes to the original 25 demo tickets after the priority rubric was written, and rewording where a ticket names a plan that doesn't exist. Approve each one, or keep the old version.",
  },
  "triage-labels": {
    title: "Triage labels",
    description:
      "Every 5th ticket of the 150 in the triage test set. Check that the category, priority, sentiment and language follow the rubric.",
  },
  "retrieval-labels": {
    title: "Help-centre questions",
    description:
      "Every 5th of the 110 answerable questions. Check that a customer would ask it, and that the passage and the reference answer really answer it.",
  },
  drafts: {
    title: "AI reply drafts",
    description:
      "AI drafts from the evaluation run. Check that every claim is supported by the cited passages. Your ratings decide whether the automatic grader can be trusted.",
  },
};

export const reviewField = z.strictObject({
  label: z.string().min(1).max(60),
  value: z.string().min(1).max(10_000),
  /** quote: text from a customer or an article, shown as a block quote. */
  kind: z.enum(["text", "quote"]).default("text"),
});

export const reviewContent = z.strictObject({
  title: z.string().min(1).max(300),
  fields: z.array(reviewField).min(1).max(12),
  question: z.string().min(5).max(300),
  agreeLabel: z.string().min(1).max(40).default("Yes, correct"),
  disagreeLabel: z.string().min(1).max(40).default("No, something's wrong"),
});

export type ReviewContent = z.output<typeof reviewContent>;
export type ReviewContentInput = z.input<typeof reviewContent>;
