# M6 baseline: Gemini evaluation

The first complete measurement of SupportPilot's AI against Google Gemini, on the project's own
test set. Method: [README](README.md) and [ADR-0019](../adr/0019-evaluation-method.md). Full
report: [`eval/results/eval-gemini-d4f53fa4.md`](../../eval/results/eval-gemini-d4f53fa4.md); every
item, answer and grade: [`eval-gemini-d4f53fa4.json`](../../eval/results/eval-gemini-d4f53fa4.json).

- **Run:** `d4f53fa4-2080-4fc1-babd-8ee4f1acbcd6`, 2026-10-23 15:37 UTC to 2026-10-24 05:34 UTC,
  in 7 sessions on the Gemini free tier. `--resume` refuses to continue if the datasets, prompts,
  models or retrieval settings change, so all 420 items ran with one configuration
  (dataset `ba1b4b3d915f`, settings `f87d87753c95`).
- **Models:** triage `gemini-3.5-flash-lite`; drafts `gemini-3.8-flash` with automatic fallback to
  `gemini-3.5-flash-lite`; grader `gemini-3.5-flash-lite`; embeddings `gemini-embedding-2` (768).
- **Prompts:** `triage.v1`, `draft.v1`, `grader.v1`.
- **Items:** 110 retrieval questions, 150 triage tickets, 140 draft questions (110 answerable,
  30 that no article answers), 20 prompt-injection cases. 517 provider requests.

## Results

Each rate has its 95% Wilson interval and the number of items it was measured on.

| Area      | Metric                                               | Result                            | Target   | Met?                 |
| --------- | ---------------------------------------------------- | --------------------------------- | -------- | -------------------- |
| Retrieval | Recall@5                                             | 99.1% (95.0–99.8%, n=110)         | ≥ 90%    | yes                  |
| Retrieval | MRR@5                                                | 0.918                             | reported |                      |
| Triage    | Category accuracy                                    | 87.3% (81.1–91.7%, n=150)         | ≥ 85%    | yes (point estimate) |
| Triage    | Category macro-F1                                    | 0.870                             | reported |                      |
| Triage    | Priority, exact                                      | 73.3% (65.7–79.8%, n=150)         | reported |                      |
| Triage    | Priority within one level                            | 99.3% (96.3–99.9%, n=150)         | reported |                      |
| Triage    | Sentiment                                            | 75.3% (67.9–81.5%, n=150)         | reported |                      |
| Triage    | Language                                             | 98.7% (95.3–99.6%, n=150)         | reported |                      |
| Drafts    | Citation validity                                    | 100% (97.2–100%, n=133 citations) | 100%     | yes                  |
| Drafts    | Cites the right article                              | 100% (96.6–100%, n=108)           | reported |                      |
| Drafts    | Refusal recall (no article answers)                  | 100% (88.6–100%, n=30)            | ≥ 90%    | yes (point estimate) |
| Drafts    | False refusals (answerable)                          | 1.8% (0.5–6.4%, n=110)            | ≤ 10%    | yes                  |
| Drafts    | Groundedness, AI-graded, not checked against a human | 99.1% (94.8–99.8%, n=106)         | reported |                      |
| Safety    | Prompt-injection resistance                          | 100% (83.9–100%, n=20)            | 100%     | yes (point estimate) |

Technical failures (no answer from the provider, left out of the rates above): triage 0 of 150,
drafts 0 of 140, injection 0 of 20. Drafts blocked by the safety checks: 0. Drafts refused
before any model call (search found nothing close enough): 2. Drafts cut off at the length
limit: 1. Injection cases obeyed: none.

**"Point estimate"** means the measured rate meets the target but the lower end of its interval
does not, so the sample is too small to show the target is met with 95% confidence. This applies
to triage category (lower bound 81.1% vs 85%), refusal recall (88.6% vs 90%) and injection
resistance (83.9% vs 100%). More items would narrow these intervals.

### Category F1 per label

| Category        | Tickets | Precision | Recall | F1   |
| --------------- | ------- | --------- | ------ | ---- |
| billing         | 26      | 0.96      | 0.96   | 0.96 |
| bug             | 28      | 0.80      | 1.00   | 0.89 |
| account         | 25      | 0.83      | 0.96   | 0.89 |
| how-to          | 30      | 0.82      | 0.77   | 0.79 |
| feature-request | 20      | 0.95      | 0.90   | 0.92 |
| other           | 21      | 1.00      | 0.62   | 0.76 |

The weakest label is **other** (recall 0.62): the model tends to force vague tickets into a
specific category.

## Latency and cost

| Step                       | p50    | p95    | n   |
| -------------------------- | ------ | ------ | --- |
| Retrieval (database part)  | 5 ms   | 7 ms   | 110 |
| Triage model call          | 1.3 s  | 17.5 s | 150 |
| Draft, time to first token | 0.9 s  | 9.3 s  | 138 |
| Draft, end to end          | 13.7 s | 28.5 s | 140 |

- Tokens: 246,675 in, 40,505 out, over 416 model calls.
- **Cost:** $0 on the free tier. At paid-tier list prices the whole run would cost **$0.18**
  (about Rs 49 at Rs 277 per dollar): about $0.0003 per triage and $0.0005 per draft.
- The draft p95 is long because the app waits up to 15 seconds for the main model's first words
  before switching to the fallback (`src/server/modules/ai/config.ts`). On the free tier that wait
  happened on most drafts.

## Findings

1. **Triage's auto-apply rule does not catch mistakes.** A label is applied without review when
   the model's self-rated confidence is at least 0.7 (the default in AI settings). The model rated
   149 of 150 tickets at 0.8 or higher, so all 19 wrong categories were applied automatically.
   Confidence does carry a signal at the top of the scale:

   | Auto-apply at         | Sent to a person | Wrong labels caught | Accuracy of auto-applied labels |
   | --------------------- | ---------------- | ------------------- | ------------------------------- |
   | 0.7 (current default) | 1 (0.7%)         | 0 of 19             | 87.2% (130 of 149)              |
   | 0.9                   | 6 (4%)           | 4 of 19             | 89.6% (129 of 144)              |
   | 0.95                  | 33 (22%)         | 13 of 19            | 94.9% (111 of 117)              |
   | 1.0                   | 96 (64%)         | 15 of 19            | 92.6% (50 of 54)                |

   0.95 looks like the better default, but it was read off the same 150 tickets, so it should be
   confirmed on new tickets before relying on it. Agents always see triage as a suggestion they
   can change. A wrong category only affects sorting and filtering, never what a customer is sent.

2. **Drafts mostly measure the fallback model.** `gemini-3.8-flash` timed out, was overloaded or
   hit its daily limit on most calls, so `gemini-3.5-flash-lite` wrote 132 of 140 drafts, the main
   model 6, and 2 were refused before any model call. The project decided to count fallback drafts
   as app behaviour, because that is what a user gets. They still are not a measurement of
   `gemini-3.8-flash` itself.
3. **Grounding is solid on this corpus.** Every one of 133 citations pointed to a passage the model
   was given, every answer cited the right article, and all 30 unanswerable questions were
   declined: 28 by the model, 2 by the search threshold before any call.
4. **Priority and sentiment are the weakest triage outputs** (73% and 75% exact). Priority is almost
   never far off (99.3% within one level).

## Limits

- **Small and synthetic.** 35 help articles for a made-up company, with questions and labels
  written for this project. Results on a real help centre will differ.
- **Groundedness is AI-graded and not checked against a human.** `gemini-3.5-flash-lite` graded
  drafts that were mostly written by `gemini-3.5-flash-lite`, and models tend to rate their own
  output favourably. The project owner decided not to collect human ratings, so treat this number
  as an indicator. The draft card in the app shows checkable facts instead (citations, links).
- **Label checks:** the project owner checked 20% of the retrieval labels in M4
  ([`label-spot-check.md`](label-spot-check.md)) and 4 proposed label changes in M6. The M6
  spot-check of 30 triage labels and 22 retrieval questions was done by an AI assistant on the
  owner's behalf (26 of 30 triage labels confirmed, 22 of 22 questions), which is not an
  independent human check ([`spot-check-2026-10-23.md`](spot-check-2026-10-23.md)).
- **One run, free tier.** Latency includes free-tier queueing from a single location. Rates are
  from one pass, and model outputs vary between runs.
- **Small samples for refusals and injection** (30 and 20 items): see "point estimate" above.

## Reproduce

```bash
GEMINI_API_KEY=... pnpm eval --provider gemini --max-calls 220 --gap-ms 13000            # first session
GEMINI_API_KEY=... pnpm eval --provider gemini --max-calls 220 --gap-ms 13000 --resume   # later sessions
```

Or run the protected **Gemini evaluation** GitHub workflow ([README](README.md#on-github-with-your-approval)). CI
runs the deterministic mock provider on every push and fails below `eval/floors.json`.
