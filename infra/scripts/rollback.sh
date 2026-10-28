#!/usr/bin/env bash
# Rolls both functions back to the versions that were live before the last release (plan M8
# step 5; rollback.yml): swaps each function's `live` and `previous` aliases. Running it again
# swaps them back, which rolls forward. Web moves first, so visitors get the old code first;
# the worker follows. Migrations are additive (project rule), so older code works with the
# newer schema. Afterwards, fix forward before applying infrastructure changes: a Terraform
# change to a function moves `live` to a fresh version (infra/README.md, "Rollback").
#
# Usage: rollback.sh
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
FUNCTIONS=("supportpilot-web" "supportpilot-worker")

lambda() { aws lambda --region "$REGION" "$@"; }
version_of() { lambda get-alias --function-name "$1" --name "$2" --query FunctionVersion --output text; }

# Both functions move together, so web and worker always run code from the same release.
declare -A live previous
for fn in "${FUNCTIONS[@]}"; do
  live[$fn]="$(version_of "$fn" live)"
  previous[$fn]="$(version_of "$fn" previous)"
  echo "== ${fn}: live ${live[$fn]}, previous ${previous[$fn]}"
  if [[ "${live[$fn]}" == "${previous[$fn]}" ]]; then
    echo "::error::Nothing to roll back to on ${fn}: 'previous' is its live version (no release recorded since). Nothing changed." >&2
    exit 1
  fi
done

for fn in "${FUNCTIONS[@]}"; do
  lambda update-alias --function-name "$fn" --name live --function-version "${previous[$fn]}" >/dev/null
  lambda update-alias --function-name "$fn" --name previous --function-version "${live[$fn]}" >/dev/null
  echo "   ${fn}: live is now ${previous[$fn]} (was ${live[$fn]})"
done

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "web_version=${previous[supportpilot-web]}"
    echo "worker_version=${previous[supportpilot-worker]}"
  } >> "$GITHUB_OUTPUT"
fi
