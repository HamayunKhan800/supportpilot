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
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

/**
 * Drizzle schema. Application tables are added milestone by milestone:
 *  - M1: pgvector extension (custom SQL migration 0000)
 *  - M2: Better Auth tables (./auth-schema), workspace_settings, audit_log
 *  - M3: ticket, ticket_message
 *  - M4: kb_document, kb_document_blob, kb_chunk (pgvector)
 *  - M5: ticket_triage, ai_draft, ai_usage
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
