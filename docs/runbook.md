# Runbook

How to run the live demo: what runs by itself, how to release and undo, and what to do when something breaks. Setup from scratch is in [`infra/README.md`](../infra/README.md); the design is in [ADR-0021](adr/0021-aws-lambda-deployment.md).

Times are Pakistan time (PKT, UTC+5). Anything tied to Google's daily quota follows midnight Pacific time, which is 12:00 PKT while the US is on daylight saving time and 13:00 PKT from the first Sunday of November (1 November 2026) until the second Sunday of March.

## At a glance

| What                | Where                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live site           | the repository variable `LIVE_URL` (now the Lambda Function URL; the custom domain replaces it in plan M8 step 6)                                                   |
| Code and pipelines  | GitHub Actions: **CI**, **Security**, **Deploy**, **Rollback**, **Infrastructure**, **Uptime**                                                                      |
| App                 | AWS account, region `ap-southeast-2` (Sydney): functions `supportpilot-web` and `supportpilot-worker`, aliases `live` and `previous`, image registry `supportpilot` |
| Secrets             | SSM Parameter Store under `/supportpilot/production/` (`web/`, `worker/`, `shared/`, `settings/`)                                                                   |
| Logs                | CloudWatch log groups `/aws/lambda/supportpilot-web` and `/aws/lambda/supportpilot-worker`, kept 14 days                                                            |
| Database            | Neon project `supportpilot` (AWS Sydney), branch `production`                                                                                                       |
| Alerts              | **Uptime** failure email from GitHub; AWS Budgets email at 50% and 100% of $5 a month                                                                               |
| AWS account expires | **27 April 2027** (Free plan; see [Before the AWS Free plan ends](#before-the-aws-free-plan-ends))                                                                  |

## What runs by itself

| When                                    | What                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every push to `main`                    | CI and Security. When CI passes, **Deploy** starts and waits for approval, unless only documentation changed since the last release                              |
| 00:05 Pacific time (12:05 or 13:05 PKT) | The demo reset (EventBridge Scheduler → worker `seed-reset`): the demo workspace is rebuilt, visitor tickets are removed and the help articles are indexed again |
| Mondays 11:23 PKT                       | **Uptime** checks the health and readiness endpoints, the landing, sign-in and portal pages. GitHub emails the owner if a run fails                              |
| After each new ticket or upload         | The web function wakes the worker (asynchronous invoke) to triage, draft and index; the worker stops when its queue is empty                                     |
| Midnight Pacific time                   | The app's own daily AI limits start again: 200 Gemini calls and 800 embeddings for the whole deployment                                                          |

GitHub turns scheduled workflows off in a public repository after 60 days without activity ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). If **Uptime** shows a "disabled" banner, open it and choose **Enable workflow**. The demo reset runs in AWS and is not affected.

## Release

Push to `main`. After CI passes, open the **Deploy** run and approve `production`. Details: [Deploying](../infra/README.md#deploying).

- **To rebuild the demo now** (for example after changing the AI provider): **Actions → Deploy → Run workflow** with **Rebuild the demo workspace** ticked.
- **A Deploy run you don't want** (for example for an older commit): open it and choose **Reject**. A run waiting for approval holds the queue, so Rollback waits behind it.
- **After changing a secret in SSM:** run Deploy by hand (box unticked). Lambda reads secrets when an instance starts, so new versions are needed to pick up the change.

## Roll back

**Actions → Rollback → Run workflow**, then approve. Both functions go back to the release before the current one in about a minute, and the workflow smoke-tests the result. Run it again to go forward. Then fix forward: push a fix and let it deploy before the next **Infrastructure** apply, which would otherwise move `live` forward again. Details: [Rollback](../infra/README.md#rollback).

The database is not rolled back. Migrations stay additive, so older code works with the newer schema. If data itself is damaged, see [Restore the database](#restore-the-database).

## The site is down

Start here when the Uptime email arrives or someone reports the site down.

1. **Open the failed Uptime run.** Its summary lists which checks failed. Run **Uptime** again by hand (**Run workflow**) to see if it is still failing.
2. **Did a release just happen?** If the last **Deploy** or **Infrastructure** run is recent, run **Rollback** first and investigate afterwards.
3. **Only `/api/ready` failed** (the rest answer): the app is up but can't reach the database.
   - Neon console → project `supportpilot` → **Monitoring**, and [neonstatus.com](https://neonstatus.com) for incidents.
   - Neon console → **Billing / Usage**: the free plan has 100 compute-hours per project per month; when they run out, the database stays off until the next month.
4. **Everything failed:** the functions or AWS are the problem.
   - In AWS CloudShell (region Sydney), the latest web errors:
     ```bash
     aws logs tail /aws/lambda/supportpilot-web --since 1h --region ap-southeast-2 --format short | grep -iE 'error|timed out|fatal' | tail -n 30
     ```
   - [AWS Health Dashboard](https://health.aws.amazon.com/health/status) for `ap-southeast-2`.
   - AWS console → **Billing**: if the $100 credit ran out or the Free plan ended, AWS suspends the account ([Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)).
5. **Write down** what failed, when, and what fixed it, in the change log of the current plan or a GitHub issue.

## AI features stopped

New tickets get no category, or drafts and article indexing stop. Everything else works, because the app falls back to people doing the work.

1. **Daily limits:** at 200 calls or 800 embeddings in a day, the app stops calling Gemini until midnight Pacific time (12:00 or 13:00 PKT). The next demo reset indexes the articles again. Failed calls count too: the worker retries a failed indexing job, and each try uses part of the embedding limit.
2. **Errors from Gemini:** signed in, **Settings → This month's usage** counts calls and their outcomes per feature for the month. A rising error count points at Gemini. In CloudShell:
   ```bash
   aws logs tail /aws/lambda/supportpilot-worker --since 3h --region ap-southeast-2 --format short | grep -i 'ai call failed' | tail -n 20
   ```
   Google's free tier allows a limited number of requests per day and minute; an overloaded draft model falls back to Flash-Lite by itself ([ADR-0016](adr/0016-draft-model-fallback.md)).
3. **Key refused** (HTTP 401 "API key not valid"): replace the key ([Rotate a secret](#rotate-a-secret)).

## Restore the database

Neon keeps the change history of the `production` branch for the last **6 hours** on the free plan, and allows **1 manual snapshot** ([Neon plans](https://neon.com/docs/introduction/plans)). There are no scheduled backups on the free plan.

- **Bad data or a broken migration within the last 6 hours:** Neon console → branch `production` → **Backup & Restore** → **Restore from history**, and choose a time just before the problem. The whole branch is overwritten, connections drop for a moment and the connection details stay the same. Neon first saves the current state as a branch named `production_old_<time>`, so the restore itself can be undone ([Instant restore](https://neon.com/docs/introduction/branch-restore)). That branch counts towards the 10-branch limit; delete it once you are sure.
- **Older than 6 hours:** the demo data is rebuilt every day anyway. Run **Deploy** by hand with **Rebuild the demo workspace** ticked. Visitor tickets since the last reset are lost, which is acceptable for a demo that removes them daily.
- **Before a risky migration:** take the one manual snapshot (Neon console → **Backup & Restore** → **Create snapshot**), and delete it once the release is confirmed.
- **Code after a restore:** if the restore went back before a migration, the live code may expect the newer schema. Run **Rollback** to the release that matches, or run **Deploy** again to re-apply the migrations.

Not rehearsed on production yet: Neon restores were not tried on this project's `production` branch, to keep it clean.

## Rotate a secret

All in AWS CloudShell, region Sydney. Type values at the shell prompt (not into a hidden password prompt): on a phone, hidden prompts have added stray characters to pasted keys. Afterwards, run **Deploy** by hand (box unticked) so new versions read the new value. Never paste a secret into an issue, a commit or a chat.

| Secret                                   | How                                                                                                                                                                                                                                                                                                                                                                                                 | Effect                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Gemini API key (`shared/GEMINI_API_KEY`) | New key in Google AI Studio, then `aws ssm put-parameter --region ap-southeast-2 --name /supportpilot/production/shared/GEMINI_API_KEY --type SecureString --overwrite --value 'NEW_KEY'`. Check it with `aws ssm get-parameter --region ap-southeast-2 --with-decryption --name /supportpilot/production/shared/GEMINI_API_KEY --query 'length(Parameter.Value)'`. Delete the old key in AI Studio | None for users                                                                                                 |
| `web/BETTER_AUTH_SECRET`                 | `aws ssm put-parameter --region ap-southeast-2 --name /supportpilot/production/web/BETTER_AUTH_SECRET --type SecureString --overwrite --value "$(openssl rand -base64 48)"`                                                                                                                                                                                                                         | Everyone is signed out; stored Google and GitHub tokens become unreadable and are replaced at the next sign-in |
| Neon database password                   | Neon console → branch `production` → **Roles & Databases** → reset the app role's password, then `bash supportpilot/infra/bootstrap/secrets.sh` with the new connection string (it stores the pooled address for the web function and the direct one for the worker). It asks in a hidden prompt, so on a phone check the site after the Deploy                                                     | The site can't reach the database until the Deploy finishes                                                    |
| GitHub robot keys (every few months)     | `bash supportpilot/infra/bootstrap/github-keys.sh` with a short-lived GitHub token: it stores a new key for each environment, then deletes the old one                                                                                                                                                                                                                                              | None                                                                                                           |
| Demo password (`shared/DEMO_PASSWORD`)   | Public by design (visitors sign in with it). To change it: delete the parameter, run `secrets.sh` (it generates a new one), Deploy with **Rebuild the demo workspace**, and update the password in the README's Live demo section                                                                                                                                                                   | Old demo sign-ins stop working                                                                                 |

If a key may have leaked, rotate it first and investigate afterwards. gitleaks scans every push and the full history ([`security.yml`](../.github/workflows/security.yml)).

## Costs

- **Expected:** about $0 a month ([Costs](../infra/README.md#costs)). The AWS Budgets email arrives at 50% and 100% of $5, counting usage before credits.
- **Check once a month:** AWS console → **Billing and Cost Management** (spend by service, credit left); Neon console → **Usage** (compute-hours out of 100, storage out of 1 GB).
- **Gemini:** free tier, capped by the app's daily limits. Google's free tier may use inputs to improve its products, so the demo holds only invented data.

## Before the AWS Free plan ends

The Free plan ends on **27 April 2027**, or earlier if the $100 credit runs out. AWS then closes the account, keeps its content for 90 days and deletes it if the account is not upgraded to the Paid plan ([AWS Free Tier FAQs](https://aws.amazon.com/free/free-tier-faqs/)). AWS emails 15, 7 and 2 days before ([AWS tutorial](https://docs.aws.amazon.com/hands-on/latest/control-your-costs-free-tier-budgets/control-your-costs-free-tier-budgets.html)). Decide about a month ahead:

- **Keep the demo:** upgrade to the Paid plan (needs a card). Expected cost stays near $0 at demo traffic, and the $5 budget alert keeps working.
- **Retire it:** the code, tests and documentation stay on GitHub. Update the README's live-demo link, then let the account close, or delete the stack first (`terraform destroy` through a temporary change to **Infrastructure**).
