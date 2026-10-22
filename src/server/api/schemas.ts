import { z } from "zod";
import { MESSAGE_AUTHOR_TYPES, TICKET_PRIORITIES, TICKET_STATUSES } from "@/server/platform/db/schema";

/**
 * Response contracts for /api/v1. Strict objects: contract tests parse real responses
 * with these, so any extra field (an accidental data leak) fails a test. Each schema
 * has an `id`, so the OpenAPI document references it from components.schemas.
 */
const dateTime = z.iso.datetime();

/** Registry of response schemas → OpenAPI components.schemas (see ./openapi.ts). */
export const apiRegistry = z.registry<{ id: string; description?: string }>();

export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.record(z.string(), z.array(z.string())).optional(),
  })
  .register(apiRegistry, { id: "Problem", description: "RFC 9457 Problem Details." });

export const Ticket = z
  .strictObject({
    id: z.uuid(),
    number: z.int().positive().describe("Per-workspace ticket number (#1, #2, …)."),
    subject: z.string(),
    status: z.enum(TICKET_STATUSES),
    priority: z.enum(TICKET_PRIORITIES),
    category: z.string().nullable(),
    customer: z.strictObject({ name: z.string(), email: z.string() }),
    assignee: z.strictObject({ id: z.string(), name: z.string().nullable() }).nullable(),
    version: z.int().positive().describe("Send back with updates (optimistic concurrency)."),
    createdAt: dateTime,
    updatedAt: dateTime,
    lastActivityAt: dateTime,
  })
  .register(apiRegistry, { id: "Ticket" });

export const Message = z
  .strictObject({
    id: z.uuid(),
    author: z.strictObject({
      type: z.enum(MESSAGE_AUTHOR_TYPES),
      userId: z.string().nullable(),
      name: z.string().nullable(),
    }),
    body: z.string(),
    internal: z.boolean().describe("Internal notes are never shown to the customer."),
    createdAt: dateTime,
  })
  .register(apiRegistry, { id: "Message" });

export const TicketList = z
  .strictObject({
    items: z.array(Ticket),
    nextCursor: z.uuid().nullable().describe("Pass as `after` to get the next page."),
  })
  .register(apiRegistry, { id: "TicketList" });

export const TicketDetail = z
  .strictObject({ ticket: Ticket, messages: z.array(Message) })
  .register(apiRegistry, { id: "TicketDetail" });

export const MessageCreated = z
  .strictObject({ id: z.uuid(), createdAt: dateTime })
  .register(apiRegistry, { id: "MessageCreated" });

export const PortalTicketCreated = z
  .strictObject({
    trackingUrl: z.url().describe("Secret link for the customer. Returned once; only a hash is stored."),
  })
  .register(apiRegistry, { id: "PortalTicketCreated" });

export const CustomerTicket = z
  .strictObject({
    workspaceName: z.string(),
    number: z.int().positive(),
    subject: z.string(),
    status: z.enum(TICKET_STATUSES),
    createdAt: dateTime,
    canReply: z.boolean(),
    messages: z.array(
      z.strictObject({
        id: z.uuid(),
        from: z.enum(["customer", "support"]),
        authorName: z.string().nullable(),
        body: z.string(),
        createdAt: dateTime,
      }),
    ),
  })
  .register(apiRegistry, {
    id: "CustomerTicket",
    description: "The customer's view: no internal notes, assignee or internal ids.",
  });

// Path parameters (documented formats; malformed values are answered with 404).
export const SlugParams = z.object({ slug: z.string().min(1).max(100) });
export const TokenParams = z.object({
  token: z.string().describe("Secret tracking token from the tracking link (43 characters, base64url)."),
});
export const TicketIdParams = z.object({ id: z.uuid() });
