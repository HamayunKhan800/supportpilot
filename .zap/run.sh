#!/usr/bin/env bash
# Runs a ZAP scan (M7 step 3) against a THROWAWAY copy of SupportPilot: never a real site.
#
#   ZAP_TARGET=http://localhost:3000 ZAP_CMD="/path/to/zap.sh" .zap/run.sh baseline   # passive
#   ZAP_TARGET=http://localhost:3000 ZAP_CMD="/path/to/zap.sh" .zap/run.sh api        # active
#
# baseline crawls as a visitor and as the demo agent; api attacks every /api/v1 operation as
# the demo admin and writes junk data. Reports land in ZAP_REPORT_DIR (default ./zap-out).
# Needs curl, python3 and node; the demo data must be seeded (pnpm db:seed-demo).
set -euo pipefail

mode="${1:-}"
case "$mode" in
  baseline) user="agent@demo.supportpilot.dev" ;;
  api) user="admin@demo.supportpilot.dev" ;;
  *) echo "usage: .zap/run.sh baseline|api" >&2; exit 2 ;;
esac
: "${ZAP_TARGET:?set ZAP_TARGET, e.g. http://localhost:3000}"
: "${ZAP_CMD:?set ZAP_CMD to zap.sh (or a docker run ... zap.sh command)}"
here="$(cd "$(dirname "$0")" && pwd)"
export ZAP_REPORT_DIR="${ZAP_REPORT_DIR:-$PWD/zap-out}"
mkdir -p "$ZAP_REPORT_DIR"
password="${DEMO_PASSWORD:-nimbus demo passphrase for local only}"

# Sign in, then make the demo workspace active (the app does this on the first /app visit).
body=$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$user" "$password")
cookie=$(curl -fsS -D - -o /dev/null -X POST "$ZAP_TARGET/api/auth/sign-in/email" \
  -H "Origin: $ZAP_TARGET" -H "Content-Type: application/json" --data "$body" |
  tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: \(\(__Secure-\)\{0,1\}better-auth\.session_token=[^;]*\).*/\1/p')
[ -n "$cookie" ] || { echo "sign-in as $user failed" >&2; exit 1; }
curl -fsS -o /dev/null -X POST "$ZAP_TARGET/api/auth/organization/set-active" -H "Cookie: $cookie" \
  -H "Origin: $ZAP_TARGET" -H "Content-Type: application/json" --data '{"organizationSlug":"nimbus-demo"}'
export ZAP_COOKIE="$cookie"

plan="baseline.yaml"
if [ "$mode" = api ]; then
  plan="api-scan.yaml"
  export ZAP_API_FILE="$ZAP_REPORT_DIR/openapi-zap.json"
  node "$here/prepare-api-spec.mjs" "$ZAP_API_FILE"
fi

# ZAP does not expand ${VAR} inside the replacer job, so expand the whole plan here.
expanded="$ZAP_REPORT_DIR/plan-$mode.yaml"
trap 'rm -f "$expanded"' EXIT # it holds the session cookie
python3 -c 'import os,sys; sys.stdout.write(os.path.expandvars(sys.stdin.read()))' <"$here/$plan" >"$expanded"
if grep -q '\${ZAP_' "$expanded"; then echo "unexpanded variable in $expanded" >&2; exit 1; fi

set +e
# shellcheck disable=SC2086 # ZAP_CMD is a command line on purpose
$ZAP_CMD -cmd -autorun "$expanded"
rc=$?
set -e
# exitStatus job: 1 = Low+ alerts left after the reviewed filters, 2 = Informational only.
if [ "$rc" -eq 2 ]; then echo "ZAP: informational alerts only (see report)"; rc=0; fi
exit "$rc"
