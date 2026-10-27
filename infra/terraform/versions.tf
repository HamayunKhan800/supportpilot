terraform {
  # Validated with 1.17.0 (2026-10-27). 1.11 is the first release with S3 native state
  # locking (`use_lockfile`) out of preview.
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }

  # State lives in a versioned S3 bucket made by infra/bootstrap/bootstrap.sh. The bucket
  # name contains the account ID, so it is passed at init time:
  #   terraform init -backend-config="bucket=supportpilot-tfstate-<account-id>"
  # S3 native locking writes a .tflock object next to the state; no DynamoDB table.
  backend "s3" {
    key          = "supportpilot/production.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
