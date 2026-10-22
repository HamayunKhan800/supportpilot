import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { TicketPriority } from "@/server/modules/tickets/types";
import { auditLog, ticket, ticketTriage } from "@/server/platform/db/schema";
import type { Executor, Transaction } from "@/server/platform/db/tx";

/**
 * Triage runs (M5 D4, D5). Every query filters by `workspaceId` (T1). A ticket normally has
 * one run; reads take the newest, so a future "retry triage" can simply add another.
 */

export type TriageRun = typeof ticketTriage.$inferSelect;
export type NewTriageRun = Omit<
  typeof ticketTriage.$inferInsert,
  | "id"
  | "workspaceId"
  | "ticketId"
  | "createdAt"
  | "reviewedBy"
  | "reviewedAt"
  | "categoryOverride"
  | "priorityOverride"
>;

export async function findLatestTriage(db: Executor, workspaceId: string, ticketId: string) {
  const [row] = await db
    .select()
    .from(ticketTriage)
    .where(and(eq(ticketTriage.workspaceId, workspaceId), eq(ticketTriage.ticketId, ticketId)))
    .orderBy(desc(ticketTriage.createdAt), desc(ticketTriage.id))
    .limit(1);
  return row ?? null;
}

export async function hasTriageRun(db: Executor, workspaceId: string, ticketId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ticketTriage.id })
    .from(ticketTriage)
    .where(and(eq(ticketTriage.workspaceId, workspaceId), eq(ticketTriage.ticketId, ticketId)))
    .limit(1);
  return Boolean(row);
}

export async function insertTriageRun(
  db: Executor,
  workspaceId: string,
  ticketId: string,
  run: NewTriageRun,
): Promise<TriageRun> {
  const [row] = await db
    .insert(ticketTriage)
    .values({ ...run, workspaceId, ticketId })
    .returning();
  return row!;
}

/** Locks the ticket row for the rest of the transaction and returns what triage compares against. */
export async function lockTicketLabels(tx: Transaction, workspaceId: string, ticketId: string) {
  const [row] = await tx
    .select({
      id: ticket.id,
      number: ticket.number,
      category: ticket.category,
      priority: ticket.priority,
      version: ticket.version,
    })
    .from(ticket)
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, ticketId)))
    .for("update");
  return row ?? null;
}

/**
 * Writes labels chosen by triage. Bumps the version, so an agent who loaded the ticket
 * before this change gets a 409 instead of silently overwriting it.
 */
export async function applyTriageLabels(
  tx: Transaction,
  workspaceId: string,
  ticketId: string,
  labels: { category?: string; priority?: TicketPriority },
): Promise<void> {
  await tx
    .update(ticket)
    .set({ ...labels, version: sql`${ticket.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, ticketId)));
}

/**
 * Which labels a person has set on this ticket (D5). Agents can change category and priority
 * only through the audited update path, which records actor type "user", so the audit log is
 * the record of human decisions. Triage's own changes are recorded as "system".
 */
export async function humanSetLabels(
  db: Executor,
  workspaceId: string,
  ticketId: string,
): Promise<{ category: boolean; priority: boolean }> {
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.workspaceId, workspaceId),
        eq(auditLog.targetType, "ticket"),
        eq(auditLog.targetId, ticketId),
        eq(auditLog.actorType, "user"),
        inArray(auditLog.action, ["ticket.category_changed", "ticket.priority_changed"]),
      ),
    );
  const actions = new Set(rows.map((r) => r.action));
  return {
    category: actions.has("ticket.category_changed"),
    priority: actions.has("ticket.priority_changed"),
  };
}

/**
 * An agent set category and/or priority on a triaged ticket (D5): the newest successful run is
 * marked reviewed (first reviewer kept), and each field the agent touched gets an override when
 * the agent's value differs from the AI's suggestion, or loses it when the agent agreed.
 * A cleared category is stored as "" (null means "no override").
 */
export async function recordAgentDecision(
  tx: Transaction,
  workspaceId: string,
  ticketId: string,
  userId: string,
  values: { category?: string | null; priority?: TicketPriority },
): Promise<void> {
  const set: Record<string, unknown> = {
    reviewedBy: sql`CASE WHEN ${ticketTriage.reviewedAt} IS NULL THEN ${userId} ELSE ${ticketTriage.reviewedBy} END`,
    reviewedAt: sql`coalesce(${ticketTriage.reviewedAt}, now())`,
  };
  if (values.category !== undefined) {
    const chosen = values.category ?? "";
    set.categoryOverride = sql`CASE WHEN ${ticketTriage.category} IS NOT DISTINCT FROM ${chosen} THEN NULL ELSE ${chosen} END`;
  }
  if (values.priority !== undefined) {
    set.priorityOverride = sql`CASE WHEN ${ticketTriage.priority} = ${values.priority} THEN NULL ELSE ${values.priority} END`;
  }
  const newest = tx
    .select({ id: ticketTriage.id })
    .from(ticketTriage)
    .where(
      and(
        eq(ticketTriage.workspaceId, workspaceId),
        eq(ticketTriage.ticketId, ticketId),
        eq(ticketTriage.status, "succeeded"),
      ),
    )
    .orderBy(desc(ticketTriage.createdAt), desc(ticketTriage.id))
    .limit(1);
  await tx
    .update(ticketTriage)
    .set(set)
    .where(and(eq(ticketTriage.workspaceId, workspaceId), eq(ticketTriage.id, sql`(${newest})`)));
}
