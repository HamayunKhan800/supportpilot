import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Plan M8 revision 2, step 3: the IAM policies the bootstrap script installs by hand in
 * CloudShell. Terraform can't check them (they sit outside it), so these tests do:
 * the permissions boundary must allow exactly what the Terraform roles use, and the
 * Terraform role must not be able to escape it.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

interface Statement {
  Sid: string;
  Effect: "Allow" | "Deny";
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}
interface PolicyDocument {
  Version: string;
  Statement: Statement[];
}

const ACCOUNT = "111122223333";
const REGION = "ap-southeast-2";

/** What bootstrap.sh's render() does: fill the two placeholders. */
function render(file: string): PolicyDocument {
  const text = read(`infra/bootstrap/${file}`)
    .replaceAll("{{ACCOUNT_ID}}", ACCOUNT)
    .replaceAll("{{REGION}}", REGION);
  expect(text).not.toMatch(/\{\{|\}\}/);
  return JSON.parse(text) as PolicyDocument;
}

const list = (v: string | string[]) => (Array.isArray(v) ? v : [v]);
const actionsOf = (doc: PolicyDocument, effect: "Allow" | "Deny" = "Allow") =>
  new Set(doc.Statement.filter((s) => s.Effect === effect).flatMap((s) => list(s.Action)));

const boundary = render("boundary-policy.json");
const infraPolicy = render("infra-role-policy.json");
const infraTrust = render("infra-role-trust.json");

describe("bootstrap policies", () => {
  it("are complete policy documents once the account and Region are filled in", () => {
    for (const doc of [boundary, infraPolicy, infraTrust]) {
      expect(doc.Version).toBe("2012-10-17");
      expect(doc.Statement.length).toBeGreaterThan(0);
      for (const s of doc.Statement) expect(s.Sid).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("are all installed by bootstrap.sh", () => {
    const script = read("infra/bootstrap/bootstrap.sh");
    for (const file of ["boundary-policy.json", "infra-role-policy.json", "infra-role-trust.json"]) {
      expect(script).toContain(`render ${file}`);
    }
  });
});

describe("permissions boundary", () => {
  it("allows exactly the actions the Terraform-made roles use (nothing missing, nothing spare)", () => {
    const iamTf = read("infra/terraform/iam.tf");
    const used = new Set(
      [...iamTf.matchAll(/"((?:logs|ssm|lambda|ecr|s3|iam|scheduler):[A-Za-z*]+)"/g)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(10);
    expect([...actionsOf(boundary)].sort()).toEqual([...used].sort());
  });

  it("names only this app's resources, apart from ECR sign-in", () => {
    for (const s of boundary.Statement) {
      for (const r of list(s.Resource)) {
        if (r === "*") expect(list(s.Action)).toEqual(["ecr:GetAuthorizationToken"]);
        else expect(r).toMatch(/supportpilot/);
      }
    }
    expect([...actionsOf(boundary)].some((a) => a.startsWith("iam:") || a.endsWith(":*"))).toBe(false);
  });
});

describe("Terraform (infra) role", () => {
  const allows = infraPolicy.Statement.filter((s) => s.Effect === "Allow");
  const boundaryArn = `arn:aws:iam::${ACCOUNT}:policy/supportpilot-boundary`;

  it("trusts only the protected infra environment of this repository, by numeric IDs", () => {
    expect(infraTrust.Statement).toHaveLength(1);
    const s = infraTrust.Statement[0]!;
    expect(s.Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(s.Condition).toEqual({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:HamayunKhan800/supportpilot:environment:infra",
        "token.actions.githubusercontent.com:environment": "infra",
        "token.actions.githubusercontent.com:repository_id": "1428261530",
        "token.actions.githubusercontent.com:repository_owner_id": "345785392",
      },
    });
  });

  it("can create or change role permissions only on roles that carry the boundary", () => {
    const grantingActions = ["iam:CreateRole", "iam:PutRolePolicy", "iam:PutRolePermissionsBoundary"];
    for (const action of grantingActions) {
      const statements = allows.filter((s) => list(s.Action).includes(action));
      expect(statements.length, action).toBeGreaterThan(0);
      for (const s of statements) {
        expect(s.Condition?.StringEquals?.["iam:PermissionsBoundary"], action).toBe(boundaryArn);
      }
    }
  });

  it("can't attach managed policies, remove the boundary, or rewrite it", () => {
    const allowed = actionsOf(infraPolicy);
    for (const action of [
      "iam:AttachRolePolicy",
      "iam:DeleteRolePermissionsBoundary",
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:SetDefaultPolicyVersion",
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:*",
      "*",
    ]) {
      expect(allowed.has(action), action).toBe(false);
    }
    const denied = infraPolicy.Statement.find((s) => s.Effect === "Deny");
    expect(list(denied!.Resource)).toContain(boundaryArn);
    expect(list(denied!.Resource)).toContain(`arn:aws:iam::${ACCOUNT}:role/supportpilot-infra`);
  });

  it("touches IAM roles only under /supportpilot/, and itself lives outside it", () => {
    for (const s of allows) {
      if (list(s.Action).some((a) => a.startsWith("iam:"))) {
        expect(list(s.Resource)).toEqual([`arn:aws:iam::${ACCOUNT}:role/supportpilot/*`]);
      }
    }
  });

  it("can write only the Terraform-owned settings folder, never the secret folders", () => {
    const ssmWrites = allows.filter((s) => list(s.Action).some((a) => /^ssm:(Put|Get|Delete)/.test(a)));
    expect(ssmWrites.flatMap((s) => list(s.Resource))).toEqual([
      `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/supportpilot/production/settings/*`,
    ]);
    expect(actionsOf(infraPolicy).has("ssm:GetParametersByPath")).toBe(false);
  });

  it("passes roles only to Lambda and EventBridge Scheduler", () => {
    const pass = allows.filter((s) => list(s.Action).includes("iam:PassRole"));
    expect(pass).toHaveLength(1);
    expect(pass[0]!.Condition).toEqual({
      StringEquals: { "iam:PassedToService": ["lambda.amazonaws.com", "scheduler.amazonaws.com"] },
    });
  });

  it("uses a wildcard resource only for parameter metadata (no resource-level control exists)", () => {
    for (const s of allows) {
      if (list(s.Resource).includes("*")) expect(list(s.Action)).toEqual(["ssm:DescribeParameters"]);
    }
  });
});
