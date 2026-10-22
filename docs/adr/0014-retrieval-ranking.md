# ADR-0014 · Retrieval ranks by meaning; keyword search labels results

Status: Accepted · Date: 2026-10-22 · Revises: [M4 plan](../plans/m4-knowledge-base.md) D10 · Evidence: [retrieval baseline](../eval/retrieval-baseline.md), [`eval/results/fusion-gemini.json`](../../eval/results/fusion-gemini.json), milestones finding #71 · Code: `src/server/modules/kb/retrieval.ts` (`RETRIEVAL_FUSION`)

## Context

Plan D10 chose hybrid retrieval before anything was measured: meaning-based (vector) top 8 and PostgreSQL full-text top 8, merged with Reciprocal Rank Fusion (RRF, k = 60) at equal weights, keeping the top 5. Hybrid search is a common default because keyword search can catch exact terms (names, codes) that embeddings may rank lower.

The full Gemini run (`gemini-embedding-2`, 768 dimensions, 35 articles, 110 questions) showed the opposite on our data. Vector search alone had higher recall@5 and MRR@5 than hybrid at all six chunk settings (finding #71). Keyword search ORs the words of the question, so passages that share common words get into its list, and equal weights let them push the right passage down.

## Experiment

`pnpm eval:fusion` uses only embeddings already cached from that run. It cannot call a provider; a missing embedding is an error. It fetches both candidate lists once per question and ranks every variant in memory with the app's own `fuseRankings`. An integration test checks that its numbers match the real search pipeline.

Chunks 500 tokens / 15% overlap (the app default), 110 questions:

| Variant                              | Recall@5  | MRR@5     | Questions ranked better / worse than vector |
| ------------------------------------ | --------- | --------- | ------------------------------------------- |
| **Vector only**                      | **99.1%** | **0.918** | n/a                                         |
| RRF 8 + 8, equal weights (previous)  | 96.4%     | 0.822     | 7 / 25                                      |
| RRF 8 + 8, vector weight 2           | 97.3%     | 0.851     | 5 / 18                                      |
| RRF 8 + 8, vector weight 3           | 97.3%     | 0.854     | 4 / 17                                      |
| RRF 8 + 3 (fewer keyword candidates) | 97.3%     | 0.795     | 7 / 31                                      |
| Keyword only                         | 80.0%     | 0.563     | 7 / 60                                      |

Chunks 300 / 0 give the same picture: vector 100% / 0.932, equal-weight RRF 98.2% / 0.826 (better on 6 questions, worse on 26), and vector weight 3 99.1% / 0.876 (4 / 16).

Keyword and fused results vary by about one question between runs. Keyword search gives many passages equal scores, and those ties are broken by chunk id, a random UUID. One earlier run of equal-weight RRF at 500/0.15 measured 97.3% / 0.823. Vector results are exactly repeatable.

What fusion helped with, and what it didn't:

- **Exact error codes:** q061 (NC-403) and q062 (NC-610) rank first with vector search alone, and with every fused variant.
- **Plan names:** weighted fusion ranks the right passage higher for q028–q030 ("Personal plan", "Business plan") and q098. Vector search already had it at rank 3–5, inside the 5 passages a draft is given, so only the rank changed.
- **The only vector miss:** q031 ("Do you have a discount for charities?", 500/0.15) is not found by keyword or hybrid search either.

## Decision

1. **Rank results by vector similarity.** `RETRIEVAL_FUSION` sets `vectorWeight: 1, keywordWeight: 0`, so the top 5 is the vector order. This is the simplest option that measured best. Hand-tuning a weight such as 3 would fit 110 questions I wrote, and it was still worse than vector alone.
2. **Keep running keyword search (about 3 ms at p50).** Each result still says whether keyword search found it and at what rank ("Keywords #n" on the test-search page), which helps admins see why a passage was chosen. Fusion stays one constant away if a larger eval shows it helps. `fuseRankings` keeps weighted RRF and its tests.
3. **Keep chunks at 500 tokens / 15% overlap.** 300 / 0 scored one question higher with vector search, which is within noise and not worth a change.
4. **Response field:** `rrfScore` may now be 0, meaning only keyword search found the passage. This can't happen in practice: every passage has an embedding and both searches see the same documents, so vector search always returns a full list. The schema allows it anyway, so such a response can't fail validation.

## Consequences

- With Gemini embeddings, the app's search matches the vector row: recall@5 99.1% and MRR@5 0.918 at the default chunks, above the ≥ 90% target.
- CI uses the mock embedder, a hashed bag of words. Fusion helped it (MRR about 0.68 vs 0.61) because the mock only matches words. The CI floors now treat the app's search as vector search, and a test checks question by question that keyword matches never reorder results.
- **Known gaps, for M6:** only 2 of 110 questions contain identifiers, and none contain typos, product jargon or order numbers. All questions were written by the developer about one corpus. M6 should add those kinds of questions and rerun `pnpm eval:fusion`. Embedding new questions needs a Gemini key; everything else runs offline.
