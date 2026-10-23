import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import * as Sentry from "@sentry/node";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/platform/db/client";
import { setErrorReporter } from "@/server/platform/error-reporting";
import { withRoute } from "@/server/platform/http";
import { createLogger, logger } from "@/server/platform/logger";
import { buildSentryOptions, sentryReporter } from "@/server/platform/telemetry/sentry";

/**
 * Finding #122, end to end: a real failed query inside a route handler, through the real logger
 * and the real Sentry SDK (with a transport that keeps the envelope in memory). Neither the log
 * line nor the Sentry event may contain the values the query carried, including the copy
 * Postgres quotes in its own message (Sentry sends the error's cause as a linked exception).
 */
const PRIVATE = "Kestrel invoice QZ-90817 charged twice";
const EMAIL = "philippa.wobbegong@example.test";
const envelopes: string[] = [];
const logLines: string[] = [];

beforeAll(() => {
  Sentry.init({
    ...buildSentryOptions({ SENTRY_DSN: "https://publicKey@o0.ingest.sentry.io/1", NODE_ENV: "test" }, () =>
      Sentry.openTelemetryIntegration(),
    ),
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        envelopes.push(
          typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
  });
  setErrorReporter(sentryReporter((err, hint) => Sentry.captureException(err, hint)));
  const capture = createLogger(
    { level: "info" },
    new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString());
        cb();
      },
    }),
  );
  vi.spyOn(logger, "child").mockImplementation((bindings) => capture.child(bindings));
});

afterAll(async () => {
  vi.restoreAllMocks();
  setErrorReporter(undefined);
  await Sentry.close(2_000);
});

async function failInRoute(run: () => Promise<unknown>) {
  envelopes.length = 0;
  logLines.length = 0;
  const route = withRoute("privacyProbe", async () => {
    await run();
    return new Response(null, { status: 204 });
  });
  const res = await route(new Request("http://localhost/api/v1/probe", { method: "POST" }));
  await Sentry.flush(2_000);
  return res;
}

describe("failed queries keep their values out of logs and Sentry (finding #122)", () => {
  it("a customer message that fails to save", async () => {
    const { db } = getDb();
    const res = await failInRoute(() =>
      // No such workspace or ticket: a foreign key violation, with the body and email as values.
      db.execute(
        sql`insert into ticket_message (id, workspace_id, ticket_id, author_type, body) values (${randomUUID()}, ${EMAIL}, ${randomUUID()}, 'customer', ${PRIVATE})`,
      ),
    );
    expect(res.status).toBe(500);

    const log = logLines.find((l) => l.includes("unhandled error in route"))!;
    expect(log).toContain("Failed query: insert into ticket_message");
    expect(log).toContain("params: [redacted]");
    const event = envelopes.join("\n");
    expect(event).toContain("Failed query: insert into ticket_message");
    for (const text of [log, event]) {
      expect(text).not.toContain("Kestrel");
      expect(text).not.toContain(EMAIL);
    }
  });

  it("a value Postgres quotes in its own error message", async () => {
    const { db } = getDb();
    const res = await failInRoute(() => db.execute(sql`select ${PRIVATE}::int`));
    expect(res.status).toBe(500);

    const event = envelopes.join("\n");
    // The linked cause is present (useful for debugging) but its value is replaced.
    expect(event).toContain('invalid input syntax for type integer: \\"[redacted]\\"');
    const log = logLines.find((l) => l.includes("unhandled error in route"))!;
    for (const text of [log, event]) expect(text).not.toContain("Kestrel");
  });
});
