import type { z } from "zod";
import {
  agentMessageInput,
  customerReplyInput,
  portalTicketInput,
  ticketListQuery,
  ticketPatchInput,
} from "@/server/modules/tickets/schemas";
import {
  CustomerTicket,
  MessageCreated,
  PortalTicketCreated,
  SlugParams,
  Ticket,
  TicketDetail,
  TicketIdParams,
  TicketList,
  TokenParams,
} from "./schemas";

/**
 * Single source of truth for /api/v1: the same definitions validate requests (see
 * ./route.ts) and generate the OpenAPI document (see ./openapi.ts), so the docs can't
 * drift from what the server enforces.
 */
export interface Operation<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
> {
  id: string;
  method: "GET" | "POST" | "PATCH";
  /** OpenAPI path template, e.g. /api/v1/tickets/{id}. */
  path: string;
  summary: string;
  description?: string;
  tag: "Portal" | "Tickets" | "Meta";
  /** public: no credentials · session: signed-in workspace member · tracking-token: secret path token. */
  auth: "public" | "session" | "tracking-token";
  params?: P;
  query?: Q;
  body?: B;
  success: { status: 200 | 201; description: string; schema?: z.ZodType };
  /** Problem statuses this operation can return (documented in OpenAPI). */
  errors: readonly number[];
}

const define = <P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType>(op: Operation<P, Q, B>) => op;

export const operations = {
  createPortalTicket: define({
    id: "createPortalTicket",
    method: "POST",
    path: "/api/v1/portal/{slug}/tickets",
    summary: "Submit a support request",
    description:
      "Public. Rate limited per client and per workspace. Returns a secret tracking link exactly once. " +
      "`website` is a honeypot and must be left empty.",
    tag: "Portal",
    auth: "public",
    params: SlugParams,
    body: portalTicketInput,
    success: { status: 201, description: "Request created.", schema: PortalTicketCreated },
    errors: [400, 404, 413, 415, 429],
  }),
  getCustomerTicket: define({
    id: "getCustomerTicket",
    method: "GET",
    path: "/api/v1/portal/t/{token}",
    summary: "Read a request as the customer",
    tag: "Portal",
    auth: "tracking-token",
    params: TokenParams,
    success: { status: 200, description: "The customer's view of the request.", schema: CustomerTicket },
    errors: [404],
  }),
  addCustomerReply: define({
    id: "addCustomerReply",
    method: "POST",
    path: "/api/v1/portal/t/{token}/messages",
    summary: "Reply as the customer",
    description: "Reopens a pending or resolved request. Closed requests return 409.",
    tag: "Portal",
    auth: "tracking-token",
    params: TokenParams,
    body: customerReplyInput,
    success: {
      status: 201,
      description: "Reply added; returns the updated request.",
      schema: CustomerTicket,
    },
    errors: [400, 404, 409, 413, 415, 429],
  }),
  listTickets: define({
    id: "listTickets",
    method: "GET",
    path: "/api/v1/tickets",
    summary: "List the queue",
    description: "Filters, full-text search (`q`, websearch syntax or `#number`) and keyset pagination.",
    tag: "Tickets",
    auth: "session",
    query: ticketListQuery,
    success: { status: 200, description: "A page of tickets.", schema: TicketList },
    errors: [400, 401, 403],
  }),
  getTicket: define({
    id: "getTicket",
    method: "GET",
    path: "/api/v1/tickets/{id}",
    summary: "Get a ticket with its full thread",
    tag: "Tickets",
    auth: "session",
    params: TicketIdParams,
    success: {
      status: 200,
      description: "Ticket and messages, including internal notes.",
      schema: TicketDetail,
    },
    errors: [401, 403, 404],
  }),
  updateTicket: define({
    id: "updateTicket",
    method: "PATCH",
    path: "/api/v1/tickets/{id}",
    summary: "Change status, priority, category or assignee",
    description: "Send the `version` you last read; a stale version returns 409. Each change is audited.",
    tag: "Tickets",
    auth: "session",
    params: TicketIdParams,
    body: ticketPatchInput,
    success: { status: 200, description: "The updated ticket.", schema: Ticket },
    errors: [400, 401, 403, 404, 409, 413, 415],
  }),
  addTicketMessage: define({
    id: "addTicketMessage",
    method: "POST",
    path: "/api/v1/tickets/{id}/messages",
    summary: "Post a public reply or an internal note",
    tag: "Tickets",
    auth: "session",
    params: TicketIdParams,
    body: agentMessageInput,
    success: { status: 201, description: "Message added.", schema: MessageCreated },
    errors: [400, 401, 403, 404, 409, 413, 415],
  }),
  getOpenApi: define({
    id: "getOpenApi",
    method: "GET",
    path: "/api/v1/openapi.json",
    summary: "This API description (OpenAPI 3.1)",
    tag: "Meta",
    auth: "public",
    success: { status: 200, description: "OpenAPI document." },
    errors: [],
  }),
} as const;

export type OperationId = keyof typeof operations;
