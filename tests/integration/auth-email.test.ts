import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "@/server/platform/auth/auth";
import { getDb } from "@/server/platform/db/client";
import { session, user, verification } from "@/server/platform/db/schema";
import { clearOutbox, createOutboxSender, readOutbox } from "@/server/platform/email/outbox";
import { getEnv } from "@/server/platform/env";
import { PASSWORD, resetDatabase, TestClient } from "./support/client";

/** Auth with email on, delivering to the in-memory outbox (docs/plans/accounts-and-email.md). */
const auth = createAuth(getDb().db, getEnv(), { email: createOutboxSender() });
const handler = (req: Request) => auth.handler(req);
const NEW_PASSWORD = "a different long passphrase for tests";

beforeAll(async () => {
  await resetDatabase();
});
afterEach(() => clearOutbox());

/** A user whose email is already verified (as if they had entered their code). */
async function verifiedUser(email: string) {
  const res = await new TestClient(handler).post("/sign-up/email", {
    email,
    password: PASSWORD,
    name: "Test",
  });
  expect(res.status).toBe(200);
  await getDb().db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
}

async function signIn(email: string, password = PASSWORD) {
  const c = new TestClient(handler);
  const res = await c.post("/sign-in/email", { email, password });
  return { c, status: res.status };
}

/** The newest email to `to`, once the background send has run. */
async function lastEmail(to: string) {
  await vi.waitFor(() => expect(readOutbox(to).length).toBeGreaterThan(0));
  return readOutbox(to)[0]!;
}

async function requestReset(email: string) {
  return new TestClient(handler).post("/request-password-reset", { email, redirectTo: "/reset-password" });
}

/** Follows the emailed link the way a browser would and returns the token it lands with. */
async function tokenFromEmail(email: string) {
  const link = (await lastEmail(email)).text.match(/http\S+\/api\/auth\/reset-password\/\S+/)?.[0];
  expect(link).toBeDefined();
  const url = new URL(link!);
  const res = await handler(new Request(url, { headers: { "x-forwarded-for": "203.0.113.10" } }));
  expect(res.status).toBe(302);
  const landing = new URL(res.headers.get("location")!, url);
  expect(landing.pathname).toBe("/reset-password");
  return landing.searchParams.get("token")!;
}

describe("forgot password (OWASP Forgot Password Cheat Sheet)", () => {
  it("answers the same for an existing and an unknown email, and only emails the real one", async () => {
    await verifiedUser("reset-known@example.com");
    const known = await requestReset("reset-known@example.com");
    const unknown = await requestReset("reset-unknown@example.com");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(unknown.json).toEqual(known.json);
    const mail = await lastEmail("reset-known@example.com");
    expect(mail.subject).toBe("Reset your SupportPilot password");
    expect(mail.text).toContain("30 minutes");
    expect(readOutbox("reset-unknown@example.com")).toHaveLength(0);
  });

  it("stores the reset token hashed, never as sent", async () => {
    await verifiedUser("reset-hash@example.com");
    await requestReset("reset-hash@example.com");
    const token = await tokenFromEmail("reset-hash@example.com");
    const rows = await getDb().db.select({ identifier: verification.identifier }).from(verification);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.identifier).not.toContain(token);
  });

  it("resets once: new password works, old one and every session stop working, owner is told", async () => {
    const email = "reset-flow@example.com";
    await verifiedUser(email);
    const before = await signIn(email);
    expect(before.status).toBe(200);

    await requestReset(email);
    const token = await tokenFromEmail(email);
    clearOutbox();
    const reset = await new TestClient(handler).post("/reset-password", { newPassword: NEW_PASSWORD, token });
    expect(reset.status).toBe(200);
    expect(reset.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false); // no auto sign-in

    const [owner] = await getDb().db.select().from(user).where(eq(user.email, email));
    expect(await getDb().db.select().from(session).where(eq(session.userId, owner!.id))).toHaveLength(0);
    expect((await before.c.get("/get-session")).json).toBeNull();
    expect((await signIn(email)).status).toBe(401);
    expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
    expect((await lastEmail(email)).subject).toBe("Your SupportPilot password was changed");

    const again = await new TestClient(handler).post("/reset-password", { newPassword: PASSWORD, token });
    expect(again.status).toBe(400);
    expect(again.json.code).toBe("INVALID_TOKEN");
  });

  it("applies the sign-up password rules to the new password", async () => {
    await verifiedUser("reset-short@example.com");
    await requestReset("reset-short@example.com");
    const token = await tokenFromEmail("reset-short@example.com");
    const res = await new TestClient(handler).post("/reset-password", { newPassword: "a".repeat(14), token });
    expect(res.status).toBe(400);
    expect((await signIn("reset-short@example.com")).status).toBe(200);
  });

  it("rejects an expired link and sends the browser to the page with an error", async () => {
    await verifiedUser("reset-expired@example.com");
    await requestReset("reset-expired@example.com");
    const link = (await lastEmail("reset-expired@example.com")).text.match(/http\S+reset-password\/\S+/)![0];
    await getDb()
      .db.update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await handler(new Request(link, { headers: { "x-forwarded-for": "203.0.113.10" } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=INVALID_TOKEN");
  });
});

describe("password change notice", () => {
  it("emails the owner when they change their password while signed in", async () => {
    const email = "change-notice@example.com";
    await verifiedUser(email);
    const { c } = await signIn(email);
    const res = await c.post("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect((await lastEmail(email)).subject).toBe("Your SupportPilot password was changed");
  });
});

describe("with email off (no EMAIL_PROVIDER)", () => {
  it("offers no password reset and sends nothing", async () => {
    const off = createAuth(getDb().db, getEnv(), { email: null });
    await verifiedUser("reset-off@example.com");
    const res = await new TestClient((req) => off.handler(req)).post("/request-password-reset", {
      email: "reset-off@example.com",
      redirectTo: "/reset-password",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(readOutbox()).toHaveLength(0);
  });
});
