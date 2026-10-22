import type { z } from "zod";
import { KB_MAX_UPLOAD_BYTES } from "@/server/modules/kb/limits";
import { kbSearchInput } from "@/server/modules/kb/schemas";
import type { Permission } from "@/server/platform/auth/permissions";
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
  KbDocument,
  KbDocumentDetail,
  KbDocumentIdParams,
  KbDocumentList,
  KbSearchResults,
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
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** OpenAPI path template, e.g. /api/v1/tickets/{id}. */
  path: string;
  summary: string;
  description?: string;
  tag: "Portal" | "Tickets" | "Knowledge" | "Meta";
  /** public: no credentials · session: signed-in workspace member · tracking-token: secret path token. */
  auth: "public" | "session" | "tracking-token";
  /**
   * Session operations: the permission the service checks (docs/01 §2.1). Documented in
   * OpenAPI as the roles that hold it, and a generated test checks every role against it.
   */
  permission?: Permission;
  params?: P;
  query?: Q;
  /** JSON body schema. */
  body?: B;
  /** multipart/form-data with one file in `field` (instead of a JSON body). */
  upload?: { field: string; maxFileBytes: number; description: string };
  success: { status: 200 | 201 | 204; description: string; schema?: z.ZodType };
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
    permission: { ticket: ["read"] },
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
    permission: { ticket: ["read"] },
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
    permission: { ticket: ["update"] },
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
    permission: { ticket: ["update"] },
    params: TicketIdParams,
    body: agentMessageInput,
    success: { status: 201, description: "Message added.", schema: MessageCreated },
    errors: [400, 401, 403, 404, 409, 413, 415],
  }),
  listKbDocuments: define({
    id: "listKbDocuments",
    method: "GET",
    path: "/api/v1/kb/documents",
    summary: "List knowledge-base documents",
    description: "Newest first, with ingestion status and the workspace's storage use.",
    tag: "Knowledge",
    auth: "session",
    permission: { kb: ["read"] },
    success: { status: 200, description: "All documents of the workspace.", schema: KbDocumentList },
    errors: [401, 403],
  }),
  uploadKbDocument: define({
    id: "uploadKbDocument",
    method: "POST",
    path: "/api/v1/kb/documents",
    summary: "Upload a document",
    description:
      "Accepts .md, .txt and .pdf. The type is decided from the file name and its contents; the " +
      "browser's Content-Type is ignored. Ingestion runs in the background: poll the document " +
      "until `status` is `ready` or `failed`. Uploading the same file twice returns 409 with " +
      "`existingDocumentId`. Rate limited per user.",
    tag: "Knowledge",
    auth: "session",
    permission: { kb: ["write"] },
    upload: {
      field: "file",
      maxFileBytes: KB_MAX_UPLOAD_BYTES,
      description: "The document (.md, .markdown, .txt or .pdf, at most 5 MB).",
    },
    success: { status: 201, description: "Stored and queued for ingestion.", schema: KbDocument },
    errors: [400, 401, 403, 409, 413, 415, 429],
  }),
  getKbDocument: define({
    id: "getKbDocument",
    method: "GET",
    path: "/api/v1/kb/documents/{id}",
    summary: "Get a document and the passages it was split into",
    tag: "Knowledge",
    auth: "session",
    permission: { kb: ["read"] },
    params: KbDocumentIdParams,
    success: {
      status: 200,
      description: "The document with its chunks, in order.",
      schema: KbDocumentDetail,
    },
    errors: [401, 403, 404],
  }),
  deleteKbDocument: define({
    id: "deleteKbDocument",
    method: "DELETE",
    path: "/api/v1/kb/documents/{id}",
    summary: "Delete a document",
    description: "Its passages stop appearing in search immediately, even if ingestion is still running.",
    tag: "Knowledge",
    auth: "session",
    permission: { kb: ["write"] },
    params: KbDocumentIdParams,
    success: { status: 204, description: "Deleted." },
    errors: [401, 403, 404],
  }),
  retryKbDocument: define({
    id: "retryKbDocument",
    method: "POST",
    path: "/api/v1/kb/documents/{id}/retry",
    summary: "Retry a failed document",
    description: "Only `failed` documents can be retried; others return 409. Rate limited with uploads.",
    tag: "Knowledge",
    auth: "session",
    permission: { kb: ["write"] },
    params: KbDocumentIdParams,
    success: { status: 200, description: "Queued again (status `pending`).", schema: KbDocument },
    errors: [401, 403, 404, 409, 429],
  }),
  searchKb: define({
    id: "searchKb",
    method: "POST",
    path: "/api/v1/kb/search",
    summary: "Test search: which passages would retrieval use for this question?",
    description:
      "Hybrid retrieval: meaning-based (vector) top 8 and keyword top 8, merged with Reciprocal " +
      "Rank Fusion (k = 60), best 5 returned. Each result says which search found it. " +
      "Returns 409 if the workspace's documents were embedded with different models. Rate limited per user.",
    tag: "Knowledge",
    auth: "session",
    permission: { kb: ["write"] },
    body: kbSearchInput,
    success: { status: 200, description: "Up to 5 passages, best first.", schema: KbSearchResults },
    errors: [400, 401, 403, 409, 413, 415, 429, 502, 503],
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
