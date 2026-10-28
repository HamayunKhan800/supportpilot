import { hashPassword as legacyHash } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuth } from "@/server/platform/auth";
import { createAuth } from "@/server/platform/auth/auth";
import { getDb } from "@/server/platform/db/client";
import { account, rateLimit, session, user } from "@/server/platform/db/schema";
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

  it("enforces the 8-character minimum (ASVS V6.2.1)", async () => {
    const c = new TestClient(handler);
    const short = await c.post("/sign-up/email", {
      email: "short@example.com",
      password: "a".repeat(7),
      name: "S",
    });
    expect(short.status).toBe(400);
    const ok = await c.post("/sign-up/email", {
      email: "short@example.com",
      password: "a".repeat(8),
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
    const limited = createAuth(getDb().db, {
      ...getEnv(),
      AUTH_RATE_LIMIT_ENABLED: true,
      TRUST_PROXY_HEADERS: true, // behind our proxy, so X-Forwarded-For is believed
    });
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

/** Sends a header the browser could set itself: the app's internal client-IP header. */
function spoofing(h: (req: Request) => Promise<Response>, value: () => string) {
  return (req: Request) => {
    const headers = new Headers(req.headers);
    headers.set("x-sp-client-ip", value());
    return h(new Request(req, { headers }));
  };
}

async function guesses(client: (i: number) => TestClient, n: number) {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await client(i).post("/sign-in/email", {
      email: "victim@example.com",
      password: `guess-${i}-xxxxxxxxxx`,
    });
    statuses.push(res.status);
  }
  return statuses;
}

describe("a client can't pick its own IP to dodge the limit (T27, M7-01)", () => {
  it("ignores X-Forwarded-For when no trusted proxy sets it", async () => {
    await getDb().db.delete(rateLimit);
    const auth = createAuth(getDb().db, {
      ...getEnv(),
      AUTH_RATE_LIMIT_ENABLED: true,
      TRUST_PROXY_HEADERS: false,
    });
    const h = spoofing(
      (req) => auth.handler(req),
      () => `192.0.2.${Math.floor(Math.random() * 250)}`,
    );
    // A new X-Forwarded-For value (and internal header) on every guess still hits one limit.
    const statuses = await guesses((i) => new TestClient(h, `198.51.100.${20 + i}`), 6);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it("behind a trusted proxy, drops a client-sent internal IP header", async () => {
    await getDb().db.delete(rateLimit);
    const auth = createAuth(getDb().db, {
      ...getEnv(),
      AUTH_RATE_LIMIT_ENABLED: true,
      TRUST_PROXY_HEADERS: true,
    });
    let n = 0;
    const h = spoofing(
      (req) => auth.handler(req),
      () => `192.0.2.${++n}`,
    );
    const statuses = await guesses(() => new TestClient(h, "198.51.100.40"), 6);
    expect(statuses[5]).toBe(429);
  });
});

describe("password storage (M7-02, ASVS V11.4.2)", () => {
  it("stores new passwords as versioned scrypt hashes with the stronger settings", async () => {
    await signUpAndIn(handler, "hash-new@example.com");
    const [u] = await getDb().db.select().from(user).where(eq(user.email, "hash-new@example.com"));
    const [row] = await getDb().db.select().from(account).where(eq(account.userId, u!.id));
    expect(row!.password).toMatch(/^\$scrypt\$n=16384,r=8,p=5\$[\w-]{22}\$[\w-]{43}$/);
  });

  it("still accepts a pre-M7 hash, and upgrades it only after a correct password", async () => {
    await signUpAndIn(handler, "hash-old@example.com");
    const { db } = getDb();
    const [u] = await db.select().from(user).where(eq(user.email, "hash-old@example.com"));
    const old = await legacyHash(PASSWORD);
    await db.update(account).set({ password: old }).where(eq(account.userId, u!.id));

    const wrong = await new TestClient(handler).post("/sign-in/email", {
      email: "hash-old@example.com",
      password: "not the right passphrase",
    });
    expect(wrong.status).toBe(401);
    expect((await db.select().from(account).where(eq(account.userId, u!.id)))[0]!.password).toBe(old);

    const right = await new TestClient(handler).post("/sign-in/email", {
      email: "hash-old@example.com",
      password: PASSWORD,
    });
    expect(right.status).toBe(200);
    const [after] = await db.select().from(account).where(eq(account.userId, u!.id));
    expect(after!.password).toMatch(/^\$scrypt\$n=16384,r=8,p=5\$/);
    const again = await new TestClient(handler).post("/sign-in/email", {
      email: "hash-old@example.com",
      password: PASSWORD,
    });
    expect(again.status).toBe(200);
  });
});

describe("session lifetime (M7-03, ASVS V7.3.2)", () => {
  it("never extends a session: it ends at the time set at sign-in", async () => {
    const c = await signUpAndIn(handler, "lifetime@example.com");
    const { db } = getDb();
    const [u] = await db.select().from(user).where(eq(user.email, "lifetime@example.com"));
    // Pretend the session is 6 days and 23 hours old: one hour left.
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await db.update(session).set({ expiresAt: soon }).where(eq(session.userId, u!.id));
    expect((await c.get("/get-session")).json?.user?.email).toBe("lifetime@example.com");
    const [row] = await db.select().from(session).where(eq(session.userId, u!.id));
    expect(row!.expiresAt.getTime()).toBe(soon.getTime());
  });
});

describe("sign-up input rules (M7-08, M7-22)", () => {
  const signUp = (body: Record<string, unknown>) =>
    new TestClient(handler).post("/sign-up/email", { password: PASSWORD, name: "Test", ...body });

  it("refuses passwords that contain the product name or the email name", async () => {
    const product = await signUp({ email: "ctx-1@example.com", password: "my Support-Pilot password 2026" });
    expect(product.status).toBe(400);
    const local = await signUp({
      email: "jordan.lee@example.com",
      password: "jordanlee is my long passphrase",
    });
    expect(local.status).toBe(400);
    expect(local.json.message).toMatch(/email name or the product name/);
  });

  it("refuses names that are too long or contain control characters", async () => {
    expect((await signUp({ email: "name-1@example.com", name: "x".repeat(101) })).status).toBe(400);
    expect((await signUp({ email: "name-2@example.com", name: "Bad\u0000Name" })).status).toBe(400);
    expect((await signUp({ email: "name-3@example.com", name: "   " })).status).toBe(400);
  });
});

describe("session list (M7-05)", () => {
  it("lists only the caller's own sessions, and a token alone can't sign anyone in", async () => {
    const laptop = await signUpAndIn(handler, "sessions-list@example.com");
    const phone = await signUpAndIn(handler, "sessions-other@example.com");
    const list = await laptop.get("/list-sessions");
    expect(list.status).toBe(200);
    expect(list.json).toHaveLength(1);
    const token = list.json[0].token as string;

    // The cookie is "<token>.<signature>"; the bare token is refused.
    const cookieName = [...laptop.cookies.keys()].find((k) => k.endsWith("session_token"))!;
    const bare = await handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie: `${cookieName}=${token}` },
      }),
    );
    expect(await bare.json()).toBeNull();

    // Someone else's token can't be revoked.
    await phone.post("/revoke-session", { token });
    expect((await laptop.get("/get-session")).json?.user?.email).toBe("sessions-list@example.com");
  });
});

describe("sign-out (M7-06, ASVS V14.3.1)", () => {
  it("tells the browser to clear cached pages", async () => {
    const c = await signUpAndIn(handler, "signout-cache@example.com");
    const res = await c.post("/sign-out");
    expect(res.status).toBe(200);
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
  });
});
