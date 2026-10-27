locals {
  # Plain (non-secret) settings shared by the service and the seed job.
  # Per-environment `env` values in terraform.tfvars override these.
  app_env = {
    for k, e in var.environments : k => merge({
      NODE_ENV            = "production"
      BETTER_AUTH_URL     = local.public_url[k]
      AI_PROVIDER         = e.ai_provider
      LOG_LEVEL           = "info"
      SENTRY_ENVIRONMENT  = k
      TRUST_PROXY_HEADERS = "true"
      # Web and worker each hold a pool; 2 instances x 2 processes x 5 stays far below Neon's limit.
      DATABASE_POOL_MAX = "5"
      # Cloud Run sends SIGTERM and allows 10 s before SIGKILL (scripts/start-container.ts).
      WORKER_SHUTDOWN_TIMEOUT_MS = "8000"
      LAUNCHER_GRACE_MS          = "9000"
    }, e.env)
  }

  app_secrets = {
    for k, e in var.environments :
    k => distinct(concat(local.required_secrets, e.optional_secrets))
  }
}

resource "google_cloud_run_v2_service" "app" {
  for_each = var.environments

  name                = each.value.service_name
  location            = var.region
  description         = "SupportPilot ${each.key}: Next.js web server plus pg-boss worker in one container (ADR-0008)."
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = each.value.deletion_protection

  # Public site: no IAM check on requests (avoids an allUsers binding).
  invoker_iam_disabled = true

  template {
    service_account                  = google_service_account.runtime[each.key].email
    timeout                          = "300s"
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      image   = var.image
      command = ["node"]
      args    = [".build/start.mjs"]

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        # Instance-based billing: the CPU stays on between requests so the worker keeps
        # running (plan M8 D2). Covered by the instance free tier.
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.app_env[each.key]
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(local.app_secrets[each.key])
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["${each.key}/${env.value}"].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 3000
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        timeout_seconds       = 2
        failure_threshold     = 20
      }
    }
  }

  lifecycle {
    # GitHub Actions deploys new images (plan M8 step 5); Terraform owns everything else.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# Database migrations run as a job before each release (plan M8 D8).
resource "google_cloud_run_v2_job" "migrate" {
  for_each = var.environments

  name                = "${each.value.service_name}-migrate"
  location            = var.region
  deletion_protection = each.value.deletion_protection

  template {
    task_count = 1

    template {
      service_account = google_service_account.runtime[each.key].email
      timeout         = "300s"
      # A failed migration must stop the release, not be retried blindly.
      max_retries = 0

      containers {
        image   = var.image
        command = ["node"]
        args    = [".build/migrate.mjs"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["${each.key}/DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# Seeds the public demo workspace and, with --reset, restores it to the original
# data. Run by GitHub Actions just after Pacific midnight, when Gemini quotas reset.
resource "google_cloud_run_v2_job" "seed_demo" {
  for_each = var.environments

  name                = "${each.value.service_name}-seed-demo"
  location            = var.region
  deletion_protection = each.value.deletion_protection

  template {
    task_count = 1

    template {
      service_account = google_service_account.runtime[each.key].email
      timeout         = "600s"
      max_retries     = 0

      containers {
        image   = var.image
        command = ["node"]
        args    = [".build/seed-demo.mjs", "--reset"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = merge(local.app_env[each.key], { ALLOW_DEMO_SEED = "true" })
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = toset(local.app_secrets[each.key])
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app["${each.key}/${env.value}"].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# Custom domain (plan M8 D5, accepted risk AR-009). Only for environments with a domain.
# The domain must first be verified in Google Search Console by the account running Terraform.
resource "google_cloud_run_domain_mapping" "app" {
  for_each = { for k, e in var.environments : k => e if e.custom_domain != null }

  name     = each.value.custom_domain
  location = var.region

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app[each.key].name
  }
}
