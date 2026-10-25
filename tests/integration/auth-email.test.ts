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
    await vi.waitFor(() => expect(readOutbox().length).toBeGreaterThan(0)); // its sign-up code
    clearOutbox();
    const res = await new TestClient((req) => off.handler(req)).post("/request-password-reset", {
      email: "reset-off@example.com",
      redirectTo: "/reset-password",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await new Promise((r) => setTimeout(r, 50));
    expect(readOutbox()).toHaveLength(0);
  });
});

describe("email verification by 6-digit code", () => {
  const codeIn = (text: string) => text.match(/\b(\d{6})\b/)?.[1];
  const signUp = (email: string) =>
    new TestClient(handler).post("/sign-up/email", { email, password: PASSWORD, name: "New" });
  const verify = (email: string, otp: string) =>
    new TestClient(handler).post("/email-otp/verify-email", { email, otp });

  it("sends a code on sign-up; signing in needs it, and a wrong password never sends one", async () => {
    const email = "verify-flow@example.com";
    expect((await signUp(email)).status).toBe(200);
    const first = await lastEmail(email);
    expect(first.subject).toMatch(/^\d{6} is your SupportPilot verification code$/);
    expect(first.text).toContain("10 minutes");

    clearOutbox();
    expect((await signIn(email, "x".repeat(20))).status).toBe(401); // same as an unknown email
    await new Promise((r) => setTimeout(r, 50));
    expect(readOutbox(email)).toHaveLength(0);

    const blocked = await new TestClient(handler).post("/sign-in/email", { email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe("EMAIL_NOT_VERIFIED");
    const code = codeIn((await lastEmail(email)).text)!; // a fresh code on each sign-in attempt

    const ok = await verify(email, code);
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false); // no auto sign-in
    expect((await signIn(email)).status).toBe(200);
  });

  it("spends a code after 3 wrong tries", async () => {
    const email = "verify-attempts@example.com";
    await signUp(email);
    const code = codeIn((await lastEmail(email)).text)!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await verify(email, wrong)).status).toBe(400);
    const late = await verify(email, code);
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect((await signIn(email)).status).toBe(403);
  });

  it("stores codes hashed", async () => {
    const email = "verify-hash@example.com";
    await signUp(email);
    const code = codeIn((await lastEmail(email)).text)!;
    const rows = await getDb().db.select().from(verification);
    for (const row of rows) {
      expect(row.value).not.toContain(code);
      expect(row.identifier).not.toContain(email);
    }
  });

  it("answers a sign-up with a taken email the same way, and tells the owner instead (T3)", async () => {
    const email = "verify-taken@example.com";
    await verifiedUser(email);
    clearOutbox();
    const fresh = await signUp("verify-fresh@example.com");
    const taken = await signUp(email);
    expect(taken.status).toBe(fresh.status);
    expect(Object.keys(taken.json).sort()).toEqual(Object.keys(fresh.json).sort());
    const notice = await lastEmail(email);
    expect(notice.subject).toBe("Someone tried to create a SupportPilot account with your email");
    expect(codeIn(notice.text)).toBeUndefined();
  });

  it("'send a new code' says the same for an unknown email and sends nothing", async () => {
    const known = "verify-resend@example.com";
    await signUp(known);
    clearOutbox();
    const c = new TestClient(handler);
    const a = await c.post("/email-otp/send-verification-otp", { email: known, type: "email-verification" });
    const b = await c.post("/email-otp/send-verification-otp", {
      email: "verify-nobody@example.com",
      type: "email-verification",
    });
    expect(a.status).toBe(200);
    expect(b.json).toEqual(a.json);
    await lastEmail(known);
    expect(readOutbox("verify-nobody@example.com")).toHaveLength(0);
  });

  it("only sends verification codes, and keeps the plugin's other endpoints closed", async () => {
    const c = new TestClient(handler);
    const signInCode = await c.post("/email-otp/send-verification-otp", {
      email: "a@example.com",
      type: "sign-in",
    });
    expect(signInCode.status).toBe(400);
    for (const path of ["/sign-in/email-otp", "/email-otp/reset-password", "/forget-password/email-otp"]) {
      expect((await c.post(path, { email: "a@example.com", otp: "123456" })).status).toBe(404);
    }
    expect((await c.get("/verify-email", { token: "x" })).status).toBe(404);
  });
});

describe("Google and GitHub sign-in", () => {
  const withKeys = createAuth(
    getDb().db,
    {
      ...getEnv(),
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
    },
    { email: null },
  );
  const start = (a: typeof auth, provider: string) =>
    new TestClient((req) => a.handler(req)).post("/sign-in/social", { provider, callbackURL: "/app" });

  it("asks Google for openid, email and profile only, with account choice", async () => {
    const res = await start(withKeys, "google");
    expect(res.status).toBe(200);
    const url = new URL(res.json.url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(["email", "openid", "profile"]);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/google");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("sends GitHub sign-ins to GitHub with its callback", async () => {
    const res = await start(withKeys, "github");
    expect(res.status).toBe(200);
    const url = new URL(res.json.url);
    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/github");
  });

  it("refuses a provider whose keys are not set", async () => {
    expect((await start(auth, "google")).status).toBeGreaterThanOrEqual(400);
  });
});
