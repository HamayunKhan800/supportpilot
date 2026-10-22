# ADR-0013 · Embedding model, dimensions and sandboxed PDF parsing

Status: Accepted · Date: 2026-10-22 · Details: [M4 plan](../plans/m4-knowledge-base.md) D1–D5 · Results: [retrieval baseline](../eval/retrieval-baseline.md)

## Context

The knowledge base (M4) turns uploaded help articles into passages that search, and later AI drafts (M5), can use. Two decisions are hard to change later:

1. **The embedding model and vector size.** Every stored vector depends on them, and vectors from different models can't be compared.
2. **How untrusted PDFs are parsed.** Any admin can upload one, and PDF parsers have a history of serious bugs (CVE-2024-4367: code execution in PDF.js up to 4.1.392).

Constraints: free-tier hosting and AI (ADR-0006, ADR-0008), one PostgreSQL database with pgvector (ADR-0002), and tests that run without network or secrets.

## Decision

**Model: Google `gemini-embedding-2`** via the Vercel AI SDK (`@ai-sdk/google`).

- Not `gemini-embedding-001`: Google's deprecations page lists it for shutdown on 2028-05-14, with `gemini-embedding-2` (no shutdown date) as its replacement. The newer model also takes 8,192 input tokens instead of 2,048.
- It has no `task_type` setting, so the input carries the task prefixes Google recommends: `title: {document › section} | text: {passage}` for passages and `task: search result | query: {question}` for questions. Unit tests pin the exact strings.
- Text embedding is free on the free tier ($0.20 per million tokens on the paid tier). Free-tier inputs may be used by Google to improve its products, so the demo uses **synthetic data only** and the upload page says so (plan D14).

**768 dimensions, HNSW index, cosine distance.**

- 768 is one of Google's three recommended sizes (768, 1536, 3072).
- pgvector's HNSW index supports `vector` columns of at most 2,000 dimensions, so 3072 can't be indexed. 768 floats are about 3 KB per passage, which suits a free database tier.
- If recall@5 misses the 90% target at 768, the plan tries 1536 before changing anything else. That needs a migration plus re-embedding.

**Every document records its model** (e.g. `gemini-embedding-2@768`).

- Search refuses a workspace whose documents use another model, with a clear 409, instead of silently comparing incompatible vectors.
- `pnpm kb:reembed --workspace <slug>` fixes it: it embeds the stored passages again with the current model, one document per transaction. It is safe to stop and re-run. It is integration-tested, including races with deletes and re-processing, and mutation-checked.

**A deterministic mock embedder** (hashed bag of words, same interface) for CI, local development and E2E. It needs no key or network and still ranks shared words higher, so retrieval tests check real behaviour. Its eval numbers are a word-matching baseline, not product quality.

**PDFs are parsed only in the worker, in a `worker_threads` thread.**

- The thread has a heap cap (`resourceLimits`) and is killed (`worker.terminate()`) after 30 s.
- The page count is checked before any text is extracted (more than 50 pages: rejected).
- Library: `unpdf` 1.9.1, which bundles PDF.js 6.4 (well past the CVE-2024-4367 fix).
- Why a thread and not a timeout: `unpdf` parses on the event loop, so a promise timeout can't stop a hostile file. Only killing the thread stops CPU-bound parsing, and a crash takes down the thread, not the worker.
- Only text is extracted: no images, scripts, forms or attachments. Uploaded files are never served back, and the original is deleted once its passages are stored.

## Consequences

- **Benefits:**
  - The product uses a current model with a long support window.
  - CI needs no secret.
  - Model changes are explicit and recoverable instead of silently degrading search.
  - A malicious PDF can at worst waste 30 s of one worker thread.
- **Costs:**
  - Changing the vector size needs a migration and a full re-embed.
  - The free tier's rate limits (shown per project in AI Studio, not published as a fixed table) slow down large imports. Ingestion retries 429 responses with backoff (pg-boss).
  - One HNSW index is shared by all workspaces. pgvector filters after the index scan, so iterative scans keep going until enough of the workspace's passages are found. pgvector's README notes that a shared approximate index lets tenants affect each other's recall and speed. It recommends partitioning at scale; that is not needed at demo scale.
  - PDFs are split into sections per page, so a sentence crossing a page break is split across two passages (finding #64).
  - There is no antivirus scanning or content disarm & reconstruct; this is accepted risk **AR-006**.

## Revisit when

- the Gemini baseline misses recall@5 ≥ 90% (try 1536 dimensions, then chunking changes, then a reranker);
- Google announces a shutdown date for `gemini-embedding-2`;
- a workspace grows past roughly 100k passages (consider partitioning the index);
- the product accepts uploads from customers rather than only admins (reconsider AR-006).
