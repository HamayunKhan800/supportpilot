import { describe, expect, it } from "vitest";

/** Runs against a real, running server (local `next start`, Docker container, or a deployed URL). */
const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const get = (path: string, init?: RequestInit) =>
  fetch(new URL(path, BASE_URL), { redirect: "manual", ...init });

describe(`smoke: ${BASE_URL}`, () => {
  it("GET /api/health → 200 ok, no-store, request id", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("GET /api/ready → 200 with database ok", async () => {
    const res = await get("/api/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready", checks: { database: { status: "ok" } } });
  });

  it("health responses are not cached between requests (served live)", async () => {
    const a = await get("/api/health");
    const b = await get("/api/health");
    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
  });

  it("echoes a safe client request id", async () => {
    const res = await get("/api/health", { headers: { "x-request-id": "smoke-test-0001" } });
    expect(res.headers.get("x-request-id")).toBe("smoke-test-0001");
  });

  it("home page renders with baseline security headers and no X-Powered-By", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SupportPilot");
    expect(res.headers.get("content-security-policy")).toMatch(/frame-ancestors/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("unknown API route → 404", async () => {
    expect((await get("/api/does-not-exist")).status).toBe(404);
  });
});
