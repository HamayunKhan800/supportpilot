import { z } from "zod";
import {
  AI_DRAFT_STATUSES,
  AI_USAGE_OUTCOMES,
  DRAFT_FEEDBACK,
  DRAFT_FEEDBACK_REASONS,
  KB_DOCUMENT_STATUSES,
  KB_MIME_TYPES,
  MESSAGE_AUTHOR_TYPES,
  REPORTED_USAGE_FEATURES,
  SENTIMENTS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TRIAGE_FLAGS,
  TRIAGE_RUN_STATUSES,
} from "@/server/platform/db/schema";

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
    reason: z
      .string()
      .optional()
      .describe("Machine-readable reason, e.g. why an uploaded file was rejected."),
    existingDocumentId: z
      .uuid()
      .optional()
      .describe("On a duplicate upload: the document that already has this file."),
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

export const TicketListItem = Ticket.extend({
  needsReview: z.boolean().describe("The AI's triage suggestion is waiting for an agent."),
  draftReady: z
    .boolean()
    .describe("An AI reply draft is ready for an agent to review: not yet sent or discarded."),
}).register(apiRegistry, { id: "TicketListItem" });

export const TicketList = z
  .strictObject({
    items: z.array(TicketListItem),
    nextCursor: z.uuid().nullable().describe("Pass as `after` to get the next page."),
  })
  .register(apiRegistry, { id: "TicketList" });

export const TicketTriage = z
  .strictObject({
    status: z.enum(TRIAGE_RUN_STATUSES),
    errorCode: z
      .string()
      .nullable()
      .describe("Why the run failed or was skipped, e.g. ai_budget_exhausted or ai_invalid_output."),
    suggestion: z
      .strictObject({
        category: z.string(),
        priority: z.enum(TICKET_PRIORITIES),
        sentiment: z.enum(SENTIMENTS),
        language: z.string().nullable().describe("ISO 639-1 code of the customer's language."),
        confidence: z.number().min(0).max(1),
        reason: z.string().nullable().describe("Model-written; display as plain text only."),
      })
      .nullable()
      .describe("Null when the run did not succeed."),
    applied: z
      .strictObject({ category: z.boolean(), priority: z.boolean() })
      .describe("Labels written to the ticket automatically (confident, and not set by an agent)."),
    needsReview: z
      .boolean()
      .describe("A suggestion differs from the ticket and no agent has reviewed it yet."),
    reviewedAt: dateTime.nullable(),
    overrides: z
      .strictObject({ category: z.string().nullable(), priority: z.enum(TICKET_PRIORITIES).nullable() })
      .describe('What an agent chose instead of the suggestion (null: agreed or unchanged; "": cleared).'),
    flags: z.array(z.enum(TRIAGE_FLAGS)).describe("hidden_characters: invisible characters were removed."),
    model: z.string().nullable(),
    promptVersion: z.string().nullable(),
    createdAt: dateTime,
  })
  .register(apiRegistry, { id: "TicketTriage", description: "The newest AI triage run of a ticket." });

export const TicketDetail = z
  .strictObject({
    ticket: Ticket,
    messages: z.array(Message),
    triage: TicketTriage.nullable().describe(
      "Null until the triage job has run (or for tickets never triaged).",
    ),
  })
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

export const KbDocument = z
  .strictObject({
    id: z.uuid(),
    title: z.string().describe("Display title derived from the file name."),
    filename: z.string(),
    mimeType: z
      .enum(KB_MIME_TYPES)
      .describe("Detected from the file's contents, not from the upload headers."),
    sizeBytes: z.int().positive(),
    status: z.enum(KB_DOCUMENT_STATUSES),
    error: z
      .strictObject({ code: z.string(), message: z.string().describe("Plain-language reason.") })
      .nullable()
      .describe("Set when status is `failed`."),
    pageCount: z.int().nonnegative().nullable(),
    chunkCount: z.int().nonnegative(),
    tokenEstimate: z.int().nonnegative().describe("Characters ÷ 4: an estimate, not a tokenizer count."),
    embeddingModel: z.string().nullable(),
    createdAt: dateTime,
    updatedAt: dateTime,
    ingestedAt: dateTime.nullable(),
  })
  .register(apiRegistry, { id: "KbDocument", description: "Stored files are never returned." });

export const KbDocumentList = z
  .strictObject({
    items: z.array(KbDocument),
    usage: z.strictObject({
      documentCount: z.int().nonnegative(),
      totalBytes: z.int().nonnegative(),
      maxDocuments: z.int().positive(),
      maxBytes: z.int().positive(),
    }),
  })
  .register(apiRegistry, { id: "KbDocumentList" });

export const KbChunk = z
  .strictObject({
    id: z.uuid(),
    ordinal: z.int().nonnegative().describe("Position in the document, from 0."),
    headingPath: z.string().describe('Heading trail, e.g. "Billing › Refunds". Empty if none.'),
    content: z.string(),
    tokenEstimate: z.int().positive(),
  })
  .register(apiRegistry, { id: "KbChunk" });

export const KbDocumentDetail = z
  .strictObject({ document: KbDocument, chunks: z.array(KbChunk) })
  .register(apiRegistry, { id: "KbDocumentDetail" });

export const KbSearchResults = z
  .strictObject({
    query: z.string(),
    model: z
      .string()
      .nullable()
      .describe("Embedding model of the workspace's documents; null if none are ready."),
    results: z.array(
      z.strictObject({
        rank: z.int().positive(),
        chunk: KbChunk,
        document: z.strictObject({ id: z.uuid(), title: z.string() }),
        rrfScore: z
          .number()
          .nonnegative()
          .describe(
            "Weighted Reciprocal Rank Fusion score (k = 60). Keyword matches have weight 0 (ADR-0014), " +
              "so this follows the meaning-based rank; 0 means only keyword search found the passage.",
          ),
        matchedBy: z.array(z.enum(["vector", "keyword"])).min(1),
        vector: z
          .strictObject({ rank: z.int().positive(), similarity: z.number().describe("Cosine similarity.") })
          .nullable(),
        keyword: z.strictObject({ rank: z.int().positive(), score: z.number() }).nullable(),
      }),
    ),
    timingsMs: z.strictObject({ embedding: z.number().nonnegative(), retrieval: z.number().nonnegative() }),
  })
  .register(apiRegistry, { id: "KbSearchResults" });

// ---------------------------------------------------------------------------
// AI reply drafts (M5 D6–D9)
// ---------------------------------------------------------------------------

export const AiDraft = z
  .strictObject({
    id: z.uuid(),
    ticketId: z.uuid(),
    status: z.enum(AI_DRAFT_STATUSES),
    errorCode: z
      .string()
      .nullable()
      .describe(
        "Why the draft is not ready, e.g. no_passages, below_min_score, model_insufficient_knowledge (refused) or canary_leak (blocked).",
      ),
    body: z
      .string()
      .describe(
        "Untrusted model output with [n] citation markers. Render as plain text only: never as HTML or Markdown (D9). Empty unless ready.",
      ),
    language: z.string().nullable().describe("ISO 639-1 code the draft was asked to use (from triage)."),
    model: z.string().nullable().describe("Null when the draft was refused before any model call."),
    promptVersion: z.string(),
    retrievalTopScore: z.number().nullable().describe("Best vector similarity among the retrieved passages."),
    invalidCitationCount: z
      .int()
      .nonnegative()
      .describe("Markers that pointed at no passage and were removed."),
    warnings: z
      .array(z.string())
      .describe(
        "For the agent: hidden_characters, unknown_link, invalid_citations, no_citations, truncated.",
      ),
    citations: z.array(
      z.strictObject({
        marker: z.int().positive().describe("The n in [n]."),
        documentId: z.uuid().nullable(),
        documentTitle: z.string(),
        headingPath: z.string(),
        content: z.string().describe("The passage as it was when the draft was written."),
        similarity: z.number().nullable(),
        sourceRemoved: z.boolean().describe("The passage was deleted or replaced since (FR-K3)."),
      }),
    ),
    usage: z.strictObject({
      inputTokens: z.int().nonnegative(),
      outputTokens: z.int().nonnegative(),
      estCostMicros: z
        .int()
        .nonnegative()
        .describe("Estimated cost in millionths of a US dollar (paid-tier prices)."),
    }),
    sentMessageId: z.uuid().nullable().describe("The reply this draft became after an agent approved it."),
    editRatio: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe("How much the agent changed it before sending: 0 = unchanged, 1 = rewritten."),
    feedback: z
      .strictObject({
        rating: z.enum(DRAFT_FEEDBACK),
        reason: z.enum(DRAFT_FEEDBACK_REASONS).nullable(),
        note: z.string().nullable(),
      })
      .nullable(),
    ttftMs: z.int().nonnegative().nullable().describe("Request to first streamed word, retrieval included."),
    latencyMs: z.int().nonnegative().nullable().describe("Request to finished draft, retrieval included."),
    createdAt: dateTime,
  })
  .register(apiRegistry, { id: "AiDraft" });

export const DraftStreamEvent = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("start"), draftId: z.uuid() }),
    z.strictObject({ type: z.literal("delta"), text: z.string().min(1) }),
    z.strictObject({ type: z.literal("done"), draft: AiDraft }),
    z.strictObject({
      type: z.literal("error"),
      draftId: z.uuid(),
      code: z.string(),
      message: z.string().describe("Plain-language explanation for the agent."),
      retryable: z.boolean(),
      retryAfterSeconds: z.int().positive().optional(),
    }),
  ])
  .describe(
    "One event per line (NDJSON): start, then delta events while the draft is written, then exactly one done (ready, refused or blocked) or error. The draft in done is authoritative; streamed text is a preview before citation checks.",
  )
  .register(apiRegistry, { id: "DraftStreamEvent" });

// ---------------------------------------------------------------------------
// AI settings (M5 step 5)
// ---------------------------------------------------------------------------

export const AiSettingsView = z
  .strictObject({
    settings: z.strictObject({
      version: z.int().positive().describe("Send back with updates (optimistic concurrency)."),
      aiEnabled: z.boolean().describe("Off: no triage and no drafts. Everything else keeps working."),
      monthlyTokenBudget: z
        .int()
        .nonnegative()
        .describe("Triage and draft tokens allowed per calendar month (UTC). 0 pauses AI generation."),
      triageConfidenceThreshold: z
        .number()
        .describe("Triage labels at or above this confidence are applied automatically."),
      retrievalMinScore: z
        .number()
        .describe(
          "Drafts are refused without an AI call when no passage reaches this cosine similarity. Gemini embedding scale.",
        ),
      retrievalMinScoreApplies: z
        .boolean()
        .describe("False when the deployment uses the offline mock embedder, which has its own fixed floor."),
      categories: z.array(z.string()).describe("What triage can choose from, and what agents can set."),
      updatedAt: dateTime,
    }),
    usage: z.strictObject({
      since: dateTime.describe("Start of this month (UTC): the budget's window."),
      budgetTokensUsed: z.int().nonnegative().describe("Triage and draft tokens this month."),
      features: z.array(
        z.strictObject({
          feature: z.enum(REPORTED_USAGE_FEATURES),
          countsTowardBudget: z.boolean().describe("Embeddings are tracked but not counted."),
          calls: z.int().nonnegative(),
          inputTokens: z.int().nonnegative(),
          outputTokens: z.int().nonnegative(),
          estimatedCostUsd: z
            .number()
            .nonnegative()
            .describe("What these calls would cost at paid-tier list prices. The free tier costs nothing."),
          outcomes: z
            .partialRecord(z.enum(AI_USAGE_OUTCOMES), z.int().positive())
            .describe("Calls per outcome, e.g. ok, refused, timeout, error."),
        }),
      ),
    }),
  })
  .register(apiRegistry, { id: "AiSettings" });

// Path parameters (documented formats; malformed values are answered with 404).
export const SlugParams = z.object({ slug: z.string().min(1).max(100) });
export const TokenParams = z.object({
  token: z.string().describe("Secret tracking token from the tracking link (43 characters, base64url)."),
});
export const TicketIdParams = z.object({ id: z.uuid() });
export const KbDocumentIdParams = z.object({ id: z.uuid() });
export const DraftIdParams = z.object({ id: z.uuid() });
