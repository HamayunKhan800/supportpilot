"""Tests for release.sh and rollback.sh against a stand-in AWS CLI (CI infra job; no AWS).

The stand-in keeps each function's published versions and aliases in a JSON file, answers
the handful of `aws lambda` calls the scripts make, and can be told to fail a migration or to
lack the `previous` alias (as before the Terraform apply that creates it).
"""

import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB, WORKER = "supportpilot-web", "supportpilot-worker"
IMAGE = "111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/supportpilot:sha-abc"

FAKE_AWS = textwrap.dedent(
    r'''
    #!/usr/bin/env python3
    import json, os, sys
    path = os.environ["FAKE_AWS_STATE"]
    state = json.load(open(path))
    args = sys.argv[1:]
    def arg(name):
        return args[args.index(name) + 1]
    def save():
        json.dump(state, open(path, "w"))
    state["calls"].append(" ".join(a for a in args if not a.startswith("{")))
    if args[0] != "lambda":
        sys.exit("unexpected service")
    cmd = next(a for a in args if a in ("get-alias", "update-alias", "update-function-code", "wait", "invoke"))
    fn = None
    if "--function-name" in args:
        fn = arg("--function-name")
    f = state["functions"].get(fn)
    if cmd == "get-alias":
        name = arg("--name")
        if name not in f["aliases"]:
            sys.stderr.write("An error occurred (ResourceNotFoundException) when calling the GetAlias operation\n")
            sys.exit(254)
        print(f["aliases"][name])
    elif cmd == "update-alias":
        name = arg("--name")
        if name not in f["aliases"]:
            sys.stderr.write("An error occurred (ResourceNotFoundException) when calling the UpdateAlias operation\n")
            save(); sys.exit(254)
        f["aliases"][name] = arg("--function-version")
        print("{}")
    elif cmd == "update-function-code":
        f["versions"].append(arg("--image-uri"))
        print(len(f["versions"]))
    elif cmd == "wait":
        pass
    elif cmd == "invoke":
        task = json.loads(arg("--payload"))["task"]
        ok = not (task == "migrate" and state.get("fail_migrate"))
        open(args[-1], "w").write(json.dumps({"ok": ok, "task": task}, separators=(",", ":")))
        print("None" if ok else "Unhandled")
    else:
        sys.exit("unexpected command " + cmd)
    save()
    '''
).lstrip()


class ScriptsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        (d / "aws").write_text(FAKE_AWS)
        (d / "aws").chmod(0o755)
        self.state_path = d / "state.json"
        self.env = {**os.environ, "PATH": f"{d}:{os.environ['PATH']}", "FAKE_AWS_STATE": str(self.state_path)}
        self.env.pop("GITHUB_OUTPUT", None)

    def tearDown(self):
        self.dir.cleanup()

    def write_state(self, live, previous, versions=3, **extra):
        functions = {}
        for fn in (WEB, WORKER):
            aliases = {"live": str(live)}
            if previous is not None:
                aliases["previous"] = str(previous)
            functions[fn] = {"versions": ["old"] * versions, "aliases": aliases}
        self.state_path.write_text(json.dumps({"functions": functions, "calls": [], **extra}))

    def state(self):
        return json.loads(self.state_path.read_text())

    def aliases(self, fn):
        return self.state()["functions"][fn]["aliases"]

    def run_script(self, *args):
        return subprocess.run([str(HERE / args[0]), *args[1:]], env=self.env, capture_output=True, text=True)

    def test_release_records_the_outgoing_versions_as_the_rollback_target(self):
        self.write_state(live=3, previous=2)
        result = self.run_script("release.sh", IMAGE)
        self.assertEqual(result.returncode, 0, result.stderr)
        for fn in (WEB, WORKER):
            self.assertEqual(self.aliases(fn), {"live": "4", "previous": "3"})
        self.assertIn("rollback target: web 3, worker 3", result.stdout)

    def test_failed_migration_changes_no_alias(self):
        self.write_state(live=3, previous=2, fail_migrate=True)
        result = self.run_script("release.sh", IMAGE)
        self.assertNotEqual(result.returncode, 0)
        for fn in (WEB, WORKER):
            self.assertEqual(self.aliases(fn), {"live": "3", "previous": "2"})
        self.assertFalse([c for c in self.state()["calls"] if "update-alias" in c])

    def test_release_still_works_before_the_previous_alias_exists(self):
        self.write_state(live=3, previous=None)
        result = self.run_script("release.sh", IMAGE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.aliases(WEB), {"live": "4"})
        self.assertIn("rollback target not recorded", result.stdout)

    def test_rollback_swaps_live_and_previous_and_a_second_run_rolls_forward(self):
        self.write_state(live=4, previous=3)
        first = self.run_script("rollback.sh")
        self.assertEqual(first.returncode, 0, first.stderr)
        for fn in (WEB, WORKER):
            self.assertEqual(self.aliases(fn), {"live": "3", "previous": "4"})
        moves = [c for c in self.state()["calls"] if "update-alias" in c and "--name live" in c]
        self.assertIn(WEB, moves[0])  # visitors get the old code first
        second = self.run_script("rollback.sh")
        self.assertEqual(second.returncode, 0, second.stderr)
        for fn in (WEB, WORKER):
            self.assertEqual(self.aliases(fn), {"live": "4", "previous": "3"})

    def test_rollback_refuses_when_there_is_nothing_to_go_back_to(self):
        self.write_state(live=4, previous=4)
        result = self.run_script("rollback.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Nothing to roll back to", result.stderr)
        self.assertFalse([c for c in self.state()["calls"] if "update-alias" in c])

    def test_rollback_writes_the_versions_for_the_workflow(self):
        self.write_state(live=4, previous=3)
        out = Path(self.dir.name) / "github_output"
        self.env["GITHUB_OUTPUT"] = str(out)
        self.assertEqual(self.run_script("rollback.sh").returncode, 0)
        self.assertEqual(out.read_text(), "web_version=3\nworker_version=3\n")


if __name__ == "__main__":
    unittest.main()
