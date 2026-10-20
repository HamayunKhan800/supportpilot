/**
 * Drizzle schema. Application tables are added milestone by milestone:
 *  - M2: Better Auth tables, workspace_settings, audit_log, rate_limit
 *  - M3: ticket, ticket_message
 *  - M4: kb_document, kb_document_blob, kb_chunk (pgvector)
 *  - M5: ticket_triage, ai_draft, ai_usage
 *
 * M1 contains only the pgvector extension (custom SQL migration 0000).
 */
export {};
