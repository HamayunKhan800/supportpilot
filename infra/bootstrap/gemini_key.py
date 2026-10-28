#!/usr/bin/env python3
"""Store the Gemini API key in SSM, but only after Google accepts it (CloudShell).

    python3 supportpilot/infra/bootstrap/gemini_key.py

Asks for the key (hidden), removes what a phone paste adds (terminal paste markers, line
breaks, spaces, surrounding quotes), then asks Google for one model's details with it. That
call checks the key without using any generation quota. The key is saved only if Google
accepts it; otherwise nothing changes. The key is never printed: only its length and first
three characters.

Why: the first live run stored a pasted key with two stray characters, and every Gemini call
failed with "invalid x-goog-api-key header" (plan M8 change log, 2026-10-28). secrets.sh
uses this for its Gemini step. Python 3.9 compatible (CloudShell); standard library only.
"""

from __future__ import annotations

import getpass
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

REGION = "ap-southeast-2"
PARAMETER = "/supportpilot/production/shared/GEMINI_API_KEY"
API = "https://generativelanguage.googleapis.com/v1beta/models/"
CHECK_MODEL = "gemini-3.5-flash-lite"  # the app's triage model (src/server/modules/ai/config.ts)


def clean_key(raw: str) -> str:
    """The key as pasted on a phone: drop paste markers, control characters, spaces, quotes."""
    raw = re.sub(r"\x1b?\[20[01]~", "", raw)
    kept = "".join(c for c in raw if 32 < ord(c) < 127)
    return kept.strip("'\"")


def describe(key: str) -> str:
    return f"got {len(key)} characters, starting '{key[:3]}'" if key else "nothing was pasted"


def google_check(key: str, api: str = API, timeout: float = 20) -> str | None:
    """None when Google accepts the key, else Google's reason (never the key)."""
    request = urllib.request.Request(api + CHECK_MODEL, headers={"x-goog-api-key": key})
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            return None
    except urllib.error.HTTPError as err:
        try:
            message = json.load(err).get("error", {}).get("message", "")
        except ValueError:
            message = ""
        return f"HTTP {err.code} {message}".strip()
    except (urllib.error.URLError, OSError) as err:
        return f"could not reach Google ({err})"


def save(key: str) -> None:
    subprocess.run(
        ["aws", "ssm", "put-parameter", "--region", REGION, "--name", PARAMETER,
         "--type", "SecureString", "--overwrite", "--value", key],
        check=True, capture_output=True,
    )


def main(api: str = API) -> int:
    key = clean_key(getpass.getpass("Paste the Gemini API key (hidden), then Enter: "))
    print(f"   {describe(key)}")
    if not key:
        print("   skipped: nothing changed")
        return 0
    problem = google_check(key, api)
    if problem:
        print(f"   Google refused it: {problem}")
        print("   NOT saved; nothing changed. Copy the key again (AI Studio > API keys) and rerun.")
        return 1
    save(key)
    print("   Google accepted the key: saved shared/GEMINI_API_KEY")
    return 0


if __name__ == "__main__":
    sys.exit(main())
