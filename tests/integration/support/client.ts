import { getDb } from "@/server/platform/db/client";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct horse battery staple";

type Handler = (req: Request) => Promise<Response>;

/** Minimal browser stand-in: a cookie jar plus JSON requests to /api/auth/*. */
export class TestClient {
  readonly cookies = new Map<string, string>();
  constructor(
    private readonly handler: Handler,
    private readonly ip = "203.0.113.10",
  ) {}

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; query?: Record<string, string>; origin?: string | null } = {},
  ) {
    const url = new URL(`/api/auth${path}`, ORIGIN);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers = new Headers({ "x-forwarded-for": this.ip });
    if (opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
    if (this.cookies.size) headers.set("cookie", this.cookieHeader);
    if (opts.body !== undefined) headers.set("content-type", "application/json");
    const res = await this.handler(
      new Request(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i);
      const value = pair!.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON in test assertions
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  post(path: string, body: unknown = {}, opts: { origin?: string | null } = {}) {
    return this.request("POST", path, { body, ...opts });
  }
  get(path: string, query?: Record<string, string>) {
    return this.request("GET", path, { query });
  }

  /** Request headers as a server component would see them. */
  get headers() {
    return new Headers({ cookie: this.cookieHeader });
  }
}

export async function signUpAndIn(handler: Handler, email: string, name = email.split("@")[0]!) {
  const client = new TestClient(handler);
  const up = await client.post("/sign-up/email", { email, password: PASSWORD, name });
  if (up.status !== 200) throw new Error(`sign-up failed: ${up.status} ${JSON.stringify(up.json)}`);
  const inRes = await client.post("/sign-in/email", { email, password: PASSWORD });
  if (inRes.status !== 200) throw new Error(`sign-in failed: ${inRes.status} ${JSON.stringify(inRes.json)}`);
  return client;
}

export async function resetDatabase() {
  const { pool } = getDb();
  await pool.query(
    `TRUNCATE "audit_log", "workspace_settings", "invitation", "member", "organization",
       "session", "account", "verification", "rate_limit", "user", "ticket_message", "ticket",
       "ticket_counter", "app_rate_limit" RESTART IDENTITY CASCADE`,
  );
}
