# ---------------------------------------------------------------------------
# Runtime identities: one per environment, each reads only its own secrets.
# ---------------------------------------------------------------------------
resource "google_service_account" "runtime" {
  for_each = var.environments

  account_id   = "${each.value.service_name}-run"
  display_name = "SupportPilot ${each.key} runtime"
  description  = "Identity of the ${each.key} Cloud Run service and jobs. Reads only its own secrets."

  depends_on = [google_project_service.this]
}

# ---------------------------------------------------------------------------
# GitHub Actions sign-in without stored keys (Workload Identity Federation).
# ---------------------------------------------------------------------------
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "OIDC tokens from GitHub Actions for ${var.github_repository}."

  depends_on = [google_project_service.this]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  # Numeric IDs never change, so a renamed or look-alike repository can't sign in.
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}'"
}

locals {
  pool = google_iam_workload_identity_pool.github.name

  # Who may act as each deployer:
  # - staging: any workflow run from the main branch of the repository;
  # - production: only jobs running in the protected "production" GitHub environment,
  #   which needs the owner's approval (plan M8 D7).
  deployer_principal = {
    staging    = "principalSet://iam.googleapis.com/${local.pool}/attribute.ref/refs/heads/main"
    production = "principal://iam.googleapis.com/${local.pool}/subject/repo:${var.github_repository}:environment:production"
  }
}

resource "google_service_account" "deployer" {
  for_each = var.environments

  account_id   = "${each.value.service_name}-deploy"
  display_name = "SupportPilot ${each.key} deployer (GitHub Actions)"
  description  = "Deploys new images to the ${each.key} service and runs its jobs."

  depends_on = [google_project_service.this]
}

resource "google_service_account_iam_member" "deployer_wif" {
  for_each = var.environments

  service_account_id = google_service_account.deployer[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.deployer_principal[each.key]
}

# Staging builds and pushes images; production only deploys images that staging already ran.
resource "google_artifact_registry_repository_iam_member" "deployer" {
  for_each = var.environments

  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.name
  role       = each.key == "staging" ? "roles/artifactregistry.writer" : "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.deployer[each.key].email}"
}

# Deploying a revision that runs as the runtime identity requires "act as" on it.
resource "google_service_account_iam_member" "deployer_act_as_runtime" {
  for_each = var.environments

  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer[each.key].email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer" {
  for_each = var.environments

  location = var.region
  name     = google_cloud_run_v2_service.app[each.key].name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer[each.key].email}"
}

resource "google_cloud_run_v2_job_iam_member" "deployer_migrate" {
  for_each = var.environments

  location = var.region
  name     = google_cloud_run_v2_job.migrate[each.key].name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer[each.key].email}"
}

resource "google_cloud_run_v2_job_iam_member" "deployer_seed" {
  for_each = var.environments

  location = var.region
  name     = google_cloud_run_v2_job.seed_demo[each.key].name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer[each.key].email}"
}
