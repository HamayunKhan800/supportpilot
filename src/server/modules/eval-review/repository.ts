import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { evalReviewItem } from "@/server/platform/db/schema";
import type { Executor } from "@/server/platform/db/tx";

import type { ReviewContent, ReviewSet, ReviewVerdict } from "./content";

export type ReviewItemRow = typeof evalReviewItem.$inferSelect;

export interface ReviewItemSeed {
  set: ReviewSet;
  itemKey: string;
  position: number;
  content: ReviewContent;
  contentHash: string;
}

export interface SyncResult {
  inserted: number;
  /** Content changed: the new version replaces the old and any verdict is cleared. */
  reset: number;
  /** Content changed before anyone reviewed it. */
  updated: number;
  unchanged: number;
  /** No longer in the dataset sample. */
  removed: number;
}

const clearedVerdict = { verdict: null, note: null, reviewedBy: null, reviewedAt: null } as const;

/**
 * Makes the rows of the given sets match `seeds` exactly. A verdict only survives if the
 * reviewer saw exactly the current content (same hash). Run inside one transaction.
 */
export async function syncItems(
  tx: Executor,
  sets: readonly ReviewSet[],
  seeds: readonly ReviewItemSeed[],
): Promise<SyncResult> {
  const result: SyncResult = { inserted: 0, reset: 0, updated: 0, unchanged: 0, removed: 0 };
  for (const s of seeds) {
    if (!sets.includes(s.set))
      throw new Error(`seed ${s.itemKey} is in set ${s.set}, which isn't being synced`);
  }
  const existing = sets.length
    ? await tx
        .select()
        .from(evalReviewItem)
        .where(inArray(evalReviewItem.set, [...sets]))
    : [];
  const byKey = new Map(existing.map((r) => [`${r.set}/${r.itemKey}`, r]));
  const wanted = new Set<string>();

  for (const s of seeds) {
    const id = `${s.set}/${s.itemKey}`;
    if (wanted.has(id)) throw new Error(`duplicate review item ${id}`);
    wanted.add(id);
    const row = byKey.get(id);
    if (!row) {
      await tx.insert(evalReviewItem).values(s);
      result.inserted++;
    } else if (row.contentHash !== s.contentHash) {
      await tx
        .update(evalReviewItem)
        .set({
          position: s.position,
          content: s.content,
          contentHash: s.contentHash,
          ...clearedVerdict,
          updatedAt: sql`now()`,
        })
        .where(eq(evalReviewItem.id, row.id));
      if (row.verdict) result.reset++;
      else result.updated++;
    } else {
      if (row.position !== s.position) {
        await tx.update(evalReviewItem).set({ position: s.position }).where(eq(evalReviewItem.id, row.id));
      }
      result.unchanged++;
    }
  }

  const stale = existing.filter((r) => !wanted.has(`${r.set}/${r.itemKey}`)).map((r) => r.id);
  if (stale.length) {
    await tx.delete(evalReviewItem).where(inArray(evalReviewItem.id, stale));
    result.removed = stale.length;
  }
  return result;
}

export interface SetCounts {
  set: ReviewSet;
  total: number;
  reviewed: number;
  agreed: number;
}

export async function countBySet(db: Executor): Promise<SetCounts[]> {
  return db
    .select({
      set: evalReviewItem.set,
      total: count(),
      reviewed: count(evalReviewItem.verdict),
      agreed: sql<number>`count(*) FILTER (WHERE ${evalReviewItem.verdict} = 'agree')`.mapWith(Number),
    })
    .from(evalReviewItem)
    .groupBy(evalReviewItem.set);
}

/** Every item of a set in page order (no content): enough to navigate. */
export async function listSetOutline(db: Executor, set: ReviewSet) {
  return db
    .select({ id: evalReviewItem.id, itemKey: evalReviewItem.itemKey, verdict: evalReviewItem.verdict })
    .from(evalReviewItem)
    .where(eq(evalReviewItem.set, set))
    .orderBy(asc(evalReviewItem.position), asc(evalReviewItem.itemKey));
}

export async function findItem(db: Executor, set: ReviewSet, itemKey: string): Promise<ReviewItemRow | null> {
  const [row] = await db
    .select()
    .from(evalReviewItem)
    .where(and(eq(evalReviewItem.set, set), eq(evalReviewItem.itemKey, itemKey)))
    .limit(1);
  return row ?? null;
}

export async function findItemById(db: Executor, id: string): Promise<ReviewItemRow | null> {
  const [row] = await db.select().from(evalReviewItem).where(eq(evalReviewItem.id, id)).limit(1);
  return row ?? null;
}

/**
 * Records a verdict, but only if the item still has the content the reviewer saw. Returns
 * null when the hash no longer matches (or the item is gone); the caller tells them apart.
 */
export async function saveVerdict(
  db: Executor,
  input: { id: string; contentHash: string; verdict: ReviewVerdict; note: string | null; userId: string },
): Promise<ReviewItemRow | null> {
  const [row] = await db
    .update(evalReviewItem)
    .set({
      verdict: input.verdict,
      note: input.note,
      reviewedBy: input.userId,
      reviewedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(evalReviewItem.id, input.id), eq(evalReviewItem.contentHash, input.contentHash)))
    .returning();
  return row ?? null;
}

export async function listForExport(db: Executor, set: ReviewSet): Promise<ReviewItemRow[]> {
  return db
    .select()
    .from(evalReviewItem)
    .where(eq(evalReviewItem.set, set))
    .orderBy(asc(evalReviewItem.position), asc(evalReviewItem.itemKey));
}
