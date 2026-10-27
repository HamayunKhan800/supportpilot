terraform {
  # Validated with 1.17.0 (2026-10-25). 1.7+ is needed for `terraform test` with mocks;
  # the configuration itself uses nothing newer, so older Cloud Shell images also work.
  required_version = ">= 1.7.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.8"
    }
  }

  # State lives in a versioned Cloud Storage bucket created by infra/scripts/bootstrap.sh.
  # The bucket name is passed at init time:
  #   terraform init -backend-config="bucket=<project-id>-tfstate"
  backend "gcs" {
    prefix = "supportpilot"
  }
}
