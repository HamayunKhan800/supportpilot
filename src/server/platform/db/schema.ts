import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    actorType: text("actor_type", { enum: ["user", "system"] }).notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt.desc())],
);
