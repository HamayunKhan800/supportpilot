import { getSessionContext, type SessionContext } from "@/server/platform/auth/context";
import { getDb } from "@/server/platform/db/client";
import { getEnv } from "@/server/platform/env";
import { Errors } from "@/server/platform/errors";

import { REVIEW_SET_INFO, REVIEW_SETS, reviewContent, type ReviewContent, type ReviewSet } from "./content";
import * as repo from "./repository";
import { reviewVerdictInput, type ReviewVerdictSaved } from "./schemas";

/**
 * The evaluation Review page (M6 D2): the project owner checks a mechanical 20% sample of the
 * evaluation labels by hand, and later rates AI drafts. Access is an allowlist of email
 * addresses (EVAL_REVIEWER_EMAILS), not a workspace role: the datasets belong to the project,
 * not to any workspace. Everyone else, including signed-in workspace owners, gets 404, so a
 * deployment doesn't reveal that the page exists. Empty list = off for everyone.
 */

export function reviewEnabled(): boolean {
  return getEnv().EVAL_REVIEWER_EMAILS.length > 0;
}

export function isReviewer(email: string | null | undefined): boolean {
  return Boolean(email) && getEnv().EVAL_REVIEWER_EMAILS.includes(email!.trim().toLowerCase());
}

/** Signed out: 401. Feature off, or not on the list: 404. */
export async function requireReviewer(headers: Headers): Promise<SessionContext> {
  if (!reviewEnabled()) throw Errors.notFound();
  const session = await getSessionContext(headers);
  if (!session) throw Errors.unauthorized();
  if (!isReviewer(session.user.email)) throw Errors.notFound();
  return session;
}

export function isReviewSet(value: string): value is ReviewSet {
  return (REVIEW_SETS as readonly string[]).includes(value);
}

export interface ReviewSetSummary {
  set: ReviewSet;
  title: string;
  description: string;
  total: number;
  reviewed: number;
  agreed: number;
}

export async function getReviewOverview(headers: Headers): Promise<ReviewSetSummary[]> {
  await requireReviewer(headers);
  const counts = new Map((await repo.countBySet(getDb().db)).map((c) => [c.set, c]));
  return REVIEW_SETS.map((set) => ({
    set,
    ...REVIEW_SET_INFO[set],
    total: counts.get(set)?.total ?? 0,
    reviewed: counts.get(set)?.reviewed ?? 0,
    agreed: counts.get(set)?.agreed ?? 0,
  }));
}

export interface ReviewItemView {
  id: string;
  itemKey: string;
  content: ReviewContent;
  contentHash: string;
  verdict: "agree" | "disagree" | null;
  note: string | null;
  reviewedAt: string | null;
}

export interface ReviewItemPage {
  set: ReviewSet;
  title: string;
  description: string;
  item: ReviewItemView;
  /** 1-based position in the set. */
  index: number;
  total: number;
  reviewed: number;
  prevKey: string | null;
  nextKey: string | null;
}

type Outline = Awaited<ReturnType<typeof repo.listSetOutline>>;

/** The first unreviewed item after `fromIndex`, wrapping around; null when all are done. */
export function nextUnreviewed(outline: Outline, fromIndex: number): string | null {
  for (let step = 1; step <= outline.length; step++) {
    const candidate = outline[(fromIndex + step) % outline.length]!;
    if (!candidate.verdict) return candidate.itemKey;
  }
  return null;
}

/**
 * One item of a set. Without `itemKey`: the first item still to review (or the first item,
 * when all are done). An unknown set or key is 404.
 */
export async function getReviewItemPage(
  headers: Headers,
  set: string,
  itemKey?: string,
): Promise<ReviewItemPage> {
  await requireReviewer(headers);
  if (!isReviewSet(set)) throw Errors.notFound();
  const db = getDb().db;
  const outline = await repo.listSetOutline(db, set);
  if (outline.length === 0) throw Errors.notFound();

  const index = itemKey
    ? outline.findIndex((o) => o.itemKey === itemKey)
    : Math.max(
        0,
        outline.findIndex((o) => !o.verdict),
      );
  if (index < 0) throw Errors.notFound();
  const row = await repo.findItem(db, set, outline[index]!.itemKey);
  if (!row) throw Errors.notFound(); // removed by a reload between the two reads

  return {
    set,
    ...REVIEW_SET_INFO[set],
    item: {
      id: row.id,
      itemKey: row.itemKey,
      // Re-validated on the way out: the page renders exactly the documented shape.
      content: reviewContent.parse(row.content),
      contentHash: row.contentHash,
      verdict: row.verdict,
      note: row.note,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    },
    index: index + 1,
    total: outline.length,
    reviewed: outline.filter((o) => o.verdict).length,
    prevKey: outline[index - 1]?.itemKey ?? null,
    nextKey: outline[index + 1]?.itemKey ?? null,
  };
}

/** Records (or changes) a verdict. 409 if the item changed since the reviewer opened it. */
export async function saveReviewVerdict(
  headers: Headers,
  id: string,
  rawInput: unknown,
): Promise<ReviewVerdictSaved> {
  const session = await requireReviewer(headers);
  const input = reviewVerdictInput.parse(rawInput);
  const db = getDb().db;

  const saved = await repo.saveVerdict(db, { id, ...input, userId: session.user.id });
  if (!saved) {
    if (!(await repo.findItemById(db, id))) throw Errors.notFound();
    throw Errors.conflict(
      "This item was updated after you opened it. Reload the page to review the new version.",
      "review_item_changed",
    );
  }

  const outline = await repo.listSetOutline(db, saved.set);
  const index = outline.findIndex((o) => o.id === saved.id);
  return {
    itemKey: saved.itemKey,
    verdict: saved.verdict!,
    note: saved.note,
    reviewedAt: saved.reviewedAt!.toISOString(),
    nextUnreviewedKey: nextUnreviewed(outline, index),
    reviewed: outline.filter((o) => o.verdict).length,
    total: outline.length,
  };
}
