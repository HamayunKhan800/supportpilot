/**
 * Plain values the Review page's client component needs. This file must stay free of imports:
 * pulling Zod into the browser bundle makes it probe `new Function`, which the strict
 * Content-Security-Policy blocks (and the E2E CSP check reports).
 */

export const REVIEW_SETS = ["label-changes", "triage-labels", "retrieval-labels", "drafts"] as const;
export type ReviewSet = (typeof REVIEW_SETS)[number];

export const REVIEW_VERDICTS = ["agree", "disagree"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const REVIEW_NOTE_MAX = 500;
