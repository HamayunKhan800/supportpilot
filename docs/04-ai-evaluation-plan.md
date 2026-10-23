# 04 · AI Evaluation Plan

> Milestone M0 · Status: **Draft for review**. The dataset is built at M4–M6; the first baseline is reported at M6.

## 1. Principles

- Measure before claiming. Targets are hypotheses, and the real numbers are reported even when they miss.
- Prefer **deterministic checks** (exact label match, citation IDs, canary leakage) over LLM-as-judge.
- Where LLM-as-judge is used, validate it against **human labels** on a sample and report the agreement rate.
- Evals are versioned with prompts (`prompt_version`) so changes can be compared over time.
- **Comparing two prompt versions** (for example `triage.v1` and `triage.v2`): both run on the same items, so the comparison is paired and uses the exact McNemar test on the items where they disagree, not two separate intervals. A new version replaces the old one only if it is better at p < 0.025 on a main metric and not worse on the others. The rule is set before the measurement, and a prompt is never edited after being scored on a test set: a change is a new version, measured on items it hasn't seen.

## 2. Golden dataset (synthetic, for the fictional "Nimbus Cloud Storage")

| Set                    | Size (target)                                                            | Labels                                                              |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| KB articles            | 30–40 Markdown/PDF docs (billing, sync, sharing, security, API, account) | –                                                                   |
| Triage tickets         | ~150                                                                     | category, priority, sentiment, language                             |
| Answerable questions   | ~80                                                                      | IDs of the chunk(s) that contain the answer + reference answer      |
| Unanswerable questions | ~30                                                                      | expected = refusal                                                  |
| Injection cases        | ~20 (direct in ticket + indirect in a poisoned KB doc)                   | canary string must not appear; must not follow injected instruction |

**Honesty note:** the dataset is authored with AI assistance and reviewed by me. That carries a bias risk, because the same kind of model writes and answers. Mitigations: varied writing styles, typos, multilingual tickets, adversarial phrasing. **You (project owner) are asked to spot-check ~20% of labels.** This will be disclosed in the README.

## 3. Metrics & targets

| Metric                   | Definition                                                                                 | Target (hypothesis)                          |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Triage category accuracy | exact match                                                                                | ≥ 85%                                        |
| Triage macro-F1          | across categories                                                                          | reported                                     |
| Priority accuracy        | exact; also "within one level"                                                             | reported                                     |
| Retrieval recall@5       | ≥1 gold chunk in top 5                                                                     | ≥ 90%                                        |
| MRR@5                    | mean reciprocal rank                                                                       | reported                                     |
| Citation validity        | cited IDs ⊆ retrieved IDs (deterministic)                                                  | 100% (invalid ones are stripped and counted) |
| Groundedness             | judge: every claim supported by cited sources; judge calibrated on 30 human-labelled items | reported with agreement %                    |
| Refusal recall           | unanswerable → refused                                                                     | ≥ 90%                                        |
| False refusal rate       | answerable → refused                                                                       | ≤ 10%                                        |
| Injection resistance     | no canary leak & no instruction following                                                  | 100% target, all failures documented         |
| Latency                  | TTFT and total, p50/p95                                                                    | reported                                     |
| Cost                     | tokens × dated price table → USD per triage / per draft                                    | reported                                     |

## 4. How it runs

- `pnpm eval` runs the TypeScript eval runner (built in M6 step 2) over every dataset through the app's real code paths. It writes `eval/results/eval-<provider>-<run>.json` (every item) and a Markdown summary, and stores each item in the `eval_run` / `eval_item` tables as soon as it is measured, so a stopped run can resume. Every result is tagged with the prompt versions, models and a hash of the datasets.
- **CI with mock provider (every push):** the whole evaluation with the deterministic stand-in models. It checks that the pipelines and the evaluation work end to end, and fails the build if a metric drops below `eval/floors.json`. It costs nothing. Mock numbers are not a measure of AI quality, and the report says so.
- **Real-provider eval:** on demand only (the owner chose no weekly schedule, M6 plan question 4): locally, or as a GitHub Actions job that waits for the owner's approval. Hard request cap per session, pacing, a stop at the first 429, and no retries; a free-tier run is spread over several days with `--resume`. Results are committed under `eval/results/` and summarised in `docs/eval/`.
- **Calibration:** `retrieval_min_score` is chosen at M6 from the answerable/unanswerable score distributions to balance refusal recall against false refusals. The chosen trade-off is documented: 0.62, in [docs/eval/refusal-threshold.md](eval/refusal-threshold.md) (M6 step 3).

## 5. Production feedback loop

Agent overrides of triage, 👍/👎 on drafts, and edit ratio are logged. The analytics page shows them, and they can be exported to grow the golden set.
