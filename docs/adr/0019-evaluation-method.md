# ADR-0019 · One evaluation runner: mock in CI, Gemini on demand, uncertainty on every number

Status: Accepted · Date: 2026-10-23 · Plan: [M6 D1–D6](../plans/m6-evaluation.md) · Related: [ADR-0016](0016-draft-model-fallback.md), [ADR-0017](0017-groundedness-grader.md) · Code: `scripts/eval.ts`, `scripts/lib/eval-runner.ts`, `scripts/lib/eval-state.ts`, `src/server/modules/eval/`, `.github/workflows/eval-gemini.yml` · How to run: [docs/eval/README.md](../eval/README.md)

## Context

SupportPilot's AI features (triage, cited drafts, refusals, resistance to prompt injection) need numbers an employer or user can trust. Three constraints shaped how they are measured:

- **Small test sets.** Hundreds of items, not tens of thousands. "88%" from 150 tickets could be anywhere from about 82% to 92%. A single percentage hides that.
- **The free tier.** Gemini 3.x Flash allows about 20 requests a day per project (Google shows the limit only in AI Studio; developers report this figure), and a full run needs about 450 requests, 130 to 160 of them on Flash. A run takes about a week of sessions.
- **AI-assisted test data.** The same kind of model that answers the tests helped write them. Labels follow a written rubric and were spot-checked; the record says which checks a person made and which an AI made.

## Decision

- **One runner, real code paths.** `pnpm eval` sends every item through the app's own search, triage, draft and refusal code, not a copy, so it measures what users get. The datasets are files in `eval/`, and a run is tied to their SHA-256 hash and to a hash of the prompts, models and retrieval settings.
- **A 95% Wilson interval on every rate.** Wilson is accurate for small samples and rates near 0% or 100%, where the textbook normal-approximation interval is unreliable ([NIST e-Handbook 7.2.4.1](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)). Reports and the dashboard show the range next to the rate. "Target met" is judged on the measured rate, with the range beside it, so a reader can see when a pass or miss is within the noise.
- **Two modes.** The **mock** provider is deterministic and free. CI runs it on every push and fails below fixed floors (`eval/floors.json`), which guards the code, not the model. **Gemini** runs only on demand.
- **Built for interruption.** Every item is saved when measured. A session has a request budget, a minimum gap between requests, no automatic retries and a stop at the first 429. `--resume` continues the newest unfinished run with identical hashes and refuses otherwise, so one run never mixes two configurations. Provider failures (a 503, invalid output) are recorded as technical failures, left out of rates and counted, and `--retry-failed` measures them again.
- **Portable runs.** `pnpm eval:state` saves a provider's runs to one JSON file and loads them into another database. Loading validates every field, never deletes, keeps whichever copy of a run was updated last and rejects items that don't belong to a run in the file. That way a week-long run survives a new CI job or a rebuilt database. `save` refuses to write a file containing the API key.
- **On GitHub, only with the owner's approval.** The Gemini workflow has no schedule and no pull-request trigger. It runs in the protected `gemini-eval` environment, whose required reviewer must approve each job before the key becomes readable ([GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)). Inputs are validated and passed to scripts only through environment variables. The key exists only in the one step that calls Gemini. A session's saved run and report are artifacts, and the next session continues from the previous run's ID.
- **Honest labels.** Mock results are marked as plumbing checks wherever they appear. Groundedness is "AI-graded, not checked against a human" (ADR-0017). Results that miss their targets are reported, not dropped.

## Alternatives considered

- **A hosted evaluation platform or library.** It would add an account, a data processor and a dependency to secure, for what is a few hundred lines of code. More importantly, it would call the models through its own path instead of the app's.
- **Gemini in CI on every push.** It would spend the owner's quota without approval, make builds flaky (429s, model updates), and on the free tier couldn't finish anyway.
- **A paid-tier run in one evening.** About $0.30 (about Rs 85 at Rs 277/USD) in requests, but the paid tier needs a $5 prepayment. The owner chose the free tier over several days (plan §8.1).
- **Bootstrap intervals.** Possible, since every item is stored, but for a single rate they add random resampling where Wilson has a closed formula and is a standard recommendation for binomial proportions. Bootstrap stays an option for statistics without a formula.

## Consequences

- Every published number has a range, a sample size and a configuration hash; anyone can re-run the mock evaluation in minutes, and the Gemini one with their own key.
- A free-tier baseline takes about a week. The runs are portable, so that is a matter of patience, not risk.
- The workflow's artifacts are downloadable by anyone signed in to GitHub, as for every artifact in a public repository ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)). They contain only synthetic test data, model answers and scores.
- Model providers update models behind the same name, so a Gemini baseline is a dated measurement, not a permanent property. Reports carry the date, model IDs and prompt versions.
