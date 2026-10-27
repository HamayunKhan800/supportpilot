# Offline checks of the configuration's logic: `terraform test` with a mocked
# Google provider, so no credentials or cloud calls are needed (runs in CI).

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}

override_resource {
  target = google_service_account.runtime["production"]
  values = {
    email = "supportpilot-run@supportpilot-test.iam.gserviceaccount.com"
    name  = "projects/supportpilot-test/serviceAccounts/supportpilot-run@supportpilot-test.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["staging"]
  values = {
    email = "supportpilot-staging-run@supportpilot-test.iam.gserviceaccount.com"
    name  = "projects/supportpilot-test/serviceAccounts/supportpilot-staging-run@supportpilot-test.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.deployer["production"]
  values = {
    email = "supportpilot-deploy@supportpilot-test.iam.gserviceaccount.com"
    name  = "projects/supportpilot-test/serviceAccounts/supportpilot-deploy@supportpilot-test.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.deployer["staging"]
  values = {
    email = "supportpilot-staging-deploy@supportpilot-test.iam.gserviceaccount.com"
    name  = "projects/supportpilot-test/serviceAccounts/supportpilot-staging-deploy@supportpilot-test.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_iam_workload_identity_pool.github
  values = {
    name = "projects/123456789012/locations/global/workloadIdentityPools/github"
  }
}

variables {
  project_id         = "supportpilot-test"
  billing_account_id = "000000-000000-000000"
  image              = "europe-west1-docker.pkg.dev/supportpilot-test/supportpilot/app:sha-test"

  environments = {
    production = {
      service_name     = "supportpilot"
      custom_domain    = "app.example.com"
      ai_provider      = "gemini"
      env              = { DEMO_EMAIL_DOMAIN = "demo.example.com" }
      optional_secrets = ["GEMINI_API_KEY", "SENTRY_DSN"]
    }
    staging = {
      service_name        = "supportpilot-staging"
      ai_provider         = "mock"
      max_instances       = 1
      deletion_protection = false
    }
  }
}

# With a mocked provider, "apply" creates nothing real; it only fills computed values.
run "environments_are_isolated" {
  command = apply

  assert {
    condition     = local.public_url.production == "https://app.example.com"
    error_message = "Production must use its custom domain as BETTER_AUTH_URL."
  }

  assert {
    condition     = local.public_url.staging == "https://supportpilot-staging-123456789012.europe-west1.run.app"
    error_message = "Staging must use its deterministic run.app address."
  }

  assert {
    condition     = length(google_secret_manager_secret.app) == 8
    error_message = "Expected 5 production secrets and 3 staging secrets."
  }

  assert {
    condition     = google_secret_manager_secret.app["production/GEMINI_API_KEY"].secret_id == "production-gemini-api-key"
    error_message = "Secret IDs must be <env>-<kebab-name>."
  }

  assert {
    condition     = !contains(keys(google_secret_manager_secret.app), "staging/GEMINI_API_KEY")
    error_message = "Staging (mock AI) must not get a Gemini key."
  }

  assert {
    condition = alltrue([
      for k, m in google_secret_manager_secret_iam_member.runtime :
      m.member == "serviceAccount:${google_service_account.runtime[split("/", k)[0]].email}"
    ])
    error_message = "Each secret must be readable only by its own environment's runtime identity."
  }

  assert {
    condition     = length(google_cloud_run_domain_mapping.app) == 1 && google_cloud_run_domain_mapping.app["production"].name == "app.example.com"
    error_message = "Only environments with a custom domain get a domain mapping."
  }

  assert {
    condition     = google_cloud_run_v2_service.app["staging"].template[0].scaling[0].max_instance_count == 1
    error_message = "Per-environment max_instances must reach the service."
  }

  assert {
    condition     = google_cloud_run_v2_service.app["production"].template[0].containers[0].resources[0].cpu_idle == false
    error_message = "Instance-based billing (cpu_idle = false) keeps the worker running."
  }

  assert {
    condition     = google_cloud_run_v2_service.app["production"].invoker_iam_disabled
    error_message = "The public site must not require IAM on requests."
  }

  assert {
    condition     = google_artifact_registry_repository_iam_member.deployer["production"].role == "roles/artifactregistry.reader"
    error_message = "The production deployer must not push images."
  }

  assert {
    condition     = endswith(google_service_account_iam_member.deployer_wif["production"].member, "/subject/repo:HamayunKhan800/supportpilot:environment:production")
    error_message = "Only the protected production environment may act as the production deployer."
  }

  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository_id == '1428261530'")
    error_message = "The WIF provider must pin the numeric repository ID."
  }

  assert {
    condition     = contains(google_cloud_run_v2_job.seed_demo["staging"].template[0].template[0].containers[0].env[*].name, "ALLOW_DEMO_SEED")
    error_message = "The seed job must opt in with ALLOW_DEMO_SEED."
  }

  assert {
    condition     = !contains(google_cloud_run_v2_service.app["production"].template[0].containers[0].env[*].name, "ALLOW_DEMO_SEED")
    error_message = "The web service must never have ALLOW_DEMO_SEED."
  }
}

run "gemini_needs_a_key" {
  command = plan

  variables {
    environments = {
      production = {
        service_name = "supportpilot"
        ai_provider  = "gemini"
      }
    }
  }

  expect_failures = [var.environments]
}

run "unknown_secret_is_rejected" {
  command = plan

  variables {
    environments = {
      staging = {
        service_name     = "supportpilot-staging"
        ai_provider      = "mock"
        optional_secrets = ["AWS_SECRET"]
      }
    }
  }

  expect_failures = [var.environments]
}
