#!/usr/bin/env bash
# Gives GitHub Actions its AWS access (plan M8 R7, as changed on 2026-10-27). Run in AWS
# CloudShell after bootstrap.sh:
#
#   bash supportpilot/infra/bootstrap/github-keys.sh
#
# For each protected GitHub environment it makes a new access key for that environment's
# IAM user and stores it straight into the environment's secrets, so the key is never shown:
#   infra       → supportpilot-github-infra   (may only assume supportpilot-infra)
#   production  → supportpilot-github-deploy  (may only assume supportpilot-deploy)
# It also sets the repository variable AWS_ACCOUNT_ID.
#
# It asks for a GitHub fine-grained token for this repository with "Environments" and
# "Variables" read and write (typed hidden, used only here).
#
# Run it again to rotate the keys: the new key is stored first, then the old one is deleted.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYNACL="pynacl==1.6.2"

ok() { printf '   ok: %s\n' "$*"; }

command -v aws >/dev/null || { echo "Run this in AWS CloudShell." >&2; exit 1; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT" =~ ^[0-9]{12}$ ]] || { echo "Could not read the account ID." >&2; exit 1; }

# GitHub only accepts secrets encrypted for the repository (libsodium sealed box).
if ! python3 -c 'import nacl' 2>/dev/null; then
  echo "== Installing ${PYNACL} (encrypts the keys for GitHub)"
  pip3 install --user --quiet --disable-pip-version-check "$PYNACL"
fi

printf '\n== GitHub\n'
read -rsp "Paste the GitHub token (hidden), then Enter: " GH_TOKEN
echo
export GH_TOKEN
python3 "$HERE/gh_secret.py" check

for pair in infra:infra production:deploy; do
  environment="${pair%%:*}"
  user="supportpilot-github-${pair#*:}"
  printf '\n== %s → %s\n' "$user" "$environment"
  aws iam get-user --user-name "$user" >/dev/null 2>&1 || { echo "Run bootstrap.sh first: $user is missing." >&2; exit 1; }

  # IAM allows two keys per user. If two exist, the older one is from an earlier rotation
  # that never finished, so it is the one to drop.
  # shellcheck disable=SC2016 # backticks are JMESPath literals, not shell
  old="$(aws iam list-access-keys --user-name "$user" \
    --query 'sort_by(AccessKeyMetadata, &CreateDate)[].AccessKeyId' --output text)"
  if [[ "$(wc -w <<<"$old")" -ge 2 ]]; then
    oldest="$(awk '{print $1}' <<<"$old")"
    aws iam delete-access-key --user-name "$user" --access-key-id "$oldest"
    old="$(awk '{print $2}' <<<"$old")"
  fi

  read -r key_id key_secret < <(aws iam create-access-key --user-name "$user" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  [[ -n "${key_id:-}" && -n "${key_secret:-}" ]] || { echo "Could not create an access key." >&2; exit 1; }

  if ! SECRET_VALUE="$key_id" python3 "$HERE/gh_secret.py" secret "$environment" AWS_ACCESS_KEY_ID ||
    ! SECRET_VALUE="$key_secret" python3 "$HERE/gh_secret.py" secret "$environment" AWS_SECRET_ACCESS_KEY; then
    # The old key stays valid in AWS. If only the second secret failed, GitHub now holds a
    # mismatched pair, so the environment works again only after a successful run.
    aws iam delete-access-key --user-name "$user" --access-key-id "$key_id"
    echo "Storing the key in GitHub failed; the new key was deleted. Run this script again." >&2
    exit 1
  fi
  unset key_secret
  for key in $old; do
    aws iam delete-access-key --user-name "$user" --access-key-id "$key"
  done
  ok "new key stored in GitHub${old:+, old key deleted}"
done

printf '\n== Repository variable\n'
VARIABLE_VALUE="$ACCOUNT" python3 "$HERE/gh_secret.py" variable AWS_ACCOUNT_ID
unset GH_TOKEN

printf '\n== Done. GitHub can now reach AWS, after your approval.\n'
