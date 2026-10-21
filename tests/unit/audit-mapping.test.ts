import { describe, expect, it } from "vitest";
import { auditEventFromAuthResponse, memberEvent } from "@/server/platform/auth/audit";

const inv = {
  id: "inv1",
  organizationId: "ws1",
  email: "person@example.com",
  role: "agent",
  status: "pending",
};
const mem = { id: "m1", organizationId: "ws1", userId: "u2", role: "admin" };

describe("auditEventFromAuthResponse (T15)", () => {
  it("maps workspace creation and update", () => {
    expect(auditEventFromAuthResponse("/organization/create", { id: "ws1", slug: "acme" }, "u1")).toEqual({
      workspaceId: "ws1",
      actorUserId: "u1",
      action: "workspace.created",
      targetType: "workspace",
      targetId: "ws1",
      metadata: { slug: "acme" },
    });
    expect(auditEventFromAuthResponse("/organization/update", { id: "ws1" }, "u1")?.action).toBe(
      "workspace.updated",
    );
  });

  it.each([
    ["/organization/invite-member", inv, "invitation.created"],
    ["/organization/cancel-invitation", inv, "invitation.cancelled"],
    ["/organization/reject-invitation", { invitation: inv }, "invitation.rejected"],
    ["/organization/accept-invitation", { invitation: inv, member: mem }, "invitation.accepted"],
  ])("maps %s", (path, body, action) => {
    const e = auditEventFromAuthResponse(path, body, "u1");
    expect(e).toMatchObject({ workspaceId: "ws1", action, targetType: "invitation", targetId: "inv1" });
  });

  it.each([
    ["/organization/update-member-role", { member: mem }, "member.role_changed"],
    ["/organization/update-member-role", mem, "member.role_changed"],
    ["/organization/remove-member", { member: mem }, "member.removed"],
    ["/organization/leave", mem, "member.left"],
  ])("maps %s", (path, body, action) => {
    expect(auditEventFromAuthResponse(path, body, "u1")).toMatchObject({
      workspaceId: "ws1",
      action,
      targetType: "member",
      targetId: "m1",
      metadata: { userId: "u2", role: "admin" },
    });
  });

  it("builds member.added events for server-side additions (no actor)", () => {
    expect(memberEvent("member.added", mem, null)).toMatchObject({
      action: "member.added",
      actorUserId: null,
      targetId: "m1",
    });
  });

  it("never copies the invitee email into the event", () => {
    const e = auditEventFromAuthResponse("/organization/invite-member", inv, "u1");
    expect(JSON.stringify(e)).not.toContain("person@example.com");
  });

  it("ignores unknown paths and malformed responses", () => {
    expect(auditEventFromAuthResponse("/sign-in/email", { id: "x" }, "u1")).toBeNull();
    expect(auditEventFromAuthResponse("/organization/create", null, "u1")).toBeNull();
    expect(auditEventFromAuthResponse("/organization/create", [], "u1")).toBeNull();
    expect(auditEventFromAuthResponse("/organization/create", { slug: "no-id" }, "u1")).toBeNull();
    expect(
      auditEventFromAuthResponse("/organization/remove-member", { member: { id: "m1" } }, "u1"),
    ).toBeNull();
    expect(
      auditEventFromAuthResponse("/organization/invite-member", { id: 5, organizationId: "ws1" }, "u1"),
    ).toBeNull();
  });
});
