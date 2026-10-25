CREATE INDEX "ai_draft_citation_chunk_idx" ON "ai_draft_citation" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "ai_draft_citation_document_idx" ON "ai_draft_citation" USING btree ("document_id");
-- Architecture audit F8 (docs/plans/architecture-audit.md). Both columns are ON DELETE SET NULL
-- references to kb_chunk / kb_document. Deleting or re-processing an article deletes its chunks,
-- and Postgres then looks up the matching citations; without an index that is a full scan of
-- ai_draft_citation per deleted row (PostgreSQL docs, 5.5.5). Additive only: no data changes.
-- Plain CREATE INDEX (migrations run in a transaction, so not CONCURRENTLY): the table is small.
-- Rollback: DROP INDEX "ai_draft_citation_chunk_idx"; DROP INDEX "ai_draft_citation_document_idx";
