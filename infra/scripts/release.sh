#!/usr/bin/env bash
# Releases an image that is already in ECR to both functions (plan M8 R3, R4; deploy.yml):
#   1. worker: new image → new version, then `migrate` runs on that version (before any
#      new code serves traffic, so a failed migration stops the release with nothing changed)
#   2. web: new image → new version
#   3. both `live` aliases move to the new versions (one call each)
# Prints the versions so a rollback can point `live` back (infra/README.md, "Rollback").
#
# Usage: release.sh <image-uri>
set -euo pipefail

IMAGE="${1:?usage: release.sh <image-uri>}"
REGION="${AWS_REGION:-ap-southeast-2}"
WEB="supportpilot-web"
WORKER="supportpilot-worker"
ALIAS="live"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

lambda() { aws lambda --region "$REGION" "$@"; }

# Publish a version that runs IMAGE and wait until it can be invoked.
publish() { # function → prints the version number
  local fn="$1" version
  version="$(lambda update-function-code --function-name "$fn" --image-uri "$IMAGE" --publish \
    --query Version --output text)"
  lambda wait published-version-active --function-name "$fn" --qualifier "$version"
  printf '%s' "$version"
}

current() { lambda get-alias --function-name "$1" --name "$ALIAS" --query FunctionVersion --output text; }

echo "== Previous live versions: web $(current "$WEB"), worker $(current "$WORKER")"

echo "== Worker"
worker_version="$(publish "$WORKER")"
echo "   version ${worker_version}"
"$HERE/run-task.sh" migrate "$worker_version"

echo "== Web"
web_version="$(publish "$WEB")"
echo "   version ${web_version}"

echo "== Go live"
lambda update-alias --function-name "$WORKER" --name "$ALIAS" --function-version "$worker_version" >/dev/null
lambda update-alias --function-name "$WEB" --name "$ALIAS" --function-version "$web_version" >/dev/null
echo "   live: web ${web_version}, worker ${worker_version}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "web_version=${web_version}"
    echo "worker_version=${worker_version}"
  } >> "$GITHUB_OUTPUT"
fi
