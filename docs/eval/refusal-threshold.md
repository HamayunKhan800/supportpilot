# Refusal threshold (`retrieval_min_score`), M6 step 3

**Decision: the default changes from 0.65 to 0.62.** At 0.62 the gate refuses no answerable test question and still catches the two off-topic ones. At 0.65 it also refused one real question and caught nothing more. Migration 0011 changes the default for new workspaces only. Admins can still change the value on the Settings page.

## What the threshold does

Before writing a draft, the pipeline searches the help centre. If the best passage's similarity score is below `retrieval_min_score`, it refuses **without calling the model** (M5 D7). That saves a model call, but the model never sees the question, so a wrong refusal by this gate can't be corrected later. A question the gate lets through can still be refused by the model, which answers `INSUFFICIENT_KNOWLEDGE` when the passages don't contain the answer.

## How it was measured

- `pnpm eval:threshold`: the app's own search (`hybridSearch`) with real **Gemini embeddings** (`gemini-embedding-2`, 768 dimensions), over the 35-article help centre in 500-token chunks.
- **No API calls.** Every embedding came from the cache paid for in M4. The script refuses to run if one is missing.
- 110 answerable questions and 30 unanswerable ones (mostly near misses: topics close to an article but not covered).
- Raw scores and the full sweep, 0.40 to 0.90 in steps of 0.01: [`eval/results/threshold-gemini.json`](../../eval/results/threshold-gemini.json).

## The scores

| Group        | n   | Lowest | 10th pct | Median | 90th pct | Highest |
| ------------ | --- | ------ | -------- | ------ | -------- | ------- |
| Answerable   | 110 | 0.638  | 0.703    | 0.791  | 0.854    | 0.890   |
| Unanswerable | 30  | 0.570  | 0.668    | 0.762  | 0.788    | 0.800   |

The two groups overlap almost completely. A near-miss question is as close to the articles as a real one. The highest-scoring unanswerable question, u015 "Is Nimbus HIPAA compliant for storing medical records?", scores 0.800, above the answerable median. That is why **no score can do the refusing on its own**, as finding #87 already showed in M5. Only two questions sit clearly below everything else, and both are off-topic:

- u024, 0.570: "What will the weather be like in London tomorrow?"
- u025, 0.593: "Can you recommend a good laptop for video editing?"

The lowest answerable question is q002, at 0.638: "I signed up yesterday but the share button doesn't work, why?"

## The trade-off

"Wrongly refused" = answerable questions the gate refuses (lower is better). "Caught" = unanswerable questions it refuses (higher is better). 95% Wilson intervals in brackets.

| Threshold      | Wrongly refused (of 110) | Caught (of 30)            |
| -------------- | ------------------------ | ------------------------- |
| 0.55           | 0 · 0.0% (0.0–3.4%)      | 0 · 0.0% (0.0–11.4%)      |
| 0.58           | 0 · 0.0% (0.0–3.4%)      | 1 · 3.3% (0.6–16.7%)      |
| 0.60           | 0 · 0.0% (0.0–3.4%)      | 2 · 6.7% (1.8–21.3%)      |
| **0.62 (new)** | **0 · 0.0% (0.0–3.4%)**  | **2 · 6.7% (1.8–21.3%)**  |
| 0.63           | 0 · 0.0% (0.0–3.4%)      | 2 · 6.7% (1.8–21.3%)      |
| 0.64           | 1 · 0.9% (0.2–5.0%)      | 2 · 6.7% (1.8–21.3%)      |
| 0.65 (M5)      | 1 · 0.9% (0.2–5.0%)      | 2 · 6.7% (1.8–21.3%)      |
| 0.66           | 2 · 1.8% (0.5–6.4%)      | 2 · 6.7% (1.8–21.3%)      |
| 0.68           | 3 · 2.7% (0.9–7.7%)      | 3 · 10.0% (3.5–25.6%)     |
| 0.70           | 8 · 7.3% (3.7–13.7%)     | 7 · 23.3% (11.8–40.9%)    |
| 0.75           | 21 · 19.1% (12.8–27.4%)  | 10 · 33.3% (19.2–51.2%)   |
| 0.80           | 64 · 58.2% (48.8–67.0%)  | 30 · 100.0% (88.6–100.0%) |

To catch even a quarter of the unanswerable questions, the gate would have to refuse 7–14% of the answerable ones, which already uses up the whole 10% false-refusal target (docs/04) before the model has refused anything.

## The rule, and how it was corrected

The rule was written into the code before the scores were run (`scripts/lib/threshold.ts`). The gate may wrongly refuse **at most 2%** of answerable questions. 2% is used instead of the 10% target because the gate's mistakes can't be undone and most of the budget should be left to the model.

As first written, the rule then said "take the **highest** such threshold". It picked **0.66**, which catches the same two questions as 0.60 but wrongly refuses two. The rule had no tie-break, so I added two **after seeing that result** (finding #105):

1. Catch as many unanswerable questions as possible within the 2% limit.
2. On a tie, wrongly refuse the fewest answerable questions.
3. Still tied, take the middle of the tied range, rounded up, for a margin on both sides.

0.60 to 0.63 all catch 2 and wrongly refuse 0. The middle of that range is **0.62**. A unit test applies the rule to the saved scores again and checks that it still gives the default in the code.

## Limits

- **Small sample.** Only 2 of the 30 unanswerable questions are off-topic, and the gap between them (0.593) and the lowest answerable question (0.638) is narrow. One new question could move the choice.
- **Short, single-question tickets.** Real tickets are longer, mix topics and repeat the subject line (the pipeline now searches the message alone when it already contains the subject; see finding #106). Longer text may score differently.
- **One embedding model and one chunk size.** Changing either means running `pnpm eval:threshold` again (it needs the embeddings cached first).
- **The gate only.** Whether the **model** refuses the other 28 unanswerable questions is measured end to end by `pnpm eval --provider gemini` in step 6, with 0.62 in place. That run, not this one, gives the refusal recall that counts.
