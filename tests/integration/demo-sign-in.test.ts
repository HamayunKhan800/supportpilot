import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Before the env is first read: /demo is on only when DEMO_PASSWORD is set.
vi.hoisted(() => {
  process.env.DEMO_PASSWORD = "correct horse battery staple";
});

import { POST } from "@/app/api/demo/sign-in/route";
import { getAuth } from "@/server/platform/auth";
import { getDb } from "@/server/platform/db/client";
import { getEnv } from "@/server/platform/env";
import { stopWebBoss } from "@/server/platform/jobs/boss";
import { seedDemoWorkspace } from "../../scripts/lib/demo-workspace";
import { loadCorpus } from "../../scripts/lib/kb-corpus";
import { PASSWORD, resetDatabase } from "./support/client";

/** One-tap demo sign-in (/demo): the password stays on the server; only this site may use it. */
const env = getEnv();
const origin = new URL(env.BETTER_AUTH_URL).origin;

function post(role: string, from: string | null = origin) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.20" });
  if (from) headers.set("origin", from);
  return POST(
    new Request(`${origin}/api/demo/sign-in`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ role }),
    }),
  );
}

beforeAll(async () => {
  await resetDatabase();
  await seedDemoWorkspace(getDb().db, getAuth(), {
    password: PASSWORD,
    domain: env.DEMO_EMAIL_DOMAIN,
    corpus: loadCorpus().slice(0, 1),
  });
});
afterAll(async () => {
  await stopWebBoss();
});

describe("one-tap demo sign-in", () => {
  it("signs in as the chosen demo role and opens the app", async () => {
    const res = await post("agent");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${origin}/app`);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => /session_token=/.test(c) && /HttpOnly/i.test(c))).toBe(true);

    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: cookies.map((c) => c.split(";")[0]).join("; ") }),
    });
    expect(session?.user.email).toBe(`agent@${env.DEMO_EMAIL_DOMAIN}`);
  });

  it("never puts the password in the response", async () => {
    const res = await post("owner");
    expect(JSON.stringify([...res.headers])).not.toContain(PASSWORD);
    expect(await res.text()).not.toContain(PASSWORD);
  });

  it("refuses forms from other sites and requests without an origin", async () => {
    expect((await post("agent", "https://evil.example")).status).toBe(403);
    expect((await post("agent", null)).status).toBe(403);
  });

  it("sends an unknown role back to /demo with a fixed message code", async () => {
    const res = await post("root");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${origin}/demo?error=unavailable`);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
