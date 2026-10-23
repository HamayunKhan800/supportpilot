import { Writable } from "node:stream";

import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createLogger } from "@/server/platform/logger";
import { redactQueryValues, redactStack, serializeErrorForLog } from "@/server/platform/query-errors";
import { scrubText } from "@/server/platform/telemetry/sentry";

/** Finding #122: failed queries carry their values in the error message and stack. */
const SQL = 'insert into "ticket_message" ("ticket_id", "body", "author_email") values ($1, $2, $3)';
const PRIVATE = "Kestrel invoice QZ-90817, card charged twice";
const EMAIL = "philippa@example.test";

function queryError(params: unknown[]) {
  return new DrizzleQueryError(SQL, params, new Error("connect ECONNREFUSED 127.0.0.1:5432"));
}

describe("redactQueryValues", () => {
  it("keeps the SQL and replaces Drizzle's values", () => {
    const err = queryError(["3f2b8c1e-9a4d-4c2b-8e1f-0a9b8c7d6e5f", PRIVATE, EMAIL]);
    expect(err.message).toContain(PRIVATE); // the problem being fixed
    expect(redactQueryValues(err.message)).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
  });

  it("replaces values that span lines", () => {
    const err = queryError([`${PRIVATE}\nsecond line\n    at not.a.frame (x.js:1:1)`]);
    expect(redactQueryValues(err.message)).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
  });

  it("replaces the value Postgres quotes in a conversion error, including doubled quotes", () => {
    expect(redactQueryValues(`invalid input syntax for type integer: "${PRIVATE}"`)).toBe(
      'invalid input syntax for type integer: "[redacted]"',
    );
    expect(redactQueryValues('invalid input value for enum ticket_status: "say ""hi"" Kestrel"')).toBe(
      'invalid input value for enum ticket_status: "[redacted]"',
    );
  });

  it("leaves other messages alone", () => {
    for (const msg of [
      "division by zero",
      "connect ECONNREFUSED 127.0.0.1:5432",
      'relation "x" does not exist',
    ]) {
      expect(redactQueryValues(msg)).toBe(msg);
    }
  });
});

describe("redactStack", () => {
  it("replaces the message at the top of a real stack, frames kept", () => {
    const err = queryError([`${PRIVATE}\n    at fake.frame (evil.js:1:1)`, "$& $1 $$"]);
    const stack = redactStack(err.stack!, err.message);
    expect(stack.startsWith(`Error: Failed query: ${SQL}\nparams: [redacted]\n    at `)).toBe(true);
    expect(stack).not.toContain("Kestrel");
    expect(stack).not.toContain("evil.js");
    expect(stack).toContain("query-errors.test.ts"); // real frames survive
  });

  it("falls back to cutting up to the first frame when the message is unknown", () => {
    const stack = `Error: Failed query: ${SQL}\nparams: ${PRIVATE}\n    at a (b.js:1:1)`;
    expect(redactStack(stack)).toBe(`Error: Failed query: ${SQL}\nparams: [redacted]\n    at a (b.js:1:1)`);
  });
});

describe("serializeErrorForLog", () => {
  it("drops Drizzle's params, query and cause from an Error", () => {
    const out = serializeErrorForLog(queryError([PRIVATE, EMAIL])) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["message", "name", "stack", "type"]);
    expect(out.type).toBe("DrizzleQueryError");
    expect(JSON.stringify(out)).not.toContain("Kestrel");
    expect(JSON.stringify(out)).not.toContain(EMAIL);
  });

  it("handles the plain { message } objects the app logs, and non-objects", () => {
    const err = queryError([PRIVATE]);
    expect(serializeErrorForLog({ message: err.message, digest: "d1" })).toEqual({
      message: `Failed query: ${SQL}\nparams: [redacted]`,
      digest: "d1",
    });
    expect(serializeErrorForLog("plain string")).toBe("plain string");
    expect(serializeErrorForLog(null)).toBeNull();
  });
});

describe("where it is applied", () => {
  it("the logger's err serializer", () => {
    const lines: string[] = [];
    const logger = createLogger(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      }),
    );
    const err = queryError([PRIVATE, EMAIL]);
    logger.error({ err }, "as an Error");
    logger.error({ err: { name: err.name, message: err.message, stack: err.stack } }, "as http.ts logs it");
    logger.error({ err: { message: err.message } }, "message only");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).not.toContain("Kestrel");
      expect(line).not.toContain(EMAIL);
      expect(line).toContain("params: [redacted]");
    }
  });

  it("the Sentry scrubber", () => {
    expect(scrubText(queryError([PRIVATE]).message)).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
  });
});
