import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
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
 *  - M5: ticket_triage, ai_draft
 *
 * Tenancy: every application table carries `workspace_id` (= Better Auth organization.id),
 * and every repository query filters by it (docs/02-architecture.md §4).
 */
export * from "./auth-schema";

export const workspaceSettings = pgTable("workspace_settings", {
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
  retrievalMinScore: real("retrieval_min_score").notNull().default(0.5),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
export const AI_USAGE_FEATURES = ["triage", "draft", "embed"] as const;

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_workspace_created_idx").on(t.workspaceId, t.createdAt.desc()),
    check("ai_usage_feature_ck", inList("feature", AI_USAGE_FEATURES)),
    check(
      "ai_usage_tokens_ck",
      sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.estCostMicros} >= 0`,
    ),
  ],
);
