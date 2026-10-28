#!/usr/bin/env bash
# Puts the app's secrets into SSM Parameter Store (plan M8 R6). Run in AWS CloudShell after
# bootstrap.sh:
#
#   bash supportpilot/infra/bootstrap/secrets.sh
#
# Asks for:
#   - the Neon connection string (Neon console → Connect; either the pooled or direct one),
#   - optionally the Gemini API key (Enter skips; the app starts with mock AI).
# Generates what nobody needs to type: BETTER_AUTH_SECRET and the shared demo password.
# Also sets the database role's 10-second statement timeout (Neon ignores it as a
# connection setting), which needs psql (pre-installed in CloudShell).
#
# Typed values are hidden and never printed or saved to the shell history. Safe to run
# again: the Neon string and Gemini key are replaced when given; generated values are kept.

set -euo pipefail

REGION="ap-southeast-2"
ROOT="/supportpilot/production"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v aws >/dev/null || { echo "Run this in AWS CloudShell." >&2; exit 1; }

put() { # name value
  aws ssm put-parameter --region "$REGION" --type SecureString --overwrite \
    --name "${ROOT}/$1" --value "$2" >/dev/null
  printf '   saved %s\n' "$1"
}
exists() {
  aws ssm get-parameter --region "$REGION" --name "${ROOT}/$1" --query Parameter.Name --output text >/dev/null 2>&1
}
random() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }

printf '\n== Database (Neon)\n'
read -rsp "Paste the Neon connection string (hidden), then Enter: " neon
echo
pooled="$(python3 "$HERE/neon_url.py" pooled <<<"$neon")"
direct="$(python3 "$HERE/neon_url.py" direct <<<"$neon")"
role="$(python3 "$HERE/neon_url.py" role <<<"$neon")"
unset neon
put web/DATABASE_URL "$pooled"
put worker/DATABASE_URL "$direct"
unset pooled

# psql checks the server certificate against the system CA bundle (Amazon Linux path);
# the app does the same with Node's built-in list.
ca="/etc/pki/tls/certs/ca-bundle.crt"
[[ -f "$ca" ]] || ca="system"
if command -v psql >/dev/null; then
  PGCONNECT_TIMEOUT=30 psql "${direct}&sslrootcert=${ca}" -v ON_ERROR_STOP=1 -qAt -v role="$role" <<'SQL'
ALTER ROLE :"role" SET statement_timeout = '10s';
SELECT '   database role: statement_timeout ' || coalesce(
  (SELECT split_part(c, '=', 2) FROM pg_roles r, unnest(r.rolconfig) c
   WHERE r.rolname = current_user AND c LIKE 'statement_timeout=%'), 'not set');
SQL
else
  echo "   psql not found: run in the Neon SQL Editor: ALTER ROLE ${role} SET statement_timeout = '10s';"
fi
unset direct

printf '\n== Generated secrets\n'
if exists web/BETTER_AUTH_SECRET; then echo "   kept web/BETTER_AUTH_SECRET"; else put web/BETTER_AUTH_SECRET "$(random 48)"; fi
# Every visitor signs in to the demo with this one password, so it is shown on purpose.
# The demo accounts can't change anything that would affect other visitors (plan M8 step 2).
if exists shared/DEMO_PASSWORD; then
  echo "   kept shared/DEMO_PASSWORD"
else
  demo="nimbus-demo-$(random 9)"
  put shared/DEMO_PASSWORD "$demo"
fi
demo="$(aws ssm get-parameter --region "$REGION" --with-decryption --name "${ROOT}/shared/DEMO_PASSWORD" --query Parameter.Value --output text)"

printf '\n== Gemini (optional, Enter skips)\n'
# Cleans the paste and saves the key only if Google accepts it (gemini_key.py).
python3 "${HERE}/gemini_key.py" || echo "   Gemini key not saved: rerun python3 ${HERE}/gemini_key.py when ready"

printf '\n== Done\n'
echo "   Demo password (public, for the demo accounts): ${demo}"
