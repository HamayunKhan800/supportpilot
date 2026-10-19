# ADR-0002 · PostgreSQL 17 + pgvector as the only datastore
Status: Accepted · Date: 2026-10-19

## Decision
Use one PostgreSQL database for relational data, vector embeddings (pgvector, HNSW index), full-text search (tsvector) and the job queue (pg-boss). Uploaded files are stored temporarily as `bytea` and deleted after ingestion.

## Why
PostgreSQL is the most-used database in the Stack Overflow 2026 survey (57.9%). Keeping vectors next to tenant data lets every vector query filter by `workspace_id` in the same SQL. That is simpler to secure than syncing to a separate vector DB.

## Alternatives
Dedicated vector DB (Pinecone/Qdrant): another service, another secret, cross-system tenancy filtering. Object storage (S3/R2) for files: a better choice at scale, deferred because files are transient and ≤ 5 MB.

## Consequences
+ One backup, one connection string, transactional job enqueueing. − Vector search performance is bounded by Postgres resources (fine at demo scale). − The embedding dimension is fixed per deployment, so changing the embedding model requires re-embedding (a migration script will be provided).
