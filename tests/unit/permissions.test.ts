import { describe, expect, it } from "vitest";
import { can, INVITABLE_ROLES, isRole, type Permission, ROLES } from "@/server/platform/auth/permissions";

/**
 * Mirrors docs/01-requirements.md §2.1 row by row. If the matrix changes, this table
 * and the document must change together.
 */
const matrix: [capability: string, permission: Permission, allowed: ("owner" | "admin" | "agent")[]][] = [
  ["View ticket queue & tickets", { ticket: ["read"] }, ["owner", "admin", "agent"]],
  ["Reply / note / status / assignee", { ticket: ["update"] }, ["owner", "admin", "agent"]],
  ["Generate / edit / approve AI drafts", { draft: ["generate", "approve"] }, ["owner", "admin", "agent"]],
  ["Override AI triage", { triage: ["override"] }, ["owner", "admin", "agent"]],
  ["View knowledge base documents", { kb: ["read"] }, ["owner", "admin", "agent"]],
  ["Upload / delete knowledge base documents", { kb: ["write"] }, ["owner", "admin"]],
  ["Edit workspace settings", { settings: ["update"] }, ["owner", "admin"]],
  ["Edit workspace name", { organization: ["update"] }, ["owner", "admin"]],
  ["Invite members", { invitation: ["create", "cancel"] }, ["owner", "admin"]],
  ["Change roles / remove members", { member: ["update", "delete"] }, ["owner", "admin"]],
  ["View analytics", { analytics: ["read"] }, ["owner", "admin", "agent"]],
  ["View audit log", { audit: ["read"] }, ["owner", "admin"]],
  ["Delete workspace", { organization: ["delete"] }, ["owner"]],
];

describe("permission matrix (docs/01-requirements.md §2.1, T2)", () => {
  for (const [capability, permission, allowed] of matrix) {
    for (const role of ROLES) {
      const expected = allowed.includes(role as never);
      it(`${role} ${expected ? "can" : "cannot"}: ${capability}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }
});

describe("can() (deny by default)", () => {
  it("denies missing, empty and unknown roles", () => {
    expect(can(null, { ticket: ["read"] })).toBe(false);
    expect(can(undefined, { ticket: ["read"] })).toBe(false);
    expect(can("", { ticket: ["read"] })).toBe(false);
    expect(can("member", { ticket: ["read"] })).toBe(false); // Better Auth's default role is not ours
    expect(can("superuser", { ticket: ["read"] })).toBe(false);
  });

  it("requires every requested action", () => {
    expect(can("agent", { kb: ["read", "write"] })).toBe(false);
    expect(can("admin", { kb: ["read", "write"] })).toBe(true);
  });

  it("denies actions or resources outside the statement", () => {
    expect(can("owner", { ticket: ["delete" as never] })).toBe(false);
    expect(can("owner", { billing: ["read"] } as never)).toBe(false);
  });

  it("handles Better Auth's comma-separated multi-role format strictly", () => {
    expect(can("agent,admin", { audit: ["read"] })).toBe(true);
    expect(can("agent, admin", { audit: ["read"] })).toBe(true);
    // One unknown role invalidates the whole value rather than being skipped.
    expect(can("agent,hacker", { ticket: ["read"] })).toBe(false);
  });

  it("does not let prototype keys pass as roles", () => {
    expect(isRole("constructor")).toBe(false);
    expect(isRole("__proto__")).toBe(false);
    expect(can("toString", { ticket: ["read"] })).toBe(false);
  });

  it("never lets an invitation grant ownership", () => {
    expect(INVITABLE_ROLES).not.toContain("owner");
  });
});
