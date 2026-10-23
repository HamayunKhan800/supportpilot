import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

/**
 * Drizzle schema. Application tables are added milestone by milestone:
 *  - M1: pgvector extension (custom SQL migration 0000)
 *  - M2: Better Auth tables (./auth-schema), workspace_settings, audit_log
 *  - M3: ticket, ticket_message
 *  - M4: kb_document, kb_document_blob, kb_chunk (pgvector), ai_usage (embedding usage)
 *  - M5: ticket_triage, ai_draft, ai_draft_citation, ai_daily_calls; ai_usage outcome/timing columns
 *
 * Tenancy: every application table carries `workspace_id` (= Better Auth organization.id),
 * and every repository query filters by it (docs/02-architecture.md §4).
 */
export * from "./auth-schema";

export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    monthlyTokenBudget: integer("monthly_token_budget").notNull().default(1_000_000),
    triageConfidenceThreshold: real("triage_confidence_threshold").notNull().default(0.7),
    /**
     * Drafts are refused without a model call when the best passage scores below this (M5 D7).
     * 0.65 from the Gemini eval (finding #87): a backstop for clearly off-topic tickets; the
     * model's INSUFFICIENT_KNOWLEDGE answer is the main refusal signal.
     */
    retrievalMinScore: real("retrieval_min_score").notNull().default(0.65),
    /** Optimistic concurrency for the AI settings page (M5 step 5): a stale version returns 409. */
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // A backstop under the API's stricter validation (src/server/modules/settings/limits.ts).
    check(
      "workspace_settings_ranges_ck",
      sql`${t.monthlyTokenBudget} >= 0 AND ${t.triageConfidenceThreshold} BETWEEN 0 AND 1 AND ${t.retrievalMinScore} BETWEEN 0 AND 1 AND ${t.version} > 0`,
    ),
    check("workspace_settings_categories_ck", sql`cardinality(${t.categories}) <= 50`),
  ],
);

/** Append-only: application code inserts and reads; it never updates or deletes rows. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    /** "customer": a portal visitor without an account (identified by ticket, not user). */
    actorType: text("actor_type", { enum: ["user", "system", "customer"] }).notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// M3 · Ticketing (docs/plans/m3-ticketing.md)
// ---------------------------------------------------------------------------

/** PostgreSQL full-text search vector. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const MESSAGE_AUTHOR_TYPES = ["customer", "agent", "system"] as const;

/** Per-workspace ticket numbers (#1, #2, …), incremented atomically with an upsert (D3). */
export const ticketCounter = pgTable("ticket_counter", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  lastNumber: integer("last_number").notNull(),
});

export const ticket = pgTable(
  "ticket",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    subject: text("subject").notNull(),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("open"),
    priority: text("priority", { enum: TICKET_PRIORITIES }).notNull().default("normal"),
    category: text("category"),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    /**
     * Must be a member of this workspace. Enforced by a composite FK to
     * member(organization_id, user_id) with ON DELETE SET NULL (assignee_id), written by
     * hand in drizzle/0002 because Drizzle can't express a column-list SET NULL.
     * Removing someone from the workspace unassigns their tickets automatically.
     */
    assigneeId: text("assignee_id"),
    /** SHA-256 of the customer's tracking token. The token itself is never stored (D1, T6). */
    accessTokenHash: text("access_token_hash").notNull(),
    /** Optimistic concurrency (D4): updates must name the version they read. */
    version: integer("version").notNull().default(1),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * One search document per ticket: subject, customer and every message (incl. notes,
     * agents only search). Maintained by the repository in the same transaction as each
     * message, so negation ("help -laptop") applies to the whole ticket. 'simple' config:
     * no language-specific stemming, so any customer language works.
     */
    searchTsv: tsvector("search_tsv")
      .notNull()
      .default(sql`''::tsvector`),
  },
  (t) => [
    uniqueIndex("ticket_workspace_number_uq").on(t.workspaceId, t.number),
    uniqueIndex("ticket_access_token_hash_uq").on(t.accessTokenHash),
    // Target of the composite FK from ticket_message: a message can only point at a
    // ticket in its own workspace, enforced by the database itself.
    unique("ticket_id_workspace_uq").on(t.id, t.workspaceId),
    index("ticket_workspace_created_idx").on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    index("ticket_workspace_status_created_idx").on(t.workspaceId, t.status, t.createdAt.desc()),
    index("ticket_workspace_assignee_idx").on(t.workspaceId, t.assigneeId),
    index("ticket_search_idx").using("gin", t.searchTsv),
    check("ticket_status_ck", sql.raw(`status IN (${TICKET_STATUSES.map((v) => `'${v}'`).join(", ")})`)),
    check(
      "ticket_priority_ck",
      sql.raw(`priority IN (${TICKET_PRIORITIES.map((v) => `'${v}'`).join(", ")})`),
    ),
    check("ticket_number_positive_ck", sql`${t.number} > 0`),
  ],
);

export const ticketMessage = pgTable(
  "ticket_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Insertion order. created_at can't order a thread: now() is the transaction start,
     * so messages written in one transaction share a timestamp.
     */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull(),
    authorType: text("author_type", { enum: MESSAGE_AUTHOR_TYPES }).notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Internal notes are visible to workspace members only, never to the customer. */
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "ticket_message_ticket_same_workspace_fk",
      columns: [t.ticketId, t.workspaceId],
      foreignColumns: [ticket.id, ticket.workspaceId],
    }).onDelete("cascade"),
    check("ticket_message_internal_by_agent_ck", sql`NOT ${t.isInternal} OR ${t.authorType} = 'agent'`),
    check(
      "ticket_message_author_type_ck",
      sql.raw(`author_type IN (${MESSAGE_AUTHOR_TYPES.map((v) => `'${v}'`).join(", ")})`),
    ),
    index("ticket_message_ticket_seq_idx").on(t.ticketId, t.seq),
  ],
);

/** Fixed-window rate limiter shared by all instances (D7). Keys never contain raw IPs. */
export const appRateLimit = pgTable("app_rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

// ---------------------------------------------------------------------------
// M4 · Knowledge base (docs/plans/m4-knowledge-base.md)
// ---------------------------------------------------------------------------

/**
 * Embedding width, fixed per deployment (D2). 768 is one of Google's recommended sizes for
 * gemini-embedding-2 and stays under pgvector's 2,000-dimension HNSW limit for `vector`.
 * Changing it needs a migration and a full re-embed (`pnpm kb:reembed`).
 */
export const EMBEDDING_DIMENSIONS = 768;

export const KB_DOCUMENT_STATUSES = ["pending", "processing", "ready", "failed"] as const;
export const KB_MIME_TYPES = ["text/markdown", "text/plain", "application/pdf"] as const;
export type KbMimeType = (typeof KB_MIME_TYPES)[number];
export const AI_USAGE_FEATURES = ["triage", "draft", "embed"] as const;
/**
 * What happened to an AI call (M5 D13). `refused`: the draft was refused before any model call
 * (weak retrieval); `blocked`: the output failed a safety check; `invalid`: the model answered
 * with unparseable or schema-invalid output; `error`: the provider failed or rejected the call.
 */
export const AI_USAGE_OUTCOMES = [
  "ok",
  "refused",
  "blocked",
  "invalid",
  "timeout",
  "error",
  "aborted",
] as const;
export type AiUsageOutcome = (typeof AI_USAGE_OUTCOMES)[number];

/** Raw file bytes. Drizzle has no built-in bytea column. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const kbDocument = pgTable(
  "kb_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Display title, derived from the filename. Rendered as plain text only (T11). */
    title: text("title").notNull(),
    /** Original filename, display only. Never used to build a path: files are stored as bytea. */
    filename: text("filename").notNull(),
    /** Detected from the file's content, never taken from the browser's Content-Type (D6). */
    mimeType: text("mime_type", { enum: KB_MIME_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Hex SHA-256 of the file. Unique per workspace: the same file can't be uploaded twice (D7). */
    sha256: text("sha256").notNull(),
    status: text("status", { enum: KB_DOCUMENT_STATUSES }).notNull().default("pending"),
    /** Machine-readable failure reason (mapped to plain language in the UI). */
    errorCode: text("error_code"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    /** e.g. "gemini-embedding-2@768". Set when ready; mixing models in one workspace is refused (D4). */
    embeddingModel: text("embedding_model"),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kb_document_workspace_sha256_uq").on(t.workspaceId, t.sha256),
    // Target of the composite FK from kb_chunk: a chunk can only belong to a document in
    // its own workspace, enforced by the database itself.
    unique("kb_document_id_workspace_uq").on(t.id, t.workspaceId),
    index("kb_document_workspace_created_idx").on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    check("kb_document_status_ck", inList("status", KB_DOCUMENT_STATUSES)),
    check("kb_document_mime_type_ck", inList("mime_type", KB_MIME_TYPES)),
    check("kb_document_size_ck", sql`${t.sizeBytes} > 0`),
    check("kb_document_sha256_ck", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("kb_document_failed_has_reason_ck", sql`${t.status} <> 'failed' OR ${t.errorCode} IS NOT NULL`),
    check("kb_document_ready_has_model_ck", sql`${t.status} <> 'ready' OR ${t.embeddingModel} IS NOT NULL`),
  ],
);

/**
 * The uploaded file, kept only until ingestion succeeds (ADR-0002), so a failed document
 * can be retried. Never served back to anyone (D6).
 */
export const kbDocumentBlob = pgTable("kb_document_blob", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => kbDocument.id, { onDelete: "cascade" }),
  bytes: bytea("bytes").notNull(),
});

export const kbChunk = pgTable(
  "kb_chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    /** Position in the document, from 0. */
    ordinal: integer("ordinal").notNull(),
    /** e.g. "Billing › Refunds". Empty for text without headings. */
    headingPath: text("heading_path").notNull().default(""),
    content: text("content").notNull(),
    /** characters ÷ 4: an estimate, not a tokenizer count (D8). */
    tokenEstimate: integer("token_estimate").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    /**
     * Keyword search. 'english' config (stemming: "syncing" matches "sync"), unlike tickets,
     * because help articles are long-form English prose (D11). Headings weigh more than body.
     */
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english'::regconfig, heading_path), 'A') || setweight(to_tsvector('english'::regconfig, content), 'B')`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "kb_chunk_document_same_workspace_fk",
      columns: [t.documentId, t.workspaceId],
      foreignColumns: [kbDocument.id, kbDocument.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("kb_chunk_document_ordinal_uq").on(t.documentId, t.ordinal),
    index("kb_chunk_workspace_idx").on(t.workspaceId),
    // One HNSW graph for all tenants; queries filter by workspace and use iterative scans
    // so a small workspace still gets k results (D10).
    index("kb_chunk_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("kb_chunk_tsv_idx").using("gin", t.tsv),
    check("kb_chunk_ordinal_ck", sql`${t.ordinal} >= 0`),
    check("kb_chunk_token_estimate_ck", sql`${t.tokenEstimate} > 0`),
  ],
);

/** One row per AI call, for cost reporting and (from M5) the monthly token budget. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    feature: text("feature", { enum: AI_USAGE_FEATURES }).notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** What the call would cost at paid-tier list price, in millionths of a US dollar. */
    estCostMicros: integer("est_cost_micros").notNull().default(0),
    /** M5: rows written before M5 (embeddings) are all successful calls, hence the default. */
    outcome: text("outcome", { enum: AI_USAGE_OUTCOMES }).notNull().default("ok"),
    /** Wall-clock time of the call, from request to last byte (M5 D14). */
    latencyMs: integer("latency_ms"),
    /** Streaming only: time to the first text chunk (NFR-AI2). */
    ttftMs: integer("ttft_ms"),
    /** The ticket the call was about, for per-ticket cost. Kept as history if the ticket goes. */
    ticketId: uuid("ticket_id").references(() => ticket.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_workspace_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("ai_usage_ticket_idx").on(t.ticketId),
    check("ai_usage_feature_ck", inList("feature", AI_USAGE_FEATURES)),
    check("ai_usage_outcome_ck", inList("outcome", AI_USAGE_OUTCOMES)),
    check(
      "ai_usage_tokens_ck",
      sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.estCostMicros} >= 0`,
    ),
    check(
      "ai_usage_timing_ck",
      sql`(${t.latencyMs} IS NULL OR ${t.latencyMs} >= 0) AND (${t.ttftMs} IS NULL OR ${t.ttftMs} >= 0)`,
    ),
  ],
);

/**
 * Global AI call counter per day (M5 D12b), shared by every workspace and process, so a public
 * demo can't use up the provider's free daily quota. One row per (day, scope); a call reserves
 * a slot with one atomic upsert before it reaches the provider. `day` is the calendar date in
 * America/Los_Angeles, because Google resets daily quotas at midnight Pacific time.
 */
export const aiDailyCalls = pgTable(
  "ai_daily_calls",
  {
    day: date("day", { mode: "string" }).notNull(),
    scope: text("scope").notNull(),
    calls: integer("calls").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.scope] }), check("ai_daily_calls_calls_ck", sql`${t.calls} >= 0`)],
);

// ---------------------------------------------------------------------------
// M5 · AI triage and drafts (docs/plans/m5-ai-features.md)
// ---------------------------------------------------------------------------

export const TRIAGE_RUN_STATUSES = ["succeeded", "failed", "skipped"] as const;
export const SENTIMENTS = ["negative", "neutral", "positive"] as const;
export const TRIAGE_FLAGS = ["hidden_characters"] as const;
export type TriageFlag = (typeof TRIAGE_FLAGS)[number];

/**
 * One row per triage run (D4, D5). Kept even when a later run or an agent changes the ticket,
 * so triage accuracy can be measured against what agents chose (FR-AI2).
 */
export const ticketTriage = pgTable(
  "ticket_triage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull(),
    status: text("status", { enum: TRIAGE_RUN_STATUSES }).notNull(),
    /** Why the run failed or was skipped (e.g. ai_budget_exhausted, ai_invalid_output). */
    errorCode: text("error_code"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    category: text("category"),
    priority: text("priority", { enum: TICKET_PRIORITIES }),
    sentiment: text("sentiment", { enum: SENTIMENTS }),
    /** ISO 639-1 code of the customer's language (D15: drafts answer in it). */
    language: text("language"),
    confidence: real("confidence"),
    /** One line from the model. Untrusted text: rendered as plain text only. */
    reason: text("reason"),
    /** Which labels were written to the ticket automatically (D5). */
    appliedCategory: boolean("applied_category").notNull().default(false),
    appliedPriority: boolean("applied_priority").notNull().default(false),
    /** Low confidence, or a field already set by a human: shown as a suggestion (FR-AI2). */
    needsReview: boolean("needs_review").notNull().default(false),
    /** An agent accepted the suggestion or set the field; clears "Needs review". */
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /**
     * The value an agent chose instead of the AI's suggestion: null = agreed or never changed,
     * "" = the agent cleared the category.
     */
    categoryOverride: text("category_override"),
    priorityOverride: text("priority_override", { enum: TICKET_PRIORITIES }),
    latencyMs: integer("latency_ms"),
    /**
     * Warnings for the agent (D10e), e.g. "hidden_characters": invisible Unicode tag characters
     * were removed from the prompt copy. A flagged run is never applied automatically.
     */
    flags: text("flags", { enum: TRIAGE_FLAGS })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "ticket_triage_ticket_same_workspace_fk",
      columns: [t.ticketId, t.workspaceId],
      foreignColumns: [ticket.id, ticket.workspaceId],
    }).onDelete("cascade"),
    index("ticket_triage_ticket_created_idx").on(t.ticketId, t.createdAt.desc()),
    // The inbox "Needs review" filter (D5).
    index("ticket_triage_open_review_idx")
      .on(t.workspaceId, t.ticketId)
      .where(sql`${t.needsReview} AND ${t.reviewedAt} IS NULL`),
    check("ticket_triage_status_ck", inList("status", TRIAGE_RUN_STATUSES)),
    check(
      "ticket_triage_priority_ck",
      sql.raw(`priority IS NULL OR priority IN (${TICKET_PRIORITIES.map((v) => `'${v}'`).join(", ")})`),
    ),
    check(
      "ticket_triage_priority_override_ck",
      sql.raw(
        `priority_override IS NULL OR priority_override IN (${TICKET_PRIORITIES.map((v) => `'${v}'`).join(", ")})`,
      ),
    ),
    check(
      "ticket_triage_sentiment_ck",
      sql.raw(`sentiment IS NULL OR sentiment IN (${SENTIMENTS.map((v) => `'${v}'`).join(", ")})`),
    ),
    check("ticket_triage_language_ck", sql`${t.language} IS NULL OR ${t.language} ~ '^[a-z]{2}$'`),
    check(
      "ticket_triage_confidence_ck",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
    check("ticket_triage_reason_len_ck", sql`${t.reason} IS NULL OR char_length(${t.reason}) <= 200`),
    check(
      "ticket_triage_succeeded_complete_ck",
      sql`${t.status} <> 'succeeded' OR (${t.category} IS NOT NULL AND ${t.priority} IS NOT NULL AND ${t.sentiment} IS NOT NULL AND ${t.language} IS NOT NULL AND ${t.confidence} IS NOT NULL AND ${t.model} IS NOT NULL AND ${t.promptVersion} IS NOT NULL)`,
    ),
    check(
      "ticket_triage_unsuccessful_has_reason_ck",
      sql`${t.status} = 'succeeded' OR ${t.errorCode} IS NOT NULL`,
    ),
    check("ticket_triage_latency_ck", sql`${t.latencyMs} IS NULL OR ${t.latencyMs} >= 0`),
  ],
);

/**
 * Draft lifecycle (D6–D9): generating → ready | refused | blocked | failed | aborted;
 * ready → sent | discarded. `refused` = insufficient knowledge (FR-AI4).
 */
export const AI_DRAFT_STATUSES = [
  "generating",
  "ready",
  "refused",
  "blocked",
  "failed",
  "aborted",
  "sent",
  "discarded",
] as const;
export const DRAFT_FEEDBACK = ["up", "down"] as const;
/** Why a draft got 👎 (FR-AI6), for the M6 evaluation. */
export const DRAFT_FEEDBACK_REASONS = ["incorrect", "incomplete", "wrong_sources", "tone", "other"] as const;

export const aiDraft = pgTable(
  "ai_draft",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull(),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    status: text("status", { enum: AI_DRAFT_STATUSES }).notNull().default("generating"),
    errorCode: text("error_code"),
    /** Generated text after citation validation, with `[n]` markers. Untrusted: plain text only (D9). */
    body: text("body").notNull().default(""),
    language: text("language"),
    /** Null when the draft was refused before any model call. */
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),
    /** Best vector similarity among the retrieved passages (the refusal gate's input, D7). */
    retrievalTopScore: real("retrieval_top_score"),
    /** `[n]` markers that pointed at no passage and were removed (D8). */
    invalidCitationCount: integer("invalid_citation_count").notNull().default(0),
    /** e.g. "unknown_link", "hidden_characters" (D10). Shown to the agent. */
    warnings: text("warnings")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estCostMicros: integer("est_cost_micros").notNull().default(0),
    ttftMs: integer("ttft_ms"),
    latencyMs: integer("latency_ms"),
    /** The reply the agent approved and sent (FR-AI5). */
    sentMessageId: uuid("sent_message_id").references(() => ticketMessage.id, { onDelete: "set null" }),
    /** How much the agent changed before sending: 0 = unchanged, 1 = rewritten. */
    editRatio: real("edit_ratio"),
    feedback: text("feedback", { enum: DRAFT_FEEDBACK }),
    feedbackReason: text("feedback_reason", { enum: DRAFT_FEEDBACK_REASONS }),
    feedbackNote: text("feedback_note"),
    feedbackBy: text("feedback_by").references(() => user.id, { onDelete: "set null" }),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "ai_draft_ticket_same_workspace_fk",
      columns: [t.ticketId, t.workspaceId],
      foreignColumns: [ticket.id, ticket.workspaceId],
    }).onDelete("cascade"),
    // Target of the composite FK from ai_draft_citation.
    unique("ai_draft_id_workspace_uq").on(t.id, t.workspaceId),
    index("ai_draft_ticket_created_idx").on(t.ticketId, t.createdAt.desc()),
    index("ai_draft_workspace_created_idx").on(t.workspaceId, t.createdAt.desc()),
    check("ai_draft_status_ck", inList("status", AI_DRAFT_STATUSES)),
    check(
      "ai_draft_feedback_ck",
      sql.raw(`feedback IS NULL OR feedback IN (${DRAFT_FEEDBACK.map((v) => `'${v}'`).join(", ")})`),
    ),
    // A reason only goes with a thumbs-down.
    check(
      "ai_draft_feedback_reason_ck",
      sql.raw(
        `feedback_reason IS NULL OR (feedback = 'down' AND feedback_reason IN (${DRAFT_FEEDBACK_REASONS.map((v) => `'${v}'`).join(", ")}))`,
      ),
    ),
    check(
      "ai_draft_failed_has_reason_ck",
      sql`${t.status} NOT IN ('failed', 'blocked') OR ${t.errorCode} IS NOT NULL`,
    ),
    check("ai_draft_sent_has_edit_ratio_ck", sql`${t.status} <> 'sent' OR ${t.editRatio} IS NOT NULL`),
    check("ai_draft_language_ck", sql`${t.language} IS NULL OR ${t.language} ~ '^[a-z]{2}$'`),
    check(
      "ai_draft_edit_ratio_ck",
      sql`${t.editRatio} IS NULL OR (${t.editRatio} >= 0 AND ${t.editRatio} <= 1)`,
    ),
    check(
      "ai_draft_counts_ck",
      sql`${t.invalidCitationCount} >= 0 AND ${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.estCostMicros} >= 0 AND (${t.ttftMs} IS NULL OR ${t.ttftMs} >= 0) AND (${t.latencyMs} IS NULL OR ${t.latencyMs} >= 0)`,
    ),
    check(
      "ai_draft_feedback_note_len_ck",
      sql`${t.feedbackNote} IS NULL OR char_length(${t.feedbackNote}) <= 500`,
    ),
  ],
);

/**
 * The passage behind each `[n]` marker, copied at generation time (D8). The copy stays readable
 * when the article is edited or deleted; `chunk_id` then becomes null ("source removed").
 */
export const aiDraftCitation = pgTable(
  "ai_draft_citation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").notNull(),
    /** The n in `[n]`, from 1. */
    marker: integer("marker").notNull(),
    chunkId: uuid("chunk_id").references(() => kbChunk.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => kbDocument.id, { onDelete: "set null" }),
    documentTitle: text("document_title").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    content: text("content").notNull(),
    similarity: real("similarity"),
  },
  (t) => [
    foreignKey({
      name: "ai_draft_citation_draft_same_workspace_fk",
      columns: [t.draftId, t.workspaceId],
      foreignColumns: [aiDraft.id, aiDraft.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("ai_draft_citation_draft_marker_uq").on(t.draftId, t.marker),
    check("ai_draft_citation_marker_ck", sql`${t.marker} BETWEEN 1 AND 20`),
  ],
);
