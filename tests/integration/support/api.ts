import { operations, type Operation } from "@/server/api/operations";
import * as openapiRoute from "@/app/api/v1/openapi.json/route";
import * as portalTicketsRoute from "@/app/api/v1/portal/[slug]/tickets/route";
import * as trackingRoute from "@/app/api/v1/portal/t/[token]/route";
import * as trackingMessagesRoute from "@/app/api/v1/portal/t/[token]/messages/route";
import * as ticketsRoute from "@/app/api/v1/tickets/route";
import * as ticketRoute from "@/app/api/v1/tickets/[id]/route";
import * as ticketMessagesRoute from "@/app/api/v1/tickets/[id]/messages/route";
import * as triageAcceptRoute from "@/app/api/v1/tickets/[id]/triage/accept/route";
import * as draftsRoute from "@/app/api/v1/tickets/[id]/drafts/route";
import * as draftSendRoute from "@/app/api/v1/drafts/[id]/send/route";
import * as draftDiscardRoute from "@/app/api/v1/drafts/[id]/discard/route";
import * as draftFeedbackRoute from "@/app/api/v1/drafts/[id]/feedback/route";
import * as kbDocumentsRoute from "@/app/api/v1/kb/documents/route";
import * as kbDocumentRoute from "@/app/api/v1/kb/documents/[id]/route";
import * as kbRetryRoute from "@/app/api/v1/kb/documents/[id]/retry/route";
import * as kbSearchRoute from "@/app/api/v1/kb/search/route";
import * as aiSettingsRoute from "@/app/api/v1/settings/ai/route";
import { ORIGIN, type TestClient } from "./client";

/**
 * Calls /api/v1 route handlers directly, as Next.js would: the operation registry supplies
 * the method and path template. A FormData body is sent as multipart (fetch adds the boundary).
 */
export type OpId = keyof typeof operations;
type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export const handlers: Record<OpId, RouteHandler> = {
  createPortalTicket: portalTicketsRoute.POST,
  getCustomerTicket: trackingRoute.GET,
  addCustomerReply: trackingMessagesRoute.POST,
  listTickets: ticketsRoute.GET,
  getTicket: ticketRoute.GET,
  updateTicket: ticketRoute.PATCH,
  acceptTriageSuggestion: triageAcceptRoute.POST,
  generateDraft: draftsRoute.POST,
  sendDraft: draftSendRoute.POST,
  discardDraft: draftDiscardRoute.POST,
  rateDraft: draftFeedbackRoute.POST,
  addTicketMessage: ticketMessagesRoute.POST,
  listKbDocuments: kbDocumentsRoute.GET,
  uploadKbDocument: kbDocumentsRoute.POST,
  getKbDocument: kbDocumentRoute.GET,
  deleteKbDocument: kbDocumentRoute.DELETE,
  retryKbDocument: kbRetryRoute.POST,
  searchKb: kbSearchRoute.POST,
  getAiSettings: aiSettingsRoute.GET,
  updateAiSettings: aiSettingsRoute.PATCH,
  getOpenApi: openapiRoute.GET,
};

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Raw body, sent as-is (overrides `body`). */
  raw?: BodyInit;
  as?: TestClient;
  headers?: Record<string, string>;
  /** Omit the same-origin Origin header that a browser would send. */
  noOrigin?: boolean;
  /** Aborts the request, as a browser does when the agent leaves the page. */
  signal?: AbortSignal;
}

/** Sends the request and returns the Response unread (for streaming tests). */
export async function send(id: OpId, opts: CallOptions = {}): Promise<Response> {
  const op: Operation = operations[id];
  const params = opts.params ?? {};
  const path = op.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
  const url = new URL(path, ORIGIN);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const headers = new Headers(opts.as?.headers);
  const multipart = opts.body instanceof FormData; // fetch sets the multipart boundary itself
  if (op.method !== "GET") {
    if (!opts.noOrigin) headers.set("origin", ORIGIN);
    if (!multipart) headers.set("content-type", "application/json");
  }
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);

  const body =
    op.method === "GET"
      ? undefined
      : (opts.raw ?? (multipart ? (opts.body as FormData) : JSON.stringify(opts.body ?? {})));
  const req = new Request(url, {
    method: op.method,
    headers,
    body,
    duplex: "half",
    signal: opts.signal,
  } as RequestInit);
  return handlers[id](req, { params: Promise.resolve(params) });
}

/**
 * Sends the request and reads the whole body. NDJSON streams are parsed into `events`
 * (one object per line); other bodies into `json`.
 */
export async function call(id: OpId, opts: CallOptions = {}) {
  const res = await send(id, opts);
  const text = await res.text();
  const ndjson = (res.headers.get("content-type") ?? "").startsWith("application/x-ndjson");
  return {
    status: res.status,
    headers: res.headers,
    json: !ndjson && text ? JSON.parse(text) : undefined,
    events: ndjson ? parseNdjson(text) : [],
  };
}

export function parseNdjson(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
