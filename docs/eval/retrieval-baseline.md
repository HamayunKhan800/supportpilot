# Retrieval baseline (M4)

How well does knowledge-base search find the passage that answers a customer's question? This page records the method, the measured numbers and what they mean. Plan: [M4 step 6](../plans/m4-knowledge-base.md).

## Method

**Corpus:** 35 synthetic help articles for the fictional company "Nimbus Cloud Storage" ([`eval/corpus/nimbus`](../../eval/corpus/nimbus/)): account and security, billing, apps and sync, sharing, Business admin. 3 of them are converted to PDF in code, so the PDF path (text extraction, one section per page) is measured too. Near-duplicate topics are deliberate (refunds vs cancelling vs failed payments; version history vs trash; password reset vs account recovery vs two-step verification), and so are exact identifiers such as error code `NC-507`.

**Questions:** 110 customer-style questions ([`eval/retrieval/questions.json`](../../eval/retrieval/questions.json)), at least one per article, mostly worded differently from the article ("My card was declined" vs "If a payment fails"). Each is labelled with its article and an **evidence phrase** copied from it. The **gold passage** is the chunk of that article containing the phrase (case, whitespace and Markdown emphasis ignored), so the labels work for every chunk size. 3 questions are answered equally well by two articles and accept either.

**Label checks:** a unit test fails if any evidence phrase is not in its article, an article has no question, or the poisoned article (reserved for M5's prompt-injection tests) appears in the corpus. The harness also reports any phrase that chunking cut in two (none so far). A human spot-check of 20% of the labels is in [`label-spot-check.md`](label-spot-check.md).

**Pipeline under test:** the production code, not a copy. `pnpm eval:retrieval` creates a temporary workspace, ingests every article with the worker's job (`runIngestJob`: detection, PDF extraction in the sandboxed thread, chunking, embedding, storage), asks every question, and deletes the workspace.

- **hybrid:** the product's search (`hybridSearch`): vector top 8 + keyword top 8, Reciprocal Rank Fusion (k = 60), top 5.
- **vector** and **keyword:** each half alone, top 5.

**Metrics:**

- **Recall@5:** share of questions with a gold passage in the top 5. This is what matters for M5: the AI draft only sees these 5.
- **MRR@5:** mean of 1/rank of the first gold passage (0 if not in the top 5). Rewards putting it first.
- Latency p50/p95 (nearest-rank) for query embedding, retrieval and document embedding; estimated tokens and cost.

Query embeddings are cached, so each question is embedded once per run (latency is measured on those real calls only).

## Results: mock embedder (word-matching baseline)

The mock embedder hashes words into 768 buckets ([`embedder.ts`](../../src/server/modules/kb/embedder.ts)). It knows nothing about meaning, so this is a **lexical baseline**, not the product's quality. It needs no network or key, so CI runs it on every push as a regression guard. Source: [`eval/results/retrieval-mock.json`](../../eval/results/retrieval-mock.json).

| Chunk tokens | Overlap | Chunks | Mode    | Recall@5 | MRR@5 |
| -----------: | ------: | -----: | ------- | -------: | ----: |
|          300 |       0 |    156 | hybrid  |    85.5% | 0.695 |
|          300 |       0 |    156 | vector  |    84.5% | 0.613 |
|          300 |       0 |    156 | keyword |    81.8% | 0.584 |
|          300 |    0.15 |    156 | hybrid  |    84.5% | 0.684 |
|          300 |    0.15 |    156 | vector  |    84.5% | 0.612 |
|          300 |    0.15 |    156 | keyword |    78.2% | 0.569 |
|          500 |       0 |    153 | hybrid  |    82.7% | 0.677 |
|          500 |       0 |    153 | vector  |    84.5% | 0.607 |
|          500 |       0 |    153 | keyword |    80.9% | 0.572 |
|          500 |    0.15 |    153 | hybrid  |    83.6% | 0.679 |
|          500 |    0.15 |    153 | vector  |    84.5% | 0.607 |
|          500 |    0.15 |    153 | keyword |    80.9% | 0.569 |
|          800 |       0 |    153 | hybrid  |    82.7% | 0.686 |
|          800 |       0 |    153 | vector  |    84.5% | 0.607 |
|          800 |       0 |    153 | keyword |    80.9% | 0.570 |
|          800 |    0.15 |    153 | hybrid  |    84.5% | 0.696 |
|          800 |    0.15 |    153 | vector  |    84.5% | 0.607 |
|          800 |    0.15 |    153 | keyword |    79.1% | 0.564 |

What this shows:

- **Chunk size barely matters for this kind of content.** 300, 500 and 800 tokens give 153–156 chunks, because the chunker splits at headings first and most help-article sections are shorter than 300 tokens. The size limit rarely applies. The default (500 tokens, 15% overlap, plan D8) stays.
- **Differences between configurations are within noise.** Keyword search gives many passages the same score, and ties are broken by chunk id, a random UUID that changes with every ingestion. Keyword and hybrid results therefore move by about ±1–2 questions between runs of the _same_ configuration. Vector search with the mock is exactly repeatable (84.5% in every run). No "winner" is claimed from the mock grid.
- **Fusion ranks better, not wider, with a lexical embedder.** Hybrid recall is about the same as vector alone, because both halves match words, but hybrid MRR is clearly higher (about 0.68 vs 0.61): passages found by both searches move to the top.
- **The misses are paraphrases.** For example, "Can I call you on the phone?" vs "24/7 live chat and phone support", or "My card was declined" vs "If a payment fails". In several, the right article was found but a different section of it, which counts as a miss here. A semantic embedding model should close much of this gap; the Gemini run measures it.

## Results: Gemini (`gemini-embedding-2`, 768 dimensions)

**Preliminary: partial run of 2026-10-22.** 5 of the 6 configurations finished before the free tier's daily quota ran out (finding #70); latency and tokens were not saved (finding #72, now fixed). The full run, with latency and cost, replaces this table.

| Chunk tokens / overlap | Chunks | Hybrid recall@5 / MRR@5 | Vector         | Keyword       |
| ---------------------- | -----: | ----------------------- | -------------- | ------------- |
| 300 / 0                |    156 | 97.3% / 0.849           | 100.0% / 0.932 | 80.9% / 0.578 |
| 300 / 0.15             |    156 | 98.2% / 0.835           | 99.1% / 0.934  | 79.1% / 0.578 |
| 500 / 0                |    153 | 97.3% / 0.825           | 99.1% / 0.918  | 80.9% / 0.569 |
| 500 / 0.15             |    153 | 96.4% / 0.824           | 99.1% / 0.918  | 81.8% / 0.569 |
| 800 / 0                |    153 | 97.3% / 0.824           | 99.1% / 0.918  | 82.7% / 0.560 |
| 800 / 0.15             |    153 | not run (quota)         |                |               |

- **The ≥ 90% recall@5 target is met** by hybrid and vector search in every configuration measured. Keyword-only is about 80%, as with the mock (it doesn't use embeddings).
- **Vector-only beats hybrid** on both recall and MRR, by about 0.09 MRR (finding #71). With a strong embedding model, equal-weight fusion with an OR keyword search adds noise: passages sharing common words climb into the top 5. This is from one partial run on developer-written questions, so the default (plan D10) is not changed yet; fusion variants are compared next, from cached embeddings, at no API cost.

## CI guard

[`tests/integration/kb-retrieval-eval.test.ts`](../../tests/integration/kb-retrieval-eval.test.ts) runs the mock eval at the default configuration on every push and fails if any mode drops below its floor (about two questions below the lowest of 6 runs). It also checks that fusion beats both halves on MRR: if keyword search broke, hybrid would quietly turn into vector-only search with similar recall but lower MRR.

Mutation check: 6 deliberate bugs, all caught. Keyword search returning nothing, keyword search with AND instead of OR, vector search returning the farthest passages first, fusion ignoring keyword ranks, and embedding without chunk titles were caught by the guard. "PDF keeps only the first page" was first **missed**, because no question's evidence was on a page 2. It is now caught by a unit test that requires every line of each PDF to survive extraction and chunking (finding #65).

## Limitations

- **Synthetic, English-only, small:** 35 articles and 110 questions written by the developer. That's enough to compare settings and catch regressions, not to predict accuracy on a real customer's help centre.
- **One labeller.** Mitigated by the automated label checks and a human spot-check of 20%.
- **Answerable questions only.** Questions the knowledge base can't answer, and a minimum-score threshold for refusing, belong to M6 (refusal rate ≥ 90% target).
- **PDF page breaks split sentences.** PDFs are chunked per page, so a sentence crossing a page break lands in two passages (seen in the admin-guide PDF). No question depends on it here; carrying overlap across pages is a candidate fix (finding #64).
- **Gemini free-tier rate limits** are no longer published as a fixed table; Google shows them per project in AI Studio ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), checked 2026-10-22). The eval paces calls (`--pace-ms`) and the SDK retries 429 responses. The free tier's **daily** limit, as reported in the 429 response on 2026-10-22, is 1,000 embedded texts per project and model, counting each passage; it resets at midnight Pacific time. So the eval caches every embedding on disk (`eval/cache`) and refuses to start a run that would need more than `--budget` new ones (default 900 for Gemini).

## Reproduce

```bash
pnpm db:migrate
pnpm eval:retrieval                    # mock, default chunking, 3 modes (about 7 s)
pnpm eval:retrieval --grid --out eval/results/retrieval-mock.json
GEMINI_API_KEY=... pnpm eval:retrieval --provider gemini --grid --pace-ms 1000 \
  --out eval/results/retrieval-gemini.json
```
