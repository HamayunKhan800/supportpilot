import { describe, expect, it } from "vitest";
import { Errors } from "@/server/platform/errors";
import { withRoute } from "@/server/platform/http";

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/thing", { headers });

describe("withRoute", () => {
  it("passes through successful responses and adds x-request-id", async () => {
    const handler = withRoute("t", async () => Response.json({ ok: true }, { status: 201 }));
    const res = await handler(req());
    expect(res.status).toBe(201);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("reuses a valid incoming request id", async () => {
    const handler = withRoute("t", async (_r, ctx) => Response.json({ id: ctx.requestId }));
    const res = await handler(req({ "x-request-id": "client-req-0001" }));
    expect(res.headers.get("x-request-id")).toBe("client-req-0001");
    expect(await res.json()).toEqual({ id: "client-req-0001" });
  });

  it("resolves Next.js params promise", async () => {
    const handler = withRoute<{ id: string }>("t", async (_r, ctx) => Response.json(ctx.params));
    const res = await handler(req(), { params: Promise.resolve({ id: "42" }) });
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("maps AppError to problem+json", async () => {
    const handler = withRoute("t", async () => {
      throw Errors.notFound();
    });
    const res = await handler(req({ "x-request-id": "client-req-0002" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({
      status: 404,
      requestId: "client-req-0002",
      instance: "/api/v1/thing",
    });
  });

  it("maps unknown errors to a generic 500 without leaking details", async () => {
    const handler = withRoute("t", async () => {
      throw new Error("secret internal detail");
    });
    const res = await handler(req());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret internal detail");
  });
});

describe("withRoute deliberate 5xx and validation errors", () => {
  it("returns 503 problem for a deliberate dependency failure", async () => {
    const handler = withRoute("t", async () => {
      throw Errors.serviceUnavailable("A required dependency is unavailable.");
    });
    const res = await handler(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 503, detail: "A required dependency is unavailable." });
  });

  it("returns 400 with field errors when a Zod schema rejects input", async () => {
    const { z } = await import("zod");
    const handler = withRoute("t", async () => {
      z.object({ subject: z.string().min(3) }).parse({ subject: "x" });
      return new Response(null, { status: 204 });
    });
    const res = await handler(req());
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toHaveProperty("subject");
  });
});
