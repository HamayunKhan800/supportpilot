"""Turn one Neon connection string into the two the app needs (used by secrets.sh).

Neon shows a string like
    postgresql://user:pass@ep-name-123456.ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
with "-pooler" after the endpoint ID when connection pooling is on. The web function uses the
pooled address (many short connections through PgBouncer); the worker and migrations use the
direct one (pg-boss and session settings need a real session). Both get
sslmode=verify-full: node-postgres treats "require" as verify-full today but will weaken it in
pg 9 (plan M8, Neon finding).

Usage: python3 neon_url.py pooled|direct|role   (connection string on stdin, result on stdout)
Nothing is printed except the requested value; errors never include the input.
"""

import sys
from urllib.parse import urlsplit, urlunsplit

QUERY = "sslmode=verify-full&channel_binding=require"


def parse(raw: str):
    raw = raw.strip()
    if raw.startswith("psql "):  # Neon can show the string as a psql command
        raw = raw[5:].strip().strip("'\"")
    parts = urlsplit(raw)
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError("not a postgres:// connection string")
    host = parts.hostname or ""
    if not host.endswith(".neon.tech") or not host.startswith("ep-"):
        raise ValueError("not a Neon address (expected ep-….neon.tech)")
    if not parts.username or parts.password is None:
        raise ValueError("the string has no user name or password")
    if not parts.path.strip("/"):
        raise ValueError("the string has no database name")
    return parts, host


def convert(raw: str, kind: str) -> str:
    parts, host = parse(raw)
    if kind == "role":
        return parts.username
    endpoint, rest = host.split(".", 1)
    endpoint = endpoint.removesuffix("-pooler")
    new_host = f"{endpoint}-pooler.{rest}" if kind == "pooled" else f"{endpoint}.{rest}"
    userinfo = parts.netloc.rsplit("@", 1)[0]
    port = f":{parts.port}" if parts.port else ""
    return urlunsplit(("postgresql", f"{userinfo}@{new_host}{port}", parts.path, QUERY, ""))


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("pooled", "direct", "role"):
        sys.exit("usage: neon_url.py pooled|direct|role < connection-string")
    try:
        print(convert(sys.stdin.read(), sys.argv[1]))
    except ValueError as err:
        sys.exit(f"Neon connection string: {err}")
