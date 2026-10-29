# SupportPilot: case study

**SupportPilot** is a multi-tenant help desk. AI labels each new ticket and drafts replies from the company's own help articles, with citations, and a person approves every reply. I built it alone, one tested milestone at a time, as a portfolio project.

[Live demo](https://uvum4mohfhovga35knouyzhqmi0wkxnr.lambda-url.ap-southeast-2.on.aws) · [1-minute video](demo/walkthrough.mp4) · [README](../README.md) · [Milestone log](milestones.md)

## The problem

Support teams answer the same questions again and again, and the answers already exist in their help centre. AI can write those replies quickly, but it brings three risks for a business:

1. **Made-up answers:** a fluent reply that the help centre doesn't support.
2. **Loss of control:** a bot replying to customers, or overwriting a decision a person made.
3. **Hidden costs and failures:** rate limits, slow or overloaded models, and bills that grow quietly.

**Goal:** AI that does the slow part (reading, labelling, drafting) and shows its sources, while people stay in charge. It also had to be secure, tested, measured on a real model and live on the internet, for a few dollars a month at most.

## What I built

- **Customers** send a request from a public form and follow it through a private link. No account is needed.
- **Agents** work from an inbox. Each new ticket gets an AI category and priority. A draft cites its sources, passes automatic checks, can be edited and is sent only when the agent approves it.
- **Admins** manage the help articles (Markdown, text or PDF), AI settings (on/off, monthly budget, auto-apply threshold), members, roles and an audit log.
- **The team running it** gets usage analytics and an evaluation dashboard, with no customer text in either.

## Key decisions

| Decision                                                                                                                                        | Why                                                                                                    | Trade-off                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Grounded or refused.** Drafts use only the 5 best-matching passages; every `[n]` citation is checked; weak matches are refused.               | A reply an agent can verify in seconds. Below a score of 0.62, no AI call is made at all.              | Some answerable questions are refused (1.8% in the evaluation).                                                   |
| **People decide.** Triage is applied only above the confidence threshold and never over a person's choice; drafts are never sent automatically. | Mistakes stay cheap and visible ("Needs review").                                                      | More clicks than full automation.                                                                                 |
| **One gateway for every model call:** budget, an atomic daily cap, timeouts, a circuit breaker, a fallback model and a cost log.                | Failures and costs are handled in one place. 429s are never rerouted, so rate limits are respected.    | More code than calling the SDK directly.                                                                          |
| **PostgreSQL for data, the job queue (pg-boss) and vectors (pgvector).**                                                                        | One system to run, back up and secure.                                                                 | Fine at this scale; a large deployment might split them.                                                          |
| **A modular monolith:** one codebase, one image, a web and a worker process.                                                                    | Simple to build and deploy; boundaries are enforced by lint rules and an architecture test.            | Modules can't scale separately.                                                                                   |
| **AWS Lambda + Neon** ([ADR-0021](adr/0021-aws-lambda-deployment.md)).                                                                          | The demo is used rarely, so it scales to zero and costs almost nothing. Terraform describes all of it. | Cold starts of a few seconds, 4 MB uploads (Lambda's payload limit), and the worker has to be woken for each job. |
| **Decide from measurements**, with the rule written before the test.                                                                            | Defaults follow data, not taste (see Results).                                                         | A small, synthetic test set: the numbers are a baseline, not proof.                                               |

## Results

Measured on real Gemini models (420 test items, 24 October 2026; ranges are 95% Wilson intervals). Full report: [m6-baseline.md](eval/m6-baseline.md).

| What                                                | Result                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| Right article in the top 5 search results           | 99.1% of 110 (95.0–99.8%)                         |
| Triage category correct (prompt v2)                 | 94.0% of 150 (89.0–96.8%)                         |
| Citations pointing at a passage the model was given | 100% of 133                                       |
| Unanswerable questions declined                     | 100% of 30                                        |
| Prompt-injection attacks resisted                   | 100% of 20                                        |
| Draft supported by its sources                      | 99.1% (AI-graded, not checked against a human)    |
| Speed, typical / slow (p50 / p95)                   | triage 1.3 s / 17.5 s; full draft 13.7 s / 28.5 s |
| Cost of the whole 420-item run at paid-tier prices  | about $0.18 ($0 on the free tier)                 |

Engineering:

- **Tests:** 1,452 unit (96% of lines), 571 integration on real PostgreSQL, 106 browser tests with axe accessibility scans in both themes. All run in CI on every push.
- **Security:** a self-review against OWASP ASVS 5.0 Level 2: 183 pass, 9 partial, 2 fail as documented accepted risks, 59 not applicable. 22 findings, none High or Critical.
- **Delivery:** after CI passes, one approval deploys: worker, migrations, web, then 12 smoke tests on the live site. Rollback was tested in both directions.

## What went wrong, and what I changed

1. **The first auto-apply threshold was wrong.** At 0.7, all 19 wrong triage categories in the test set would have been applied automatically. I moved the default to 0.95, where 13 of the 19 are caught and about 15% of tickets go to a person ([finding 1](eval/m6-baseline.md#findings)).
2. **A visual test passed through a real change.** A triage card changed from "Applied automatically" to "Needs review", but the change was under the 1% pixel tolerance. The test now checks the card's text before the screenshot, so a change in state fails as text, not pixels.
3. **A test run proved nothing.** The local E2E database hadn't been migrated, so the run tested the old default. After migrating, two real failures appeared and were fixed. CI wasn't affected because it migrates a fresh database first.
4. **The cloud plan changed halfway.** Google Cloud refused my virtual card, so I re-planned on AWS, which needed no card. For a rarely used demo, Lambda beat Fargate, EC2 and Lightsail on cost. The code change was small: two Lambda modes and a "wake the worker" call.
5. **AWS blocked keyless sign-in from GitHub.** New AWS accounts sit under a policy that denies creating the OIDC identity provider. I used two IAM users instead, each allowed only to assume one narrowly scoped role, with their keys released only to approved jobs on `main`, rotated every few months.
6. **A dependency registry refused CI.** `public.ecr.aws` answered 429 to anonymous pulls of the Lambda Web Adapter. It is now built from source, pinned to the release commit by checksum.
7. **The first live demo reset failed.** The seed needs the auth secret, which the worker deliberately can't read. Rather than widen its access, the worker gives the seed a throwaway secret; nothing the seed stores depends on it.
8. **A pasted API key broke the AI.** Copying from a phone added two stray characters, and the retries used up the day's embedding allowance. A setup script now cleans a pasted key, checks it with Google and saves it only if Google accepts it. It happened again on the live site on 28 October, so the app itself now guards against it: a key that can't be sent in a header fails at once as a permanent error with no retries, and calls the provider rejects (a damaged or invalid key, a bad request) give their place in the daily limits back. Overloads, rate limits and timeouts stay counted, so the limits still bound retries.
9. **Database settings the driver silently ignored.** Neon's connection pooler drops the `statement_timeout` startup option, so it is now set on the database role. The Node driver also ignored `channel_binding=require`, so the app now turns on its channel-binding option itself; a stand-in TLS server confirmed the driver then chooses `SCRAM-SHA-256-PLUS`.
10. **A production-only bug.** A security fix caused a 500 error on sign-up in the production build only. The browser tests, which run against the production build, caught it before it was committed.

## Honest limitations

- The evaluation uses a small, synthetic help centre (35 articles) and one run on the free tier. Groundedness is graded by an AI model, not by people.
- The security review was done by me with AI help, not by an independent tester. There is no two-factor sign-in yet (accepted risk AR-007).
- The demo runs on a Lambda Function URL without a CDN, so it has no HTTP-to-HTTPS redirect, no stricter TLS policy, and no trustworthy client IP for per-IP limits. A custom domain with CloudFront is the next step.
- One region, one database, English-only interface.

## Talking points for an interview

- **"How do you stop the AI making things up?"** Retrieval first, refusal when nothing scores high enough (no AI call at all), citation checks against the exact passages given, and a person approves every reply. Measured: 100% of 133 citations valid, 100% of 30 unanswerable questions declined.
- **"How did you choose the threshold?"** From data: 0.7 let every wrong label through; 0.95 catches 13 of 19 and sends about 15% to a person. It was chosen on the same tickets, so I report that as a limitation and would confirm it on new data.
- **"What happens when the model is down or slow?"** Timeouts, a circuit breaker, a fallback model for drafts, and tickets that wait for a person. Rate limits are never retried on another model.
- **"Why Lambda, not containers or Kubernetes?"** The demo is used rarely; scaling to zero makes it almost free. The costs are cold starts, a 4 MB upload limit and a wake-up path for the worker, all documented in an ADR.
- **"How do you keep tenants apart?"** Every query takes the workspace ID, roles are checked on the server, and every route has cross-workspace tests.
- **"How did you use AI tools?"** As a fast first draft under a written policy: every change passes type checks, lint and tests, and framework APIs are checked against the official docs. Item 10 above, for example, was caught by the browser tests before it was committed.
- **"What would you do next?"** The custom domain behind CloudFront, email sending, two-factor sign-in, people rating a sample of drafts.
