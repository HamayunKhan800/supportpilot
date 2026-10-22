/**
 * Public ticket types and value lists for the app layer, which may not import the DB
 * layer directly (eslint no-restricted-imports). Client components should use
 * `import type` from here so no server code reaches the browser bundle.
 */
export type { Message, Ticket, TicketPriority, TicketStatus } from "./repository";
export { TICKET_PRIORITIES, TICKET_STATUSES } from "@/server/platform/db/schema";
