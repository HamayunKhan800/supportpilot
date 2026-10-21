import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { createAuth } from "@/server/platform/auth/auth";
import { getDb } from "@/server/platform/db/client";
import { account, rateLimit, session } from "@/server/platform/db/schema";
import { getEnv } from "@/server/platform/env";
import { PASSWORD, resetDatabase, signUpAndIn, TestClient } from "./support/client";

const handler = (req: Request) => getAuth().handler(req);

beforeAll(async () => {
  await resetDatabase();
});

describe("sign-up (FR-A1)", () => {
  it("creates an account with a hashed password and does not sign the user in", async () => {
    const c = new TestClient(handler);
    const res = await c.post("/sign-up/email", { email: "new@example.com", password: PASSWORD, name: "New" });
    expect(res.status).toBe(200);
    expect(c.cookies.size).toBe(0); // autoSignIn: false

    const { db } = getDb();
    const [acc] = await db.select().from(account).where(eq(account.userId, res.json.user.id));
    expect(acc?.providerId).toBe("credential");
    expect(acc?.password).toBeTruthy();
    expect(acc?.password).not.toContain(PASSWORD);
  });

  it("responds identically for an existing email (no account enumeration, T3)", async () => {
    const body = { email: "dupe@example.com", password: PASSWORD, name: "Dupe" };
    const first = await new TestClient(handler).post("/sign-up/email", body);
    const second = await new TestClient(handler).post("/sign-up/email", body);
    expect(second.status).toBe(first.status);
    expect(Object.keys(second.json).sort()).toEqual(Object.keys(first.json).sort());
  });

  it("enforces the 15-character minimum (NIST SP 800-63B-4)", async () => {
    const c = new TestClient(handler);
    const short = await c.post("/sign-up/email", {
      email: "short@example.com",
      password: "a".repeat(14),
      name: "S",
    });
    expect(short.status).toBe(400);
    const ok = await c.post("/sign-up/email", {
      email: "short@example.com",
      password: "a".repeat(15),
      name: "S",
    });
    expect(ok.status).toBe(200);
  });
});

describe("sign-in, sign-out and sessions (FR-A1, FR-A5, T3, T4)", () => {
  it("returns the same error for a wrong password and an unknown email", async () => {
    await new TestClient(handler).post("/sign-up/email", {
      email: "known@example.com",
      password: PASSWORD,
      name: "K",
    });
    const wrong = await new TestClient(handler).post("/sign-in/email", {
      email: "known@example.com",
      password: "x".repeat(20),
    });
    const unknown = await new TestClient(handler).post("/sign-in/email", {
      email: "nobody@example.com",
      password: "x".repeat(20),
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
  });

  it("sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const c = new TestClient(handler);
    await c.post("/sign-up/email", { email: "cookie@example.com", password: PASSWORD, name: "C" });
    const res = await c.post("/sign-in/email", { email: "cookie@example.com", password: PASSWORD });
    const cookie = res.headers.getSetCookie().find((h) => h.includes("session_token"));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it("uses __Secure- prefixed, Secure cookies when served over https", async () => {
    const httpsAuth = createAuth(getDb().db, { ...getEnv(), BETTER_AUTH_URL: "https://app.example.com" });
    const h = (req: Request) =>
      httpsAuth.handler(
        new Request(req.url.replace("http://localhost:3000", "https://app.example.com"), req),
      );
    await new TestClient(h).request("POST", "/sign-up/email", {
      body: { email: "secure@example.com", password: PASSWORD, name: "S" },
      origin: "https://app.example.com",
    });
    const res = await new TestClient(h).request("POST", "/sign-in/email", {
      body: { email: "secure@example.com", password: PASSWORD },
      origin: "https://app.example.com",
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((x) => x.includes("session_token"));
    expect(cookie).toMatch(/^__Secure-/);
    expect(cookie).toMatch(/;\s*Secure/i);
  });

  it("sign-out revokes the session server-side (a copied cookie stops working)", async () => {
    const c = await signUpAndIn(handler, "signout@example.com");
    const stolen = new TestClient(handler);
    for (const [k, v] of c.cookies) stolen.cookies.set(k, v);
    expect((await stolen.get("/get-session")).json?.user.email).toBe("signout@example.com");

    expect((await c.post("/sign-out")).status).toBe(200);
    expect((await stolen.get("/get-session")).json).toBeNull();
  });

  it("changing the password revokes every other session, even if the client does not ask", async () => {
    const a = await signUpAndIn(handler, "pwchange@example.com");
    const b = new TestClient(handler);
    await b.post("/sign-in/email", { email: "pwchange@example.com", password: PASSWORD });
    expect((await b.get("/get-session")).json?.user).toBeTruthy();

    const newPassword = "an even longer passphrase 2026";
    const res = await a.post("/change-password", { currentPassword: PASSWORD, newPassword });
    expect(res.status).toBe(200);
    expect((await b.get("/get-session")).json).toBeNull();
    expect((await a.get("/get-session")).json?.user.email).toBe("pwchange@example.com");

    const { db } = getDb();
    const rows = await db.select().from(session).where(eq(session.userId, res.json.user.id));
    expect(rows).toHaveLength(1);
  });
});

describe("CSRF protection (T5)", () => {
  it("rejects state-changing requests from an untrusted Origin", async () => {
    const c = new TestClient(handler);
    await c.post("/sign-up/email", { email: "csrf@example.com", password: PASSWORD, name: "C" });
    const res = await c.post(
      "/sign-in/email",
      { email: "csrf@example.com", password: PASSWORD },
      { origin: "https://evil.example.com" },
    );
    expect(res.status).toBe(403);
    expect(c.cookies.size).toBe(0);
  });

  it("blocks cross-site navigation logins detected via Fetch Metadata", async () => {
    const res = await handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
        body: JSON.stringify({ email: "csrf@example.com", password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects cookie-authenticated requests without an Origin header", async () => {
    const c = await signUpAndIn(handler, "noorigin@example.com");
    const res = await c.request("POST", "/organization/create", {
      body: { name: "No Origin", slug: "no-origin" },
      origin: null,
    });
    expect(res.status).toBe(403);
  });
});

describe("rate limiting (T3)", () => {
  it("limits sign-in attempts per IP using database storage", async () => {
    const limited = createAuth(getDb().db, { ...getEnv(), AUTH_RATE_LIMIT_ENABLED: true });
    const h = (req: Request) => limited.handler(req);
    const attacker = new TestClient(h, "198.51.100.7");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await attacker.post("/sign-in/email", {
            email: "victim@example.com",
            password: `guess-${i}-xxxxxxxxxx`,
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);

    // Another client IP is unaffected.
    const other = new TestClient(h, "198.51.100.8");
    expect(
      (await other.post("/sign-in/email", { email: "victim@example.com", password: "x".repeat(20) })).status,
    ).toBe(401);

    const { db } = getDb();
    expect((await db.select().from(rateLimit)).length).toBeGreaterThan(0);
  });
});
