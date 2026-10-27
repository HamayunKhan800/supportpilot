data "google_project" "this" {
  project_id = var.project_id
}

locals {
  services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
  ])

  # Cloud Run's deterministic address: https://SERVICE-PROJECT_NUMBER.REGION.run.app
  run_app_url = {
    for k, e in var.environments :
    k => "https://${e.service_name}-${data.google_project.this.number}.${var.region}.run.app"
  }

  public_url = {
    for k, e in var.environments :
    k => e.custom_domain != null ? "https://${e.custom_domain}" : local.run_app_url[k]
  }
}

resource "google_project_service" "this" {
  for_each = local.services

  service = each.value
  # Switching an API off can break things outside this config; leave them on at destroy.
  disable_on_destroy = false
}
