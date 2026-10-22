/**
 * Loads DEMO_TICKETS into a workspace through the same repository functions the app uses,
 * so numbering, the search index and the message order follow the normal rules.
 *
 * - Idempotent: does nothing if the workspace already has tickets.
 * - All or nothing: one transaction.
 * - Timestamps are relative to `now`, so the demo always looks recent.
 * - Tracking tokens are generated and immediately discarded: the customers are fictional,
 *   so nobody can open these tickets through /t/{token}, and no token is printed.
 * - No audit events are written. The audit log records real actions only, and these
 *   tickets were not created by real people.
 */
import { and, eq, sql } from "drizzle-orm";
import { ticket, ticketMessage } from "@/server/platform/db/schema";
import * as repo from "../repository";
import { generateTrackingToken } from "../tracking-token";
import { DEMO_TICKETS, type DemoTicket, type StaffRole } from "./tickets";

const HOUR = 3_600_000;

export async function seedDemoTickets(
  workspaceId: string,
  staff: Record<StaffRole, string>,
  now: Date = new Date(),
  tickets: DemoTicket[] = DEMO_TICKETS,
): Promise<number> {
  return repo.transaction(async (tx) => {
    // Serialise concurrent seed runs for this workspace, then seed only an empty one.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"demo-seed:" + workspaceId}))`);
    const [existing] = await tx
      .select({ id: ticket.id })
      .from(ticket)
      .where(eq(ticket.workspaceId, workspaceId))
      .limit(1);
    if (existing) return 0;

    // Oldest first, so ticket numbers follow creation time like real traffic.
    const ordered = [...tickets].sort((a, b) => b.ageHours - a.ageHours);
    for (const d of ordered) {
      const openedAt = new Date(now.getTime() - d.ageHours * HOUR);
      const created = await repo.insertTicket(tx, workspaceId, {
        subject: d.subject,
        customerName: d.customer.name,
        customerEmail: d.customer.email,
        accessTokenHash: generateTrackingToken().hash,
        firstMessage: d.message,
      });
      await tx
        .update(ticketMessage)
        .set({ createdAt: openedAt })
        .where(and(eq(ticketMessage.workspaceId, workspaceId), eq(ticketMessage.ticketId, created.id)));

      let lastActivity = openedAt;
      for (const m of d.thread) {
        const row = await repo.insertMessage(tx, workspaceId, created.id, {
          authorType: m.from === "customer" ? "customer" : "agent",
          authorUserId: m.from === "customer" ? null : staff[m.from],
          body: m.body,
          isInternal: m.internal ?? false,
        });
        const at = new Date(openedAt.getTime() + m.afterHours * HOUR);
        await tx.update(ticketMessage).set({ createdAt: at }).where(eq(ticketMessage.id, row.id));
        lastActivity = at;
      }

      await tx
        .update(ticket)
        .set({
          status: d.status,
          priority: d.priority,
          category: d.category,
          assigneeId: d.assignee ? staff[d.assignee] : null,
          createdAt: openedAt,
          lastActivityAt: lastActivity,
          updatedAt: lastActivity,
        })
        .where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, created.id)));
    }
    return ordered.length;
  });
}
