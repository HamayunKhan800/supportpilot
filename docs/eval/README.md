# Evaluation: how to run it

SupportPilot's AI is measured by one runner, `pnpm eval`, over fixed test sets: 110 knowledge-base searches, 150 tickets to triage, 140 questions to draft answers for (30 of them unanswerable from the help centre) and 20 prompt-injection attacks. The method and targets are in [docs/04](../04-ai-evaluation-plan.md); the plan and its decisions are in [docs/plans/m6-evaluation.md](../plans/m6-evaluation.md).

## Two modes

| Mode   | Command                                  | Cost and time                      | Used for                                                                                   |
| ------ | ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Mock   | `pnpm eval` (`--check-floors` in CI)     | Free, deterministic, a few minutes | Guards the code on every push: the build fails if a metric drops below `eval/floors.json`. |
| Gemini | `pnpm eval --provider gemini [--resume]` | Free tier: several daily sessions  | The real numbers, on demand only.                                                          |

Mock numbers only show that the plumbing works. They say nothing about model quality, and the dashboard marks them as such.

## A Gemini run on the free tier

Google no longer publishes free-tier limits; they are shown per project in AI Studio's rate-limit page and reset at midnight Pacific time ([Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Developers report about 20 requests a day for Gemini 3.x Flash and 500 for 3.x Flash-Lite. Drafts and injection cases use 3.8 Flash (about 130 to 160 requests), so a full run takes about a week of daily sessions. Triage and the groundedness grader use Flash-Lite.

Each session is deliberately small and slow: at most `--max-calls` requests (default 60), at least `--gap-ms` apart (13,000 used here, under 5 a minute), no automatic retries, and a stop at the first "429 too many requests". Every item is saved as soon as it is measured, so a stopped run loses nothing.

```bash
GEMINI_API_KEY=... pnpm eval --provider gemini --max-calls 220 --gap-ms 13000            # day 1
GEMINI_API_KEY=... pnpm eval --provider gemini --max-calls 220 --gap-ms 13000 --resume   # each later day
```

`--resume` refuses to continue if the datasets, prompts, models or retrieval settings changed in between, so one run never mixes two configurations.

### Keeping a run when the database is replaced

A run lives in the `eval_run` and `eval_item` tables. To carry it to another database (a new CI job, a rebuilt local database):

```bash
pnpm eval:state save eval/state/gemini.json   # after a session (git-ignored, mode 600)
pnpm eval:state load eval/state/gemini.json   # before the next one, then --resume
```

Loading checks every field, never deletes anything, and keeps whichever copy of a run was updated last, so loading an older file cannot roll a run back. `save` refuses to write a file containing the `GEMINI_API_KEY` in its environment.

## On GitHub, with your approval

[`.github/workflows/eval-gemini.yml`](../../.github/workflows/eval-gemini.yml) runs one session. It never runs by itself: it has no schedule and no pull-request trigger, and it uses a protected environment, so GitHub pauses the job until you approve it. Until then the key can't be read ([GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).

**One-time setup (works from a phone browser):**

1. Open the repository on github.com, then **Settings** → **Environments** → **New environment**. Name it exactly `gemini-eval` and tap **Configure environment**.
2. Tick **Required reviewers**, add yourself and tap **Save protection rules**.
3. Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main`.
4. Under **Environment secrets**, tap **Add environment secret**: name `GEMINI_API_KEY`, value your key.

**Each session:**

1. **Actions** → **Gemini evaluation** → **Run workflow**. Leave `max_calls` at 60 or raise it; leave `resume_from` blank the first time.
2. The run waits with "Review pending". Tap **Review deployments**, tick `gemini-eval`, **Approve and deploy**.
3. When it finishes, the run page has two downloads: `eval-gemini-report` (the Markdown and JSON report) and `eval-gemini-state` (the saved run).
4. Next day, start it again with `resume_from` set to the previous run's ID: the number at the end of its address, `.../actions/runs/<this number>`.

**What is public:** in a public repository, anyone signed in to GitHub can download a workflow's artifacts ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)). These contain only the synthetic test data, the models' answers and their scores, never the key. The saved run is kept for 30 days, the report for 90.

## Files in this folder

| File                                                 | What it is                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [triage-rubric.md](triage-rubric.md)                 | The written rules for category and priority labels.                                                            |
| [label-spot-check.md](label-spot-check.md)           | The M4 checklist for the 22 mechanically chosen retrieval questions.                                           |
| [spot-check-2026-10-23.md](spot-check-2026-10-23.md) | The M6 spot-check of the test data: what was checked, by whom (person or AI, each labelled), and what changed. |
| [unanswerable-check.md](unanswerable-check.md)       | The three-way check that the 30 unanswerable questions really have no answer in the help centre.               |
| [refusal-threshold.md](refusal-threshold.md)         | How the retrieval score floor (0.62) was chosen.                                                               |
| [retrieval-baseline.md](retrieval-baseline.md)       | The M4 retrieval measurement.                                                                                  |
| [ai-smoke-2026-10-23.md](ai-smoke-2026-10-23.md)     | The first, budgeted Gemini check of the AI features (20 triage calls, 20 drafts, 20 attacks).                  |
| [m6-baseline.md](m6-baseline.md)                     | **The full Gemini baseline (420 items):** every number, its interval, findings and limits.                     |
