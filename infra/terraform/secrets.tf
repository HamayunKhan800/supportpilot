# Terraform creates empty secrets only. The owner adds each value with
#   printf '%s' "$VALUE" | gcloud secrets versions add <id> --data-file=-
# so secret values never enter the Terraform state file (plan M8 D9).

locals {
  required_secrets = ["DATABASE_URL", "BETTER_AUTH_SECRET", "DEMO_PASSWORD"]

  # "<env>/<NAME>" => { env, name, id }
  secrets = merge([
    for env, e in var.environments : {
      for name in distinct(concat(local.required_secrets, e.optional_secrets)) :
      "${env}/${name}" => {
        env  = env
        name = name
        id   = "${env}-${replace(lower(name), "_", "-")}"
      }
    }
  ]...)
}

resource "google_secret_manager_secret" "app" {
  for_each = local.secrets

  secret_id = each.value.id
  labels = {
    environment = each.value.env
  }

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

# Each runtime identity can read only the secrets of its own environment.
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = local.secrets

  secret_id = google_secret_manager_secret.app[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.env].email}"
}
