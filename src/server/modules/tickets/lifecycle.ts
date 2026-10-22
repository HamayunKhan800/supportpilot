import type { TicketStatus } from "./repository";

/**
 * Ticket lifecycle (FR-T4, plan D2): open → pending → resolved → closed, with reopen
 * from resolved. `closed` is final: the customer starts a new request instead.
 * Same-status "changes" are not transitions; services treat them as no-ops.
 */
export const AGENT_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export function canAgentTransition(from: TicketStatus, to: TicketStatus): boolean {
  return AGENT_TRANSITIONS[from].includes(to);
}

/** Customers can reply until the ticket is closed. */
export function canCustomerReply(status: TicketStatus): boolean {
  return status !== "closed";
}

/** A customer reply on a waiting or resolved ticket puts it back in the queue. */
export function statusAfterCustomerReply(status: TicketStatus): TicketStatus {
  if (status === "closed") throw new Error("closed tickets do not accept replies");
  return "open";
}

/** Agents can always add internal notes. Public replies stop once a ticket is closed. */
export function canAgentPost(status: TicketStatus, internal: boolean): boolean {
  return internal || status !== "closed";
}
