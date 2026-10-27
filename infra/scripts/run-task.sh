#!/usr/bin/env bash
# Runs one worker task synchronously and fails unless it reports ok (deploy.yml, release.sh).
#   run-task.sh migrate <version>     before a release, on the new version
#   run-task.sh seed-reset            on the live alias: rebuild the demo workspace
# The worker answers with {"task":…,"ok":…,"steps":[…]}; a failed task is also a Lambda error
# (AWS_LWA_ERROR_STATUS_CODES), so either signal stops the job.
set -euo pipefail

TASK="${1:?usage: run-task.sh migrate|seed-reset|drain [qualifier]}"
QUALIFIER="${2:-live}"
REGION="${AWS_REGION:-ap-southeast-2}"
WORKER="supportpilot-worker"

case "$TASK" in migrate | seed-reset | drain) ;; *) echo "Unknown task: $TASK" >&2; exit 2 ;; esac

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

started=$SECONDS
error="$(aws lambda invoke --region "$REGION" --function-name "$WORKER" --qualifier "$QUALIFIER" \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 900 \
  --payload "{\"task\":\"${TASK}\"}" --query FunctionError --output text "$out")"
echo "   ${TASK} on ${WORKER}:${QUALIFIER} ($((SECONDS - started)) s): $(cat "$out")"
if [[ "$error" != "None" ]] || ! grep -q '"ok":true' "$out"; then
  echo "::error::${TASK} failed on ${WORKER}:${QUALIFIER}" >&2
  exit 1
fi
