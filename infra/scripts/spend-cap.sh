#!/usr/bin/env bash
# Hard monthly spend cap on Cloud Run (plan M8 D11). When the gross, estimated Cloud Run
# cost of the project passes the amount, Google pauses all Cloud Run usage in it until the
# next month or until the cap is lifted. The Terraform Google provider can't manage spend
# caps yet, so this script calls the Cloud Billing Budget API directly, as documented in
# https://docs.cloud.google.com/billing/docs/how-to/budget-api-spend-cap
#
# Usage:
#   spend-cap.sh create <project-id> <billing-account-id> [amount, default 5]
#   spend-cap.sh status <project-id> <billing-account-id>
#   spend-cap.sh lift   <project-id> <billing-account-id>   # reopens the site for the rest of the month
#
# The amount is in the billing account's currency.
set -euo pipefail

ACTION="${1:?usage: spend-cap.sh create|status|lift <project-id> <billing-account-id> [amount]}"
PROJECT_ID="${2:?project id required}"
BILLING_ACCOUNT="${3:?billing account id required}"
AMOUNT="${4:-5}"

DISPLAY_NAME="supportpilot-cloud-run-spend-cap"
CLOUD_RUN_SERVICE_ID="152E-C115-5142" # Cloud Run, from Google's list of eligible services
API="https://billingbudgets.googleapis.com/v1/billingAccounts/${BILLING_ACCOUNT}/budgets"

call() {
  local method="$1" url="$2" body="${3:-}"
  local args=(-sS --fail-with-body -X "$method"
    -H "Authorization: Bearer $(gcloud auth print-access-token)"
    -H "x-goog-user-project: ${PROJECT_ID}"
    -H "Content-Type: application/json; charset=utf-8")
  if [[ -n "$body" ]]; then args+=(-d "$body"); fi
  curl "${args[@]}" "$url"
}

# Prints the resource name of our spend cap budget, or nothing.
find_budget() {
  call GET "${API}?pageSize=100" | python3 -c '
import json, sys
name = sys.argv[1]
for b in json.load(sys.stdin).get("budgets", []):
    if b.get("displayName") == name:
        print(b["name"])
        break
' "$DISPLAY_NAME"
}

case "$ACTION" in
  create)
    if [[ ! "$AMOUNT" =~ ^[0-9]+$ ]]; then
      echo "Amount must be a whole number." >&2
      exit 1
    fi
    if [[ -n "$(find_budget)" ]]; then
      echo "Spend cap budget already exists:"
      exec "$0" status "$PROJECT_ID" "$BILLING_ACCOUNT"
    fi
    PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
    call POST "$API" "$(cat <<JSON
{
  "displayName": "${DISPLAY_NAME}",
  "budgetFilter": {
    "projects": ["projects/${PROJECT_NUMBER}"],
    "services": ["services/${CLOUD_RUN_SERVICE_ID}"],
    "creditTypesTreatment": "EXCLUDE_ALL_CREDITS",
    "calendarPeriod": "MONTH"
  },
  "amount": { "specifiedAmount": { "units": "${AMOUNT}" } },
  "thresholdRules": [
    { "thresholdPercent": 0.5, "spendBasis": "CURRENT_SPEND" },
    { "thresholdPercent": 0.8, "spendBasis": "CURRENT_SPEND" },
    { "thresholdPercent": 1.0, "spendBasis": "CURRENT_SPEND" }
  ],
  "notificationsRule": { "enableProjectLevelRecipients": true },
  "spendCap": { "inputState": "CONFIGURED" }
}
JSON
)"
    echo
    ;;
  status)
    NAME="$(find_budget)"
    [[ -n "$NAME" ]] || { echo "No spend cap budget named ${DISPLAY_NAME}." >&2; exit 1; }
    call GET "https://billingbudgets.googleapis.com/v1/${NAME}" | python3 -c '
import json, sys
b = json.load(sys.stdin)
a = b["amount"]["specifiedAmount"]
print("Budget:", b["name"])
print("Cap:   ", a.get("units", "0"), a.get("currencyCode", ""))
print("State: ", b.get("spendCap", {}).get("outputState", "unknown"))
'
    ;;
  lift)
    NAME="$(find_budget)"
    [[ -n "$NAME" ]] || { echo "No spend cap budget named ${DISPLAY_NAME}." >&2; exit 1; }
    call PATCH "https://billingbudgets.googleapis.com/v1/${NAME}?updateMask=spendCap.inputState" \
      '{ "spendCap": { "inputState": "AWAITING_NEXT_PERIOD" } }' >/dev/null
    echo "Cap lifted for the rest of this month. Cloud Run can take up to an hour to recover."
    ;;
  *)
    echo "Unknown action: $ACTION (use create, status or lift)" >&2
    exit 1
    ;;
esac
