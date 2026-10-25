import { describe, expect, it, vi } from "vitest";
import { setErrorReporter } from "@/server/platform/error-reporting";
import { Errors } from "@/server/platform/errors";
import { withRoute } from "@/server/platform/http";
import { logger } from "@/server/platform/logger";

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

  it("logs the error's cause, e.g. the database's reason under a query wrapper (M7-19)", async () => {
    const error = vi.fn();
    const child = vi
      .spyOn(logger, "child")
      .mockReturnValue({ error, warn: vi.fn(), info: vi.fn() } as unknown as ReturnType<typeof logger.child>);
    try {
      const handler = withRoute("t", async () => {
        throw new Error("Failed query", {
          cause: new Error("invalid byte sequence for encoding UTF8: 0x00"),
        });
      });
      expect((await handler(req())).status).toBe(500);
      const logged = error.mock.calls[0]![0] as { err: { cause?: { message: string } } };
      expect(logged.err.cause?.message).toMatch(/invalid byte sequence/);
    } finally {
      child.mockRestore();
    }
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

describe("withRoute error reporting (plan M6 D9)", () => {
  it("reports an unexpected error with the route name and request id, and nothing else", async () => {
    const reports: Array<[unknown, unknown]> = [];
    setErrorReporter((err, ctx) => void reports.push([err, ctx]));
    try {
      const boom = new Error("database exploded");
      const res = await withRoute("tickets.list", async () => {
        throw boom;
      })(new Request("http://x/api/v1/tickets", { headers: { "x-request-id": "req-12345678" } }));
      expect(res.status).toBe(500);
      expect(reports).toEqual([[boom, { route: "tickets.list", requestId: "req-12345678" }]]);
    } finally {
      setErrorReporter(undefined);
    }
  });

  it("does not report expected errors (4xx, deliberate 5xx)", async () => {
    const reports: unknown[] = [];
    setErrorReporter((err) => void reports.push(err));
    try {
      await withRoute("t", async () => {
        throw Errors.notFound();
      })(new Request("http://x/"));
      await withRoute("t", async () => {
        throw Errors.serviceUnavailable("db");
      })(new Request("http://x/"));
      expect(reports).toEqual([]);
    } finally {
      setErrorReporter(undefined);
    }
  });
});
