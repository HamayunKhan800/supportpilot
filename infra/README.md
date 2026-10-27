# Infrastructure (Terraform)

Everything SupportPilot needs on Google Cloud is described as code in [`terraform/`](terraform/), so the setup is repeatable, reviewed in pull requests and versioned with the app (plan [M8](../docs/plans/m8-deployment.md), decision D6).

## What it creates

| File          | Resources                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `main.tf`     | Required Google APIs; derived addresses                                                                |
| `registry.tf` | Artifact Registry Docker repository with immutable tags; keeps the 3 newest images                     |
| `iam.tf`      | Runtime identity per environment; Workload Identity Federation for GitHub Actions; deployer identities |
| `secrets.tf`  | Empty Secret Manager secrets; each environment reads only its own                                      |
| `run.tf`      | Cloud Run services (web + worker), `migrate` and `seed-demo` jobs, optional custom domain mapping      |
| `logging.tf`  | Keeps tracking-link tokens (`/t/{token}`) out of Cloud Run request logs                                |
| `budget.tf`   | Alert budget for the whole project                                                                     |

Not managed here:

- **Neon Postgres**: created in the Neon console; its connection string goes into Secret Manager.
- **Cloudflare DNS**: records are entered by hand from the `domain_dns_records` output.
- **The $5 Cloud Run spend cap**: [`scripts/spend-cap.sh`](scripts/spend-cap.sh). The Terraform Google provider can't manage spend caps yet (checked with `hashicorp/google` 8.8.1).

## Security choices

- **No stored keys.** GitHub Actions signs in with short-lived OIDC tokens. The trust is pinned to the repository's numeric IDs (`1428261530`, owner `345785392`), which survive renames and can't be copied by a look-alike repository.
- **Production needs approval.** Only jobs running in the protected `production` GitHub environment can act as the production deployer. The production deployer can't push images; it deploys images that already ran on staging.
- **Least privilege.** Deployers get `run.developer` on their own service and jobs only. Runtime identities can read only their own environment's secrets.
- **Secret values never enter Terraform state.** Terraform creates empty secrets; the owner adds the values with `gcloud`.
- **Image changes belong to CI.** Terraform ignores the image field after the first create, so `terraform apply` never rolls back a deployment.

## Checks without a cloud account

CI (`.github/workflows/ci.yml`, job `infra`) runs these on every push. Locally:

```bash
cd infra/terraform
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test        # offline: mocked Google provider, 3 runs
trivy config .        # misconfiguration scan
```

## First-time setup (owner, from Google Cloud Shell)

Cloud Shell works in a phone browser at <https://shell.cloud.google.com> and already has `gcloud`, `terraform` and Docker. Run `terraform version`; 1.7 or newer is needed.

1. **Project.** Create a project, link the billing account, and note both IDs. The Gemini key stays in a separate project **without** billing (plan D10).

2. **Get the code and the state bucket.**

   ```bash
   git clone https://github.com/HamayunKhan800/supportpilot.git && cd supportpilot
   gcloud config set project <project-id>
   bash infra/scripts/bootstrap.sh <project-id>
   ```

3. **Settings.** Copy the example settings file and fill it in. It holds no secrets and is git-ignored.

   ```bash
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars
   nano terraform.tfvars
   terraform init -backend-config="bucket=<project-id>-tfstate"
   ```

4. **Phase A: the foundations.** A Cloud Run service can't start without an image and secret values, so create everything else first:

   ```bash
   terraform apply \
     -target=google_artifact_registry_repository_iam_member.deployer \
     -target=google_service_account_iam_member.deployer_wif \
     -target=google_secret_manager_secret_iam_member.runtime \
     -target=google_billing_budget.project \
     -target=google_logging_project_exclusion.tracking_tokens
   ```

5. **Secret values.** List the secret names with `terraform output secret_ids`. Add each value without it appearing on screen or in shell history:

   ```bash
   read -rs VALUE && printf '%s' "$VALUE" | gcloud secrets versions add production-database-url --data-file=- && unset VALUE
   ```

   - `*-better-auth-secret`: `openssl rand -base64 32`.
   - `*-email-outbox-token`: `openssl rand -base64 32`.
   - `*-database-url`: the Neon **direct** (not pooled) connection string for that environment's branch, with `sslmode=require`.

6. **First image.** Build and push one image. After this, GitHub Actions deploys new images (plan step 5).

   ```bash
   cd ~/supportpilot
   REPO=europe-west1-docker.pkg.dev/<project-id>/supportpilot
   gcloud auth configure-docker europe-west1-docker.pkg.dev
   docker build -t $REPO/app:sha-$(git rev-parse --short HEAD) .
   docker push $REPO/app:sha-$(git rev-parse --short HEAD)
   ```

   Put that tag in `image` in `terraform.tfvars`.

7. **Phase B: everything.**

   ```bash
   cd infra/terraform && terraform apply
   ```

8. **Spend cap.** Run this once. The amount is in the billing account's currency.

   ```bash
   bash infra/scripts/spend-cap.sh create <project-id> <billing-account-id> 5
   bash infra/scripts/spend-cap.sh status <project-id> <billing-account-id>
   ```

   When the cap is hit, every Cloud Run service and job in the project stops until the next month. `spend-cap.sh lift` reopens them for the rest of that month, and recovery can take up to an hour.

9. **Custom domain (later).**
   1. Verify the domain in Google Search Console with the same Google account.
   2. Set `custom_domain`, then run `terraform apply`.
   3. Add the records from `terraform output domain_dns_records` at Cloudflare as **DNS only** (grey cloud).
   4. Make sure any CAA records allow `pki.goog` and `letsencrypt.org`.

## Rollback

GitHub Actions moves traffic back to the previous revision (plan D8, step 5). By hand:

```bash
gcloud run services update-traffic supportpilot --region europe-west1 --to-revisions <previous-revision>=100
```

Terraform state is versioned in its bucket, so an earlier state file can be restored from there.
