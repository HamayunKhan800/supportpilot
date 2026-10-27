#!/usr/bin/env bash
# Prints the image tag Terraform should be given (variable image_tag), for infra.yml:
#   - the web function exists     → the tag it runs now (Terraform ignores image changes
#                                   after the first create, so this changes nothing)
#   - no function, but an image   → the newest image in ECR (creates the functions)
#   - neither                     → nothing (first apply: registry and roles only)
# Fails, rather than printing nothing, on any other error: an empty answer while the
# functions exist would plan to delete them.
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
FUNCTION="supportpilot-web"
REPOSITORY="supportpilot"

err="$(mktemp)"
trap 'rm -f "$err"' EXIT

if uri="$(aws lambda get-function --region "$REGION" --function-name "$FUNCTION" \
  --query 'Code.ImageUri' --output text 2>"$err")"; then
  tag="${uri##*:}"
elif grep -q ResourceNotFoundException "$err"; then
  if tag="$(aws ecr describe-images --region "$REGION" --repository-name "$REPOSITORY" \
    --filter tagStatus=TAGGED --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' \
    --output text 2>"$err")"; then
    [[ "$tag" == "None" ]] && tag=""
  elif grep -q RepositoryNotFoundException "$err"; then
    tag=""
  else
    cat "$err" >&2
    exit 1
  fi
else
  cat "$err" >&2
  exit 1
fi

if [[ -n "$tag" && ! "$tag" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
  echo "Unexpected image tag: $tag" >&2
  exit 1
fi
printf '%s\n' "$tag"
