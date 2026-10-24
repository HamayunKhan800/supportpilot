# Evaluation run 75a705fc (gemini)

- **Status:** stopped (call budget of 1 reached)
- **Started:** 2026-10-24T07:12:29.812Z
- **Prompts:** draft.v1, grader.v1, triage.v2 · **models:** triage gemini-3.5-flash-lite, drafts gemini-3.8-flash, fallback gemini-3.5-flash-lite · **embeddings:** gemini-embedding-2@768
- **Dataset hash:** `ba1b4b3d915f` · **settings hash:** `6e9f9a7a25f1`
- **Items:** retrieval 110, triage 150, drafts 0, injection 0 · provider requests 151
- **Drafts written by:** no drafts yet

Every rate has a 95% Wilson interval (in brackets) and the number of items it was measured on.

| Metric | Result | Target |
| --- | --- | --- |
| Retrieval recall@5 | 99.1% (95.0–99.8%, n=110) | ≥ 90% |
| Retrieval MRR@5 | 0.918 | reported |
| Triage category accuracy | 94.0% (89.0–96.8%, n=150) | ≥ 85% |
| Triage category macro-F1 | 0.940 | reported |
| Priority accuracy (exact) | 91.3% (85.7–94.9%, n=150) | reported |
| Priority within one level | 99.3% (96.3–99.9%, n=150) | reported |
| Sentiment accuracy | 87.3% (81.1–91.7%, n=150) | reported |
| Language accuracy | 99.3% (96.3–99.9%, n=150) | reported |
| Triage left for review (low confidence) | 15.3% (10.4–22.0%, n=150) | reported |
| Citation validity | no data | 100% |
| Answer cites the right article | no data | reported |
| Refusal recall | no data | ≥ 90% |
| False refusal rate | no data | ≤ 10% |
| Injection resistance | no data | 100% |
| Groundedness (AI-graded, not checked against a human) | no data | reported |

Groundedness: ready drafts whose every factual claim is backed by a passage they cite. AI-graded, not checked against a human: graded by no model (drafts written by no model) and not compared with human ratings (the project owner's decision), so treat it as an indicator. It measures whether claims come from the cited passages, not whether the reply answers the question. Claims: 0 of 0 supported (0 "supported" verdicts named no valid source and were counted as unsupported; 0 cut above the 12-claim limit). Grader gave no usable answer: 0.

## Latency and cost

- Retrieval (database part): p50 6 ms · p95 9 ms (n=110)
- Triage model call: p50 1126 ms · p95 4790 ms (n=150)
- Draft time to first token: no data
- Draft end to end: no data
- Tokens: 200834 in / 10412 out · 150 calls (0 failed)
- Estimated cost at paid-tier list prices: $0.086293 · per triage $0.000575 · per draft n/a · per grading n/a (evaluation only) (the free tier costs $0)

## Failures and details

- Technical failures (no answer from the provider; left out of the rates above): triage 0.0% (0.0–2.5%, n=150), drafts no data, injection no data
- Drafts blocked by the safety checks: 0 · refused before any model call: 0 · cut off at the length limit: 0
- Injection cases obeyed: none

### Category F1 per label

| Category | Tickets | Precision | Recall | F1 |
| --- | --- | --- | --- | --- |
| billing | 26 | 0.96 | 1.00 | 0.98 |
| bug | 28 | 0.96 | 0.89 | 0.93 |
| account | 25 | 0.89 | 1.00 | 0.94 |
| how-to | 30 | 0.93 | 0.90 | 0.92 |
| feature-request | 20 | 0.90 | 0.95 | 0.93 |
| other | 21 | 1.00 | 0.90 | 0.95 |

## Regression floors

Not checked in this run.
