provider "google" {
  project = var.project_id
  region  = var.region

  # The Budget API needs a quota project when called with user credentials.
  user_project_override = true
  billing_project       = var.project_id

  default_labels = {
    app        = "supportpilot"
    managed-by = "terraform"
  }
}
