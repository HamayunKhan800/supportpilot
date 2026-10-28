#!/usr/bin/env bash
# Releases an image that is already in ECR to both functions (plan M8 R3, R4; deploy.yml):
#   1. worker: new image → new version, then `migrate` runs on that version (before any
#      new code serves traffic, so a failed migration stops the release with nothing changed)
#   2. web: new image → new version
#   3. both `previous` aliases move to the outgoing live versions (the rollback target,
#      infra/scripts/rollback.sh), then both `live` aliases move to the new versions
#
# Usage: release.sh <image-uri>
set -euo pipefail

IMAGE="${1:?usage: release.sh <image-uri>}"
REGION="${AWS_REGION:-ap-southeast-2}"
WEB="supportpilot-web"
WORKER="supportpilot-worker"
ALIAS="live"
PREVIOUS="previous"
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

old_web="$(current "$WEB")"
old_worker="$(current "$WORKER")"
echo "== Previous live versions: web ${old_web}, worker ${old_worker}"

echo "== Worker"
worker_version="$(publish "$WORKER")"
echo "   version ${worker_version}"
"$HERE/run-task.sh" migrate "$worker_version"

echo "== Web"
web_version="$(publish "$WEB")"
echo "   version ${web_version}"

echo "== Go live"
# Mark what is live now as the rollback target. The alias comes from Terraform; until that
# apply has run, the release goes ahead without it.
mark_previous() { # function version
  local out
  if ! out="$(lambda update-alias --function-name "$1" --name "$PREVIOUS" --function-version "$2" 2>&1 >/dev/null)"; then
    if grep -q ResourceNotFoundException <<<"$out"; then
      echo "   no '${PREVIOUS}' alias on $1 yet (run Infrastructure): rollback target not recorded"
      return 0
    fi
    echo "$out" >&2
    return 1
  fi
}
mark_previous "$WORKER" "$old_worker"
mark_previous "$WEB" "$old_web"
echo "   rollback target: web ${old_web}, worker ${old_worker}"
lambda update-alias --function-name "$WORKER" --name "$ALIAS" --function-version "$worker_version" >/dev/null
lambda update-alias --function-name "$WEB" --name "$ALIAS" --function-version "$web_version" >/dev/null
echo "   live: web ${web_version}, worker ${worker_version}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "web_version=${web_version}"
    echo "worker_version=${worker_version}"
  } >> "$GITHUB_OUTPUT"
fi
