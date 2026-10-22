import type { Message, Ticket } from "@/server/modules/tickets/repository";

/**
 * Explicit mapping from domain rows to API shapes: fields are opted in one by one, so
 * new database columns never leak into responses by accident.
 */
export function apiTicket(t: Ticket, assigneeName?: string | null) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    customer: { name: t.customerName, email: t.customerEmail },
    assignee: t.assigneeId ? { id: t.assigneeId, name: assigneeName ?? null } : null,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastActivityAt: t.lastActivityAt,
  };
}

export function apiMessage(m: Message) {
  return {
    id: m.id,
    author: { type: m.authorType, userId: m.authorUserId, name: m.authorName },
    body: m.body,
    internal: m.isInternal,
    createdAt: m.createdAt,
  };
}
