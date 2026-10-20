import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, Errors, problemResponse, toProblem } from "@/server/platform/errors";

describe("errors → RFC 9457 problem details (NFR-SEC3)", () => {
  it("maps AppError with requestId and instance", () => {
    const p = toProblem(Errors.notFound(), { requestId: "rid", instance: "/api/v1/tickets/1" });
    expect(p).toMatchObject({
      status: 404,
      title: "Not Found",
      requestId: "rid",
      instance: "/api/v1/tickets/1",
    });
    expect(p.type).toMatch(/\/not_found$/);
  });

  it("includes field errors for bad requests", () => {
    const p = toProblem(Errors.badRequest("bad", { subject: ["Required"] }));
    expect(p.errors).toEqual({ subject: ["Required"] });
  });

  it("maps ZodError to 400 with per-field messages", () => {
    const schema = z.object({ email: z.email(), age: z.number().min(18) });
    const r = schema.safeParse({ email: "nope", age: 3 });
    const p = toProblem(r.error);
    expect(p.status).toBe(400);
    expect(Object.keys(p.errors ?? {})).toEqual(expect.arrayContaining(["email", "age"]));
  });

  it("hides internal details of unknown errors", () => {
    const p = toProblem(new Error("connection to 10.0.0.5 failed: password authentication failed"));
    expect(p.status).toBe(500);
    expect(JSON.stringify(p)).not.toContain("10.0.0.5");
    expect(JSON.stringify(p)).not.toContain("password");
  });

  it("problemResponse sets content-type, status and no-store", async () => {
    const res = problemResponse(toProblem(new AppError(409, "conflict", "Conflict", "dup")));
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ detail: "dup" });
  });
});

describe("Errors factory status mapping", () => {
  it.each([
    ["unauthorized", Errors.unauthorized(), 401],
    ["forbidden", Errors.forbidden(), 403],
    ["notFound", Errors.notFound(), 404],
    ["conflict", Errors.conflict("dup"), 409],
    ["tooManyRequests", Errors.tooManyRequests(), 429],
    ["serviceUnavailable", Errors.serviceUnavailable("db down"), 503],
  ])("%s → %i", (_name, err, status) => {
    expect(err).toBeInstanceOf(AppError);
    expect(toProblem(err).status).toBe(status);
  });
});
