#!/usr/bin/env bash
# One-time setup before the first `terraform init`: a private, versioned bucket for
# Terraform state. Safe to run again. Usage: bootstrap.sh <project-id> [region]
set -euo pipefail

PROJECT_ID="${1:?usage: bootstrap.sh <project-id> [region]}"
REGION="${2:-europe-west1}"
BUCKET="gs://${PROJECT_ID}-tfstate"

gcloud services enable storage.googleapis.com --project "$PROJECT_ID"

if gcloud storage buckets describe "$BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "State bucket $BUCKET already exists."
else
  gcloud storage buckets create "$BUCKET" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

# Versioning keeps earlier state files, so a bad apply can be undone.
gcloud storage buckets update "$BUCKET" --versioning

echo "Next: cd infra/terraform && terraform init -backend-config=\"bucket=${PROJECT_ID}-tfstate\""
