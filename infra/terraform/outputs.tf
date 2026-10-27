output "service_urls" {
  description = "Public address of each environment."
  value       = local.public_url
}

output "run_app_urls" {
  description = "Cloud Run's own address of each environment (production redirects this to the custom domain)."
  value       = local.run_app_url
}

output "artifact_registry" {
  description = "Docker repository path for image tags."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "workload_identity_provider" {
  description = "Value for google-github-actions/auth `workload_identity_provider`."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_accounts" {
  description = "Value for google-github-actions/auth `service_account`, per environment."
  value       = { for k, sa in google_service_account.deployer : k => sa.email }
}

output "secret_ids" {
  description = "Secrets the owner must fill in before the first full apply."
  value       = sort([for s in google_secret_manager_secret.app : s.secret_id])
}

output "domain_dns_records" {
  description = "DNS records to create at Cloudflare (DNS only, not proxied) for each custom domain."
  value       = { for k, m in google_cloud_run_domain_mapping.app : k => try(m.status[0].resource_records, []) }
}
