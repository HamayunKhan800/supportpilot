import type { ErrorEvent } from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportError, setErrorReporter } from "@/server/platform/error-reporting";
import {
  buildSentryOptions,
  DROPPED_SENTRY_INTEGRATIONS,
  scrubBreadcrumb,
  scrubSentryEvent,
  scrubText,
  sentryReporter,
} from "@/server/platform/telemetry/sentry";

// A fake 43-character value shaped like a tracking token, built at run time so secret scanners
// do not mistake it for a real credential.
const TOKEN = ["Zk3pQ9vX2mL7", "cR4tY8nB1wE6", "hJ0sD5fA3gK9uI2oP7q"].join("");

describe("scrubText (M6 D9)", () => {
  it("removes emails, query strings and token-like strings", () => {
    expect(scrubText(`failed for jane.doe+x@example.co.uk at /t/${TOKEN}?ref=mail`)).toBe(
      "failed for [email] at /t/[token]?[query]",
    );
  });

  it("keeps ordinary messages, UUIDs and codes readable", () => {
    const msg = "ticket 3f2b8c1e-9a4d-4c2b-8e1f-0a9b8c7d6e5f not found (23505)";
    expect(scrubText(msg)).toBe(msg);
  });

  it("removes a token next to a UUID and keeps the UUID", () => {
    expect(scrubText(`draft 3f2b8c1e-9a4d-4c2b-8e1f-0a9b8c7d6e5f for ${TOKEN} failed`)).toBe(
      "draft 3f2b8c1e-9a4d-4c2b-8e1f-0a9b8c7d6e5f for [token] failed",
    );
  });
});

describe("event names (finding #123)", () => {
  const base: ErrorEvent = { type: undefined, transaction: "POST /api/v1/portal/kestrel-private/tickets" };

  it("uses the route the app reported instead of the real path", () => {
    expect(scrubSentryEvent({ ...base, tags: { route: "createPortalTicket" } }).transaction).toBe(
      "createPortalTicket",
    );
    expect(
      scrubSentryEvent({ ...base, transaction: `GET /t/${TOKEN}`, tags: { route: "/t/[token]" } })
        .transaction,
    ).toBe("/t/[token]");
  });

  it("uses the job for a job error, and hides the path when neither is known", () => {
    expect(scrubSentryEvent({ ...base, tags: { job: "ai.triage" } }).transaction).toBe("job ai.triage");
    expect(scrubSentryEvent(base).transaction).toBe("POST /[path]");
    expect(scrubSentryEvent({ type: undefined }).transaction).toBeUndefined();
  });
});

describe("scrubSentryEvent", () => {
  const event: ErrorEvent = {
    type: undefined,
    message: "boom for jane@example.com",
    transaction: `GET /t/${TOKEN}`,
    server_name: "web-1.internal",
    user: { id: "u1", email: "jane@example.com", ip_address: "203.0.113.9" },
    request: {
      method: "POST",
      url: `https://app.example/t/${TOKEN}?x=1`,
      data: { message: "my card was charged twice" },
      cookies: { session: "s" },
      headers: { cookie: "session=s", authorization: "Bearer abc" },
      query_string: "x=1",
    },
    exception: { values: [{ type: "Error", value: `bad token ${TOKEN} from jane@example.com` }] },
    breadcrumbs: [
      { category: "console", message: "customer text" },
      {
        category: "http",
        data: { method: "GET", url: `https://api.example/x?key=${TOKEN}`, status_code: 500, body: "x" },
      },
    ],
  };

  it("drops the request body, headers, cookies, query and the user", () => {
    const out = scrubSentryEvent(event);
    expect(out.request).toEqual({ method: "POST" });
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
  });

  it("scrubs the message, transaction, exception values and breadcrumbs", () => {
    const out = scrubSentryEvent(event);
    const json = JSON.stringify(out);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("jane@");
    expect(json).not.toContain("charged twice");
    expect(json).not.toContain("customer text");
    expect(out.transaction).toBe("GET /[path]"); // no route tag: the path is hidden
    expect(out.exception?.values?.[0]?.value).toBe("bad token [token] from [email]");
    expect(out.breadcrumbs).toEqual([
      {
        category: "http",
        message: undefined,
        data: { method: "GET", status_code: 500, url: "https://api.example/x?[query]" },
      },
    ]);
  });

  it("does not modify the original event", () => {
    scrubSentryEvent(event);
    expect(event.request?.data).toEqual({ message: "my card was charged twice" });
  });

  it("drops console breadcrumbs as they are recorded", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(scrubBreadcrumb({ category: "navigation", message: `to /t/${TOKEN}` })).toEqual({
      category: "navigation",
      message: "to /t/[token]",
      data: undefined,
    });
  });
});

describe("buildSentryOptions", () => {
  const otel = { name: "OpenTelemetry", setupOnce: () => {} };
  const options = buildSentryOptions(
    { SENTRY_DSN: "https://key@o1.ingest.sentry.io/1", NODE_ENV: "production" },
    () => otel,
  );

  it("collects no personal data and leaves tracing to OpenTelemetry", () => {
    expect(options.enableOpenTelemetrySetup).toBe(false);
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("tracesSampler");
    expect(options.environment).toBe("production");
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 5,
    });
  });

  it("removes data-collecting integrations and adds OpenTelemetry linking", () => {
    const defaults = [
      "Dedupe",
      "RequestData",
      "Console",
      "LocalVariablesAsync",
      "Http",
      "ConversationId",
    ].map((name) => ({ name, setupOnce: () => {} }));
    const integrations = options.integrations as (d: typeof defaults) => { name: string }[];
    expect(integrations(defaults).map((i) => i.name)).toEqual(["Dedupe", "Http", "OpenTelemetry"]);
    expect(DROPPED_SENTRY_INTEGRATIONS.has("LocalVariables")).toBe(true);
  });

  it("uses SENTRY_ENVIRONMENT when set", () => {
    const o = buildSentryOptions(
      { SENTRY_DSN: "https://k@o1.ingest.sentry.io/1", SENTRY_ENVIRONMENT: "demo", NODE_ENV: "production" },
      () => otel,
    );
    expect(o.environment).toBe("demo");
  });
});

describe("error reporting hook", () => {
  afterEach(() => setErrorReporter(undefined));

  it("does nothing until a reporter is set", () => {
    expect(() => reportError(new Error("x"), { route: "r" })).not.toThrow();
  });

  it("passes only safe tags to Sentry", () => {
    const capture = vi.fn();
    setErrorReporter(sentryReporter(capture));
    const err = new Error("boom");
    reportError(err, { route: "tickets.create", requestId: "req-1", job: "ai.triage", jobId: "j1" });
    expect(capture).toHaveBeenCalledWith(err, {
      tags: { route: "tickets.create", request_id: "req-1", job: "ai.triage", job_id: "j1" },
    });
  });

  it("never throws, even when the reporter does", () => {
    setErrorReporter(() => {
      throw new Error("sentry down");
    });
    expect(() => reportError(new Error("x"))).not.toThrow();
  });
});
