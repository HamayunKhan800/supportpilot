import { createAccessControl } from "better-auth/plugins/access";

/**
 * Role/permission matrix (docs/01-requirements.md §2.1). This is the single source of
 * truth for authorization:
 *  - Better Auth's organization plugin uses `ac` + `roles` to guard its own endpoints
 *    (members, invitations, workspace settings).
 *  - Application services call `can()` / `authorize()` (see ./context.ts).
 *
 * Deny by default: anything not listed here is not allowed (threat model T2).
 * "Workspace" in the product = "organization" in Better Auth.
 */
export const statement = {
  // Better Auth built-in resources (names must match the plugin's).
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  // Application resources (enforced by our services from M3 onward).
  ticket: ["read", "update"],
  draft: ["generate", "approve"],
  triage: ["override"],
  kb: ["read", "write"],
  settings: ["read", "update"],
  analytics: ["read"],
  audit: ["read"],
} as const;

export const ac = createAccessControl(statement);

const agentPermissions = {
  ticket: ["read", "update"],
  draft: ["generate", "approve"],
  triage: ["override"],
  kb: ["read"],
  settings: ["read"],
  analytics: ["read"],
} as const;

export const agent = ac.newRole({ ...agentPermissions });

export const admin = ac.newRole({
  ...agentPermissions,
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  kb: ["read", "write"],
  settings: ["read", "update"],
  audit: ["read"],
});

export const owner = ac.newRole({
  ...agentPermissions,
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  kb: ["read", "write"],
  settings: ["read", "update"],
  audit: ["read"],
});

export const roles = { owner, admin, agent } as const;

export type Role = keyof typeof roles;
export const ROLES = Object.keys(roles) as Role[];
/** Roles that can be granted through an invitation (ownership is never invited). */
export const INVITABLE_ROLES = ["admin", "agent"] as const satisfies readonly Role[];

type Statement = typeof statement;
export type Permission = { [R in keyof Statement]?: readonly Statement[R][number][] };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(roles, value);
}

/**
 * Pure permission check. Better Auth stores multiple roles as a comma-separated string.
 * We only ever assign one, but accept the format and require every role to be known.
 */
export function can(roleValue: string | null | undefined, permission: Permission): boolean {
  if (!roleValue) return false;
  const assigned = roleValue.split(",").map((r) => r.trim());
  if (assigned.length === 0 || !assigned.every(isRole)) return false;
  return assigned.some((r) => roles[r].authorize(permission as never).success);
}
