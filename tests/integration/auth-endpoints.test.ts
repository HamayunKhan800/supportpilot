import { beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { getSessionContext } from "@/server/platform/auth/context";
import { PASSWORD, resetDatabase, signUpAndIn, type TestClient } from "./support/client";

/**
 * Auth-library endpoints the UI never calls (threat T21, M7 step 4). Anyone with a session can
 * call them directly, so each must stay closed or keep the app's rules. The role and tenant
 * matrix for the endpoints the UI does use is in workspaces.test.ts.
 */
const handler = (req: Request) => getAuth().handler(req);

let owner: TestClient, agent: TestClient;
let orgId: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await signUpAndIn(handler, "owner@acme.test");
  agent = await signUpAndIn(handler, "agent@acme.test");
  orgId = (await owner.post("/organization/create", { name: "Acme Support", slug: "acme" })).json.id;
  const userId = (await getSessionContext(agent.headers))!.user.id;
  await getAuth().api.addMember({ body: { userId, role: "agent", organizationId: orgId } });
  await agent.post("/organization/set-active", { organizationId: orgId });
});

describe("auth-library endpoints the UI never calls (T21)", () => {
  it("the only owner can't leave the workspace (it would be left without an owner)", async () => {
    const res = await owner.post("/organization/leave", { organizationId: orgId });
    expect(res.status).toBe(400);
    const members = await owner.get("/organization/list-members", { organizationId: orgId });
    expect(members.json.members.some((m: { role: string }) => m.role === "owner")).toBe(true);
  });

  it("can't unlink the only way to sign in", async () => {
    const res = await agent.post("/unlink-account", { providerId: "credential" });
    expect(res.status).toBe(400);
    expect((await agent.post("/sign-out")).status).toBe(200);
    const again = await agent.post("/sign-in/email", { email: "agent@acme.test", password: PASSWORD });
    expect(again.status).toBe(200);
  });

  it("add-member is server-only: not reachable over HTTP", async () => {
    const res = await owner.post("/organization/add-member", { userId: "someone", role: "admin" });
    expect(res.status).toBe(404);
  });

  it("account deletion and email change are closed", async () => {
    expect((await agent.post("/delete-user", { password: PASSWORD })).status).toBe(404);
    expect((await agent.post("/change-email", { newEmail: "takeover@example.test" })).status).toBe(400);
  });

  it("update-user can't change the email address", async () => {
    const res = await agent.post("/update-user", { email: "takeover@example.test" });
    expect(res.status).toBe(400);
    expect((await getSessionContext(agent.headers))!.user.email).toBe("agent@acme.test");
  });
});

describe("another workspace through the library (T1)", () => {
  it("an outsider can't read a workspace by its slug either", async () => {
    const outsider = await signUpAndIn(handler, "outsider@globex.test");
    await outsider.post("/organization/create", { name: "Globex", slug: "globex" });
    const res = await outsider.get("/organization/get-full-organization", { organizationSlug: "acme" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).not.toContain("Acme Support");
  });
});
