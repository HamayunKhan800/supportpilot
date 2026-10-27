"""Store GitHub Actions secrets and variables for this repository (used by github-keys.sh).

    python3 gh_secret.py check                     can the token write environment secrets?
    python3 gh_secret.py secret <environment> <NAME>   value from $SECRET_VALUE
    python3 gh_secret.py variable <NAME>               value from $VARIABLE_VALUE

The token comes from $GH_TOKEN: a fine-grained personal access token for this repository
with "Environments" and "Variables" read and write. Values never appear in arguments or
output. Secrets are encrypted for the repository with a libsodium sealed box, as GitHub
requires (https://docs.github.com/en/rest/guides/encrypting-secrets-for-the-rest-api).
"""

from __future__ import annotations  # CloudShell runs Python 3.9

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
REPO = os.environ.get("GITHUB_REPOSITORY", "HamayunKhan800/supportpilot")


class GitHubError(Exception):
    pass


def clean_token(raw: str) -> str:
    """The token as pasted on a phone: drop terminal paste markers, spaces and line breaks.

    GitHub tokens use only letters, digits and underscores, so anything else is noise.
    """
    raw = re.sub(r"\x1b\[20[01]~", "", raw)
    return re.sub(r"[^A-Za-z0-9_]", "", raw)


def describe_token(token: str) -> str:
    """What was received, without revealing it: length and the first few characters."""
    if not token:
        return "nothing was pasted"
    return f"got {len(token)} characters starting with '{token[:4]}'"


def check_token_shape(token: str) -> None:
    if not re.fullmatch(r"(github_pat_[A-Za-z0-9_]{70,}|gh[pousr]_[A-Za-z0-9]{36,})", token):
        raise GitHubError(
            f"that doesn't look like a GitHub token ({describe_token(token)}; "
            "a fine-grained token starts with 'github_pat_' and is about 93 characters). "
            "Copy it again and rerun."
        )


def call(method: str, path: str, body: dict | None = None) -> dict:
    token = clean_token(os.environ.get("GH_TOKEN", ""))
    check_token_shape(token)
    request = urllib.request.Request(
        f"{API}/repos/{REPO}{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        try:
            message = json.loads(err.read()).get("message", "")
        except ValueError:
            message = ""
        needed = err.headers.get("x-accepted-github-permissions", "")
        hint = f" (the token needs: {needed})" if needed else ""
        if err.code == 401:
            hint += f" (the pasted token: {describe_token(token)}; it may be mistyped, expired or revoked)"
        raise GitHubError(f"{method} {path}: HTTP {err.code} {message}{hint}") from None


def seal(public_key_b64: str, value: str) -> str:
    from nacl import encoding, public  # installed by github-keys.sh

    box = public.SealedBox(public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder()))
    return base64.b64encode(box.encrypt(value.encode())).decode()


def put_secret(environment: str, name: str, value: str) -> None:
    key = call("GET", f"/environments/{environment}/secrets/public-key")
    call(
        "PUT",
        f"/environments/{environment}/secrets/{name}",
        {"encrypted_value": seal(key["key"], value), "key_id": key["key_id"]},
    )


def put_variable(name: str, value: str) -> None:
    try:
        call("PATCH", f"/actions/variables/{name}", {"name": name, "value": value})
    except GitHubError as err:
        if "HTTP 404" not in str(err):
            raise
        call("POST", "/actions/variables", {"name": name, "value": value})


def main(argv: list[str]) -> None:
    if argv[:1] == ["check"] and len(argv) == 1:
        for environment in ("infra", "production"):
            call("GET", f"/environments/{environment}/secrets/public-key")
        print("   GitHub token ok")
    elif argv[:1] == ["secret"] and len(argv) == 3:
        value = os.environ.get("SECRET_VALUE", "")
        if not value:
            raise GitHubError("SECRET_VALUE is empty")
        put_secret(argv[1], argv[2], value)
        print(f"   stored secret {argv[2]} in environment {argv[1]}")
    elif argv[:1] == ["variable"] and len(argv) == 2:
        value = os.environ.get("VARIABLE_VALUE", "")
        if not value:
            raise GitHubError("VARIABLE_VALUE is empty")
        put_variable(argv[1], value)
        print(f"   set variable {argv[1]}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except GitHubError as err:
        sys.exit(f"GitHub: {err}")
