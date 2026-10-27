"""Short Markdown summary of a Terraform plan for the GitHub job page (infra.yml).

Reads `terraform show -json <plan>` on stdin and prints one line per resource that changes:
addresses and actions only, never values. Deletions are marked so they stand out on a phone.
"""

import json
import sys


def main() -> None:
    plan = json.load(sys.stdin)
    rows = [
        (change["address"], "/".join(change["change"]["actions"]))
        for change in plan.get("resource_changes", [])
        if change["change"]["actions"] not in (["no-op"], ["read"])
    ]
    print("### Terraform plan\n")
    if not rows:
        print("No changes.")
    for address, action in rows:
        mark = "⚠️ " if "delete" in action else ""
        print(f"- {mark}`{action}` {address}")


if __name__ == "__main__":
    main()
