#!/usr/bin/env bash
# One-time AWS setup for SupportPilot (plan M8 R7, R8, R11). Run it in AWS CloudShell,
# signed in as the account owner:
#
#   git clone --depth 1 https://github.com/HamayunKhan800/supportpilot.git
#   bash supportpilot/infra/bootstrap/bootstrap.sh
#
# It makes the few things Terraform itself needs before it can run, plus the budget alert:
#   1. S3 bucket for Terraform state (versioned, private, TLS only)
#   2. Two IAM users for GitHub Actions, one per protected environment, each allowed only to
#      assume its role (github-keys.sh makes their keys and stores them in GitHub)
#   3. supportpilot-boundary: the most any role Terraform creates may ever do
#   4. supportpilot-infra: the role GitHub's protected "infra" environment uses for Terraform
#   5. AWS Budgets email alert at $5 a month (your email stays out of GitHub)
#
# Safe to run again: each step checks what exists and only fills the gaps or refreshes
# policies to the versions in this folder.

set -euo pipefail

REGION="ap-southeast-2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUDGET_NAME="supportpilot-monthly"
BUDGET_USD="5"

# IAM is eventually consistent: a user created a moment ago can be refused as a trust
# principal ("Invalid principal in policy") for a few seconds. Retry such calls briefly.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    "$@" && return 0
    [[ $attempt -lt 6 ]] && { echo "   (IAM not ready yet, retrying in 5 s)" >&2; sleep 5; }
  done
  return 1
}
say() { printf '\n== %s\n' "$*"; }
ok() { printf '   ok: %s\n' "$*"; }

command -v aws >/dev/null || { echo "The AWS CLI is missing. Run this in AWS CloudShell." >&2; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT" =~ ^[0-9]{12}$ ]] || { echo "Could not read the account ID." >&2; exit 1; }
BUCKET="supportpilot-tfstate-${ACCOUNT}"
BOUNDARY_ARN="arn:aws:iam::${ACCOUNT}:policy/supportpilot-boundary"

# Fill the {{ACCOUNT_ID}} and {{REGION}} placeholders of a policy file in this folder.
render() { sed -e "s/{{ACCOUNT_ID}}/${ACCOUNT}/g" -e "s/{{REGION}}/${REGION}/g" "${HERE}/$1"; }

# Budget email first, so the rest runs without stopping. Not stored anywhere but AWS Budgets.
if ! aws budgets describe-budget --account-id "$ACCOUNT" --budget-name "$BUDGET_NAME" >/dev/null 2>&1; then
  EMAIL="${BUDGET_EMAIL:-}"
  if [[ -z "$EMAIL" ]]; then read -r -p "Email for the \$${BUDGET_USD} budget alert: " EMAIL; fi
  [[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "That doesn't look like an email address." >&2; exit 1; }
fi

say "1/5 Terraform state bucket"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  ok "$BUCKET exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  ok "created $BUCKET"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
# Old state versions are kept 90 days (enough to recover from a bad apply), then removed.
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"old-state-versions","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":90},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"TlsOnly\", \"Effect\": \"Deny\", \"Principal\": \"*\", \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::${BUCKET}\", \"arn:aws:s3:::${BUCKET}/*\"],
    \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
  }]
}"
ok "private, versioned, encrypted, TLS only"

say "2/5 GitHub Actions users"
# Accounts made with the new AWS sign-up deny OIDC identity providers by organization policy
# (DenyIAMRestrictedActions: iam:*Provider*), so GitHub signs in with an access key per
# environment instead. Each user may only assume its one role; the roles do the work.
for kind in infra deploy; do
  user="supportpilot-github-${kind}"
  if aws iam get-user --user-name "$user" >/dev/null 2>&1; then
    ok "$user exists"
  else
    aws iam create-user --user-name "$user" --path /supportpilot/ >/dev/null
    ok "created $user"
  fi
  aws iam put-user-policy --user-name "$user" --policy-name assume-role-only \
    --policy-document "$(render "github-${kind}-user-policy.json")"
done
ok "each may only assume its role"

say "3/5 Permissions boundary (supportpilot-boundary)"
if aws iam get-policy --policy-arn "$BOUNDARY_ARN" >/dev/null 2>&1; then
  # Keep at most 5 versions (the IAM limit): drop the oldest non-default one first.
  # shellcheck disable=SC2016 # backticks are JMESPath literals, not shell
  versions="$(aws iam list-policy-versions --policy-arn "$BOUNDARY_ARN" \
    --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text)"
  if [[ "$(wc -w <<<"$versions")" -ge 4 ]]; then
    oldest="$(tr '\t' '\n' <<<"$versions" | sort -t v -k2 -n | head -1)"
    aws iam delete-policy-version --policy-arn "$BOUNDARY_ARN" --version-id "$oldest"
  fi
  aws iam create-policy-version --policy-arn "$BOUNDARY_ARN" --set-as-default \
    --policy-document "$(render boundary-policy.json)" >/dev/null
  ok "refreshed"
else
  aws iam create-policy --policy-name supportpilot-boundary \
    --description "Most that any SupportPilot role made by Terraform may do" \
    --policy-document "$(render boundary-policy.json)" >/dev/null
  ok "created"
fi

say "4/5 Terraform role (supportpilot-infra)"
if aws iam get-role --role-name supportpilot-infra >/dev/null 2>&1; then
  retry aws iam update-assume-role-policy --role-name supportpilot-infra \
    --policy-document "$(render infra-role-trust.json)"
  ok "exists; trust refreshed"
else
  retry aws iam create-role --role-name supportpilot-infra \
    --description "Terraform from the protected GitHub environment infra, via its IAM user (HamayunKhan800/supportpilot)" \
    --assume-role-policy-document "$(render infra-role-trust.json)" \
    --max-session-duration 3600 >/dev/null
  ok "created"
fi
aws iam put-role-policy --role-name supportpilot-infra --policy-name terraform \
  --policy-document "$(render infra-role-policy.json)"
ok "permissions set"

say "5/5 Budget alert"
if [[ -z "${EMAIL:-}" ]]; then
  ok "$BUDGET_NAME exists (unchanged)"
else
  # Credits are left out: on the Free plan the $100 credit pays the bill, so a budget that
  # counted credits would never warn. This one warns on real usage.
  notify() {
    printf '{"Notification":{"NotificationType":"%s","ComparisonOperator":"GREATER_THAN","Threshold":%s,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"%s"}]}' "$1" "$2" "$EMAIL"
  }
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget "{\"BudgetName\":\"${BUDGET_NAME}\",\"BudgetLimit\":{\"Amount\":\"${BUDGET_USD}\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\",\"CostTypes\":{\"IncludeCredit\":false,\"IncludeRefund\":false}}" \
    --notifications-with-subscribers "[$(notify ACTUAL 50),$(notify ACTUAL 100),$(notify FORECASTED 100)]"
  ok "created: email at 50% and 100% of \$${BUDGET_USD}, and when the month is forecast to pass it"
fi

say "Done. AWS account ID: ${ACCOUNT}"
echo "   Next: bash supportpilot/infra/bootstrap/github-keys.sh"
