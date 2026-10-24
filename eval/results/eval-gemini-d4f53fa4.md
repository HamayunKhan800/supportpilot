# Evaluation run d4f53fa4 (gemini)

- **Status:** completed
- **Started:** 2026-10-23T15:37:40.312Z · **finished:** 2026-10-24T05:34:09.342Z
- **Prompts:** draft.v1, grader.v1, triage.v1 · **models:** triage gemini-3.5-flash-lite, drafts gemini-3.8-flash, fallback gemini-3.5-flash-lite · **embeddings:** gemini-embedding-2@768
- **Dataset hash:** `ba1b4b3d915f` · **settings hash:** `f87d87753c95`
- **Items:** retrieval 110, triage 150, drafts 140, injection 20 · provider requests 517
- **Drafts written by:** gemini-3.5-flash-lite 132 (fallback), gemini-3.8-flash 6

Every rate has a 95% Wilson interval (in brackets) and the number of items it was measured on.

| Metric | Result | Target |
| --- | --- | --- |
| Retrieval recall@5 | 99.1% (95.0–99.8%, n=110) | ≥ 90% |
| Retrieval MRR@5 | 0.918 | reported |
| Triage category accuracy | 87.3% (81.1–91.7%, n=150) | ≥ 85% |
| Triage category macro-F1 | 0.870 | reported |
| Priority accuracy (exact) | 73.3% (65.7–79.8%, n=150) | reported |
| Priority within one level | 99.3% (96.3–99.9%, n=150) | reported |
| Sentiment accuracy | 75.3% (67.9–81.5%, n=150) | reported |
| Language accuracy | 98.7% (95.3–99.6%, n=150) | reported |
| Triage left for review (low confidence) | 0.7% (0.1–3.7%, n=150) | reported |
| Citation validity | 100.0% (97.2–100.0%, n=133) | 100% |
| Answer cites the right article | 100.0% (96.6–100.0%, n=108) | reported |
| Refusal recall | 100.0% (88.6–100.0%, n=30) | ≥ 90% |
| False refusal rate | 1.8% (0.5–6.4%, n=110) | ≤ 10% |
| Injection resistance | 100.0% (83.9–100.0%, n=20) | 100% |
| Groundedness (AI-graded, not checked against a human) | 99.1% (94.8–99.8%, n=106) | reported |

Groundedness: ready drafts whose every factual claim is backed by a passage they cite. AI-graded, not checked against a human: graded by gemini-3.5-flash-lite (drafts written by gemini-3.5-flash-lite, gemini-3.8-flash) and not compared with human ratings (the project owner's decision), so treat it as an indicator. It measures whether claims come from the cited passages, not whether the reply answers the question. Claims: 270 of 271 supported (0 "supported" verdicts named no valid source and were counted as unsupported; 0 cut above the 12-claim limit). Grader gave no usable answer: 2.

## Latency and cost

- Retrieval (database part): p50 5 ms · p95 7 ms (n=110)
- Triage model call: p50 1275 ms · p95 17524 ms (n=150)
- Draft time to first token: p50 938 ms · p95 9320 ms (n=138)
- Draft end to end: p50 13671 ms · p95 28545 ms (n=140)
- Tokens: 246675 in / 40505 out · 416 calls (2 failed)
- Estimated cost at paid-tier list prices: $0.178385 · per triage $0.000282 · per draft $0.000548 · per grading $0.000430 (evaluation only) (the free tier costs $0)

## Failures and details

- Technical failures (no answer from the provider; left out of the rates above): triage 0.0% (0.0–2.5%, n=150), drafts 0.0% (0.0–2.7%, n=140), injection 0.0% (0.0–16.1%, n=20)
- Drafts blocked by the safety checks: 0 · refused before any model call: 2 · cut off at the length limit: 1
- Injection cases obeyed: none

### Category F1 per label

| Category | Tickets | Precision | Recall | F1 |
| --- | --- | --- | --- | --- |
| billing | 26 | 0.96 | 0.96 | 0.96 |
| bug | 28 | 0.80 | 1.00 | 0.89 |
| account | 25 | 0.83 | 0.96 | 0.89 |
| how-to | 30 | 0.82 | 0.77 | 0.79 |
| feature-request | 20 | 0.95 | 0.90 | 0.92 |
| other | 21 | 1.00 | 0.62 | 0.76 |

## Regression floors

Not checked in this run.
