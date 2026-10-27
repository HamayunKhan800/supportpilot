provider "aws" {
  region = var.region

  # Refuse to run against any other account, e.g. a stray profile on a laptop.
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      app        = "supportpilot"
      env        = "production"
      managed-by = "terraform"
      repository = var.github_repository
    }
  }
}
