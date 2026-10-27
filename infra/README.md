# Infrastructure (AWS, Terraform)

SupportPilot runs on **AWS Lambda in Sydney** with **Neon Postgres** in the same region (plan [M8 revision 2](../docs/plans/m8-deployment.md)). Everything on AWS is code: a one-time bootstrap script for the few things Terraform needs before it can run, and Terraform for the rest, applied from GitHub Actions after the owner approves.

```
visitor ──https──▶ Function URL (streaming) ──▶ supportpilot-web:live ──▶ Neon (pooled)
                                                      │ async Invoke {"task":"drain"}
EventBridge Scheduler 00:05 LA {"task":"seed-reset"} ─▶ supportpilot-worker:live ──▶ Neon (direct)
GitHub Actions (approved; IAM user → role) ──▶ ECR image · migrate · move `live`
```

## What it creates

| Where                                                              | What                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`bootstrap/bootstrap.sh`](bootstrap/)                             | S3 state bucket (versioned, private, TLS only) · two GitHub Actions IAM users · permissions boundary · `supportpilot-infra` role · $5 Budgets email alert |
| [`terraform/registry.tf`](terraform/)                              | ECR repository: immutable tags, scan on push, keeps the 3 newest images, pull grant for Lambda                                                            |
| `terraform/functions.tf`                                           | `supportpilot-web` and `supportpilot-worker` (one arm64 image, two launcher modes), `live` aliases, public streaming Function URL, log groups (14 days)   |
| `terraform/schedule.tf`                                            | Nightly demo reset at 00:05 America/Los_Angeles, just after Gemini's free quota resets                                                                    |
| `terraform/iam.tf`                                                 | Function roles, scheduler role, `supportpilot-deploy` role for GitHub's `production` environment                                                          |
| `terraform/settings.tf`                                            | `BETTER_AUTH_URL` (the app's own address) in Parameter Store                                                                                              |
| [`bootstrap/github-keys.sh`](bootstrap/github-keys.sh)             | Access keys for those users, stored straight into the GitHub environments' secrets (run again to rotate)                                                  |
| [`../.github/workflows/infra.yml`](../.github/workflows/infra.yml) | Plan → approve → apply the saved plan                                                                                                                     |

Not managed here: **Neon** (made in its console), **secret values** (added by the owner, below), the **domain** (step 6).

### Why the functions appear on the second apply

A Lambda function made from a container needs the image to exist first. So the first apply makes the registry and roles; after the first image is pushed, the next apply makes the functions. `infra.yml` works out which case applies (`scripts/current-image.sh`): once the functions exist it always passes the image they run, and it stops with an error rather than guess, so a plan never deletes them by accident.

## Security choices

- **GitHub signs in with one narrow key per environment.** The keyless route (GitHub OIDC) is blocked on this account: AWS's new sign-up puts accounts under an organization policy that denies creating identity providers (`DenyIAMRestrictedActions`, `iam:*Provider*`), and only "advanced features" lift it, which needs the paid plan, removes the spending limit and can't be undone ([AWS: managed policies](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html), [activate advanced features](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html)). So each protected environment has its own IAM user (`supportpilot-github-infra`, `supportpilot-github-deploy`) whose only permission is assuming its role, which in turn trusts only that user. The keys sit in the environment's secrets, which GitHub releases only to jobs on `main` that the owner approved. A leaked key still only reaches that one role. Trade-off: the keys are long-lived, so `github-keys.sh` rotates them (new key stored, then the old one deleted); move to OIDC if the account ever activates advanced features.
- **Approval before any change.** `infra` (Terraform) and `production` (deploys) both require the owner's approval.
- **A ceiling on everything Terraform makes.** The infra role can create roles only if they carry `supportpilot-boundary`, can't attach managed policies, and can't edit the boundary or itself. Whatever a role's own policy says, it can't exceed the boundary: logs, the app's Parameter Store folders, the app's functions and its image repository ([permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)). A unit test (`tests/unit/infra-policies.test.ts`) keeps the boundary equal to what the roles use.
- **Least privilege per function.** The web function reads `shared`, `web` and `settings` and may invoke only the worker's `live` alias. The worker reads `shared`, `worker` and `settings`: it never sees the sign-in secrets.
- **App secrets never enter Terraform state or GitHub.** They are SecureString parameters typed in CloudShell. Terraform writes only the non-secret `settings` folder, and the infra role can't read the others.
- **Public URL, private function.** The Function URL needs two grants since October 2025; the second is limited to calls through the URL, so the function can't be invoked directly ([Lambda docs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)).
- **Client IPs:** a Function URL passes the client's own `X-Forwarded-For` through ([test write-up](https://speedrun.nobackspacecrew.com/blog/2026/03/06/obtaining-caller-ip-address-with-lambda-furls.html)), so `TRUST_PROXY_HEADERS` stays `false` and per-IP limits share one bucket until CloudFront (step 6); per-account and per-workspace limits still apply.
- **Deliberately not done:** customer-managed KMS keys for logs and images (Trivy LOW findings). They cost $1 a month each and protect nothing extra here: no secret is in either.

## Checks without an AWS account

CI (`.github/workflows/ci.yml`, job `infra`) runs these on every push. Locally:

```bash
cd infra/terraform
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test -var-file=production.tfvars     # mocked AWS provider, 11 runs
shellcheck -S style ../bootstrap/*.sh ../scripts/*.sh
trivy config --severity MEDIUM,HIGH,CRITICAL .
```

## First setup (plan M8 step 4)

1. **Bootstrap** in [AWS CloudShell](https://console.aws.amazon.com/cloudshell/home?region=ap-southeast-2) (the `>_` icon at the top of the AWS console, Region Sydney):

   ```bash
   git clone --depth 1 https://github.com/HamayunKhan800/supportpilot.git
   bash supportpilot/infra/bootstrap/bootstrap.sh
   ```

   It asks for the budget email. Type it on the page itself: CloudShell can reconnect while you are away and feed its own text to the prompt.

2. **GitHub access**: first, the repository's _Environments_ `infra` and `production` exist, each with the owner as required reviewer and deployments limited to `main`. Then, in CloudShell:

   ```bash
   bash supportpilot/infra/bootstrap/github-keys.sh
   ```

   It asks for a GitHub fine-grained token for this repository with **Environments** and **Variables** read and write, makes a key for each IAM user, stores it in the matching environment's secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, encrypted for GitHub with libsodium, [GitHub docs](https://docs.github.com/en/rest/guides/encrypting-secrets-for-the-rest-api)) and sets the variable `AWS_ACCOUNT_ID`. No key is ever shown. Run it again to rotate the keys.

3. **Secrets** in CloudShell:

   ```bash
   bash supportpilot/infra/bootstrap/secrets.sh
   ```

   It asks for the Neon connection string (Neon console → **Connect**; pooled or direct, either works) and, optionally, the Gemini API key. Typed values stay hidden and never land in the shell history. It then:
   - stores the pooled address for the web function and the direct one for the worker, both with `sslmode=verify-full&channel_binding=require` ([`neon_url.py`](bootstrap/neon_url.py));
   - sets the database role's 10-second `statement_timeout` (Neon ignores it as a connection setting; migrations lift it for their own session);
   - generates `BETTER_AUTH_SECRET` and the shared demo password, keeping both on later runs, and prints the demo password: every visitor signs in with it, and the demo accounts can't change anything that affects others.

   Sentry (`shared/SENTRY_DSN`) and email come later. Running it again replaces the Neon string and the Gemini key when given.

4. **Actions → Infrastructure → Run workflow**, approve the plan, read the summary, approve the apply. This first run makes the registry and roles.
5. **Actions → Deploy → Run workflow** and approve. It builds the arm64 image and pushes it; the functions don't exist yet, so it stops there.
6. **Infrastructure** again (two approvals) makes the functions from that image.
7. **Deploy** again with **Rebuild the demo workspace** ticked: it migrates the empty database, seeds the demo and smoke-tests the public address.

## Deploying

[`deploy.yml`](../.github/workflows/deploy.yml) deploys only commits that passed CI, after the owner approves the `production` environment. It runs on GitHub's Arm runner, so the image is built natively for the functions. [`release.sh`](scripts/release.sh) then:

1. publishes a worker version with the new image and runs `migrate` on that version ([`run-task.sh`](scripts/run-task.sh)). If it fails, nothing serving traffic has changed;
2. publishes a web version;
3. moves both `live` aliases, then the workflow smoke-tests the public address (12 checks that need no database password; the database smoke tests run in CI).

The log shows the previous `live` versions, which a rollback needs.

## Rollback

Deploys move the `live` alias to a new version; rolling back moves it to the previous one (plan M8 step 5). A Terraform change to the functions publishes a new version from the image already running and moves `live` to it. So **after a rollback, fix forward before applying infrastructure changes**, or the apply would move `live` forward again.

## Costs

Expected about $0 a month at demo traffic: Lambda's always-free allowance is 1 million requests and 400,000 GB-seconds a month ([pricing](https://aws.amazon.com/lambda/pricing/)); Parameter Store standard parameters, OIDC and IAM are free, and Scheduler includes 14 million invocations a month ([pricing](https://aws.amazon.com/eventbridge/pricing/)). ECR storage is $0.10 per GB-month ([pricing](https://aws.amazon.com/ecr/pricing/)); its 500 MB allowance belongs to the older 12-month free tier, so the plan assumes it is paid from the credit: 3 images of a few hundred MB come to a few cents. The Budgets alert emails at 50% and 100% of $5, counting usage before credits, since the Free plan's $100 credit would otherwise hide it.
