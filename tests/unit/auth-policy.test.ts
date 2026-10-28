import { describe, expect, it } from "vitest";
import {
  INVITATION_EXPIRES_IN_SECONDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateWorkspaceName,
  validateWorkspaceSlug,
} from "@/server/platform/auth/policy";

describe("password policy (NIST SP 800-63B-4 §3.1.1.2)", () => {
  it("requires 8+ characters (ASVS V6.2.1) and permits at least 64", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBeGreaterThanOrEqual(64);
  });
});

describe("invitations (FR-A3)", () => {
  it("expire after 7 days", () => {
    expect(INVITATION_EXPIRES_IN_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe("workspace slug (FR-A2)", () => {
  it.each(["acme", "acme-support", "nimbus-cloud-2", "a1b", "x".repeat(48)])("accepts %s", (slug) => {
    expect(validateWorkspaceSlug(slug)).toBeNull();
  });

  it.each([
    ["too short", "ab"],
    ["too long", "x".repeat(49)],
    ["uppercase", "Acme"],
    ["leading hyphen", "-acme"],
    ["trailing hyphen", "acme-"],
    ["double hyphen", "acme--support"],
    ["space", "acme support"],
    ["unicode look-alike", "аcme"], // Cyrillic "а"
    ["path traversal", "../admin"],
  ])("rejects %s", (_label, slug) => {
    expect(validateWorkspaceSlug(slug)).not.toBeNull();
  });

  it.each(["admin", "api", "app", "invite", "supportpilot"])("rejects reserved slug %s", (slug) => {
    expect(validateWorkspaceSlug(slug)).toMatch(/reserved/);
  });
});

describe("workspace name", () => {
  it("accepts 2–80 characters after trimming", () => {
    expect(validateWorkspaceName("  Acme  ")).toBeNull();
    expect(validateWorkspaceName("A")).not.toBeNull();
    expect(validateWorkspaceName("   ")).not.toBeNull();
    expect(validateWorkspaceName("x".repeat(81))).not.toBeNull();
  });
});
