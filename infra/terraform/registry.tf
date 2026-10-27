resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "supportpilot"
  description   = "SupportPilot container images, pushed by GitHub Actions."
  format        = "DOCKER"

  docker_config {
    # A tag such as sha-<commit> always points at the same image.
    immutable_tags = true
  }

  # Keep storage inside the free 0.5 GB (plan M8 D11): the 3 newest images stay,
  # so the previous two releases remain available for rollback.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-newest-3"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-older"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "86400s"
    }
  }

  depends_on = [google_project_service.this]
}
