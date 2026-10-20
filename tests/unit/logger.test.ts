import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "@/server/platform/logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, logger: createLogger({ level: "info" }, stream) };
}

describe("logger redaction (NFR-OBS1)", () => {
  it("redacts secrets and PII at top level and one level deep", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        password: "hunter2",
        token: "tok_123",
        email: "jane@example.com",
        user: { email: "x@example.com", password: "p", id: "u1" },
        headers: { authorization: "Bearer abc", cookie: "sid=1", "user-agent": "test" },
        body: "customer message with PII",
        prompt: "system prompt text",
      },
      "event",
    );
    const line = lines[0]!;
    const serialized = JSON.stringify(line);
    for (const secret of [
      "hunter2",
      "tok_123",
      "jane@example.com",
      "x@example.com",
      "Bearer abc",
      "sid=1",
      "customer message",
      "system prompt",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect((line.user as Record<string, unknown>).id).toBe("u1");
    expect((line.headers as Record<string, unknown>)["user-agent"]).toBe("test");
  });

  it("emits structured JSON with level label, ISO time and service name", () => {
    const { lines, logger } = capture();
    logger.warn({ requestId: "r1" }, "hello");
    expect(lines[0]).toMatchObject({ level: "warn", msg: "hello", requestId: "r1", service: "supportpilot" });
    expect(typeof lines[0]!.time).toBe("string");
  });

  it("child loggers keep redaction", () => {
    const { lines, logger } = capture();
    logger.child({ requestId: "r2" }).info({ apiKey: "sk-live" }, "x");
    expect(JSON.stringify(lines[0])).not.toContain("sk-live");
  });
});
