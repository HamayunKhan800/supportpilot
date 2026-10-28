# ADR-0021 · Live demo on AWS Lambda (Sydney) with Neon

Status: Accepted · Date: 2026-10-28 · Plan: [M8 deployment, revision 2](../plans/m8-deployment.md) · Replaces the platform choice in [ADR-0008](0008-deployment-low-cost.md) · Code: `infra/`, `.github/workflows/{deploy,rollback,infra,uptime}.yml` · Runbook: [docs/runbook.md](../runbook.md)

## Context

ADR-0008 chose one Docker image run as `web` and `worker`, on a low-cost platform picked at M8. Several things shaped that pick:

- **The demo is used rarely, not all day.** It should cost nothing while idle.
- **No payment card was accepted.** Google Cloud refused the owner's card. A new AWS account on the Free plan needs none: it comes with $100 of credit and ends on 27 April 2027 ([AWS plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)).
- **The new account's organization policy blocks some things.** It denies IAM OIDC providers, so GitHub can't sign in with short-lived OIDC tokens ([AWS SCPs for these accounts](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html)).
- **Employer signal.** AWS and Terraform are widely used.

## Decision

| Part      | Choice                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute   | **Two Lambda functions from the same arm64 container image** in `ap-southeast-2`. `supportpilot-web` runs Next.js behind the [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) (built from source at a pinned commit) and is served by a Function URL. `supportpilot-worker` runs migrations, the demo reset and the job queue |
| Jobs      | The web function wakes the worker with an asynchronous invoke after it queues work; the worker drains pg-boss and stops. EventBridge Scheduler runs the daily demo reset. No always-on worker                                                                                                                                                        |
| Database  | Neon Postgres (free plan) in AWS Sydney, next to the functions: pooled connection for web, direct for the worker and migrations, `sslmode=verify-full`                                                                                                                                                                                               |
| Secrets   | SSM Parameter Store `SecureString`, one folder per function plus `shared/`. A permission boundary lets each function read only its folders                                                                                                                                                                                                           |
| Infra     | Terraform with state in S3, run by the **Infrastructure** workflow (plan, approval, apply)                                                                                                                                                                                                                                                           |
| CI/CD     | **Deploy** starts when CI passes on `main` and waits for the owner's approval of the `production` environment. Migrate on the new worker version first, then move the `live` aliases, then smoke-test. GitHub signs in with one IAM user per environment that may only assume its role (rotated every few months)                                    |
| Rollback  | Each release points a `previous` alias at the outgoing versions; **Rollback** swaps `live` and `previous` on both functions. Migrations stay additive                                                                                                                                                                                                |
| Staging   | None. CI (unit, integration, E2E, container smoke test) gates every release; the approval and the one-step rollback cover the rest                                                                                                                                                                                                                   |
| Operation | **Uptime** checks once a week (GitHub emails on failure); AWS Budgets emails at 50% and 100% of $5 a month, counting usage before credits                                                                                                                                                                                                       |

## Alternatives considered

| Option                               | Why not                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Google Cloud Run (the first plan)    | The card was refused                                                                           |
| ECS Fargate behind a load balancer   | About $50 a month for the load balancer and tasks, for a demo used a few times a week          |
| EC2 or Lightsail                     | Always on, so it uses credit while idle, and the operating system must be patched              |
| App Runner, Render, Vercel, Firebase | Not available to this account, needs a card, or doesn't fit a container with a separate worker |

## Consequences

- \+ **About $0 a month at demo traffic.** Lambda's always-free allowance is 1 million requests and 400,000 GB-seconds a month ([pricing](https://aws.amazon.com/lambda/pricing/)), and Neon's free plan sleeps after 5 idle minutes ([Neon plans](https://neon.com/docs/introduction/plans)).
- \+ **The same image runs everywhere.** It runs locally, in CI's container smoke test and in both functions, so a release is the image CI tested.
- \+ **Releases and rollbacks are quick and repeatable.** Moving an alias takes seconds; both were tried on the live site (plan change log, 2026-10-28).
- − **Cold starts.** The first request after a quiet spell, or after a release, starts an instance and may wake the database: about 3 s measured after a release.
- − **Request size.** Lambda's synchronous payload limit is 6 MB ([quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)), so uploads are capped at 4 MB to leave room for base64.
- − **Client addresses.** A Function URL passes on whatever `X-Forwarded-For` the client sends, so per-IP rate limits can't trust it until CloudFront sits in front (plan step 6, [AR-004](../security/accepted-risks.md)).
- − **Long tasks.** A synchronous invoke from a GitHub runner that runs for many minutes can lose its connection (seen once with a 14-minute demo reset), so long tasks should be started asynchronously and polled.
- − **Long-lived keys and redeploys.** The robot keys must be rotated by hand. A changed secret reaches the app only with new function versions, because Lambda reads secrets at cold start.
- − **The Free plan ends on 27 April 2027.** The account must then be upgraded or the demo retired ([runbook](../runbook.md#before-the-aws-free-plan-ends)).
