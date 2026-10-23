import { randomBytes } from "node:crypto";

import * as Sentry from "@sentry/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reportError, setErrorReporter } from "@/server/platform/error-reporting";
import { buildSentryOptions, sentryReporter } from "@/server/platform/telemetry/sentry";

/**
 * Plan M6 D9 against the real Sentry SDK (not just our functions): init with our options and a
 * transport that keeps envelopes in memory instead of sending them, report an error the way the
 * app does, and inspect exactly what would have gone to sentry.io.
 */
// Built at runtime, like real customer data: Sentry also sends the source lines around each
// stack frame (frameContextLines), so a value written literally in this file would show up there.
const TOKEN = randomBytes(32).toString("base64url");
const EMAIL = ["jane", "example.com"].join("@");
const CUSTOMER_MESSAGE = ["my card was", "charged", "twice"].join(" ");
const envelopes: string[] = [];

beforeAll(() => {
  const options = buildSentryOptions(
    { SENTRY_DSN: "https://publicKey@o0.ingest.sentry.io/1", SENTRY_ENVIRONMENT: "test", NODE_ENV: "test" },
    () => Sentry.openTelemetryIntegration(),
  );
  Sentry.init({
    ...options,
    transport: (transportOptions) =>
      Sentry.createTransport(transportOptions, async (request) => {
        envelopes.push(
          typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
  });
  setErrorReporter(sentryReporter((err, hint) => Sentry.captureException(err, hint)));
});

afterAll(async () => {
  setErrorReporter(undefined);
  await Sentry.close(2_000);
});

function events(): Array<Record<string, unknown>> {
  return envelopes.flatMap((envelope) => {
    const lines = envelope.split("\n");
    const out: Array<Record<string, unknown>> = [];
    for (let i = 1; i < lines.length - 1; i++) {
      const header = JSON.parse(lines[i]!) as { type?: string };
      if (header.type === "event") out.push(JSON.parse(lines[i + 1]!) as Record<string, unknown>);
    }
    return out;
  });
}

describe("Sentry SDK with the app's options", () => {
  it("removes the data-collecting integrations from the running client", () => {
    const names = (Sentry.getClient()?.getOptions().integrations ?? []).map((i) => i.name);
    expect(names).toContain("OpenTelemetry");
    for (const dropped of ["RequestData", "Console", "LocalVariables", "LocalVariablesAsync"]) {
      expect(names).not.toContain(dropped);
    }
  });

  it("sends a scrubbed event with safe tags only", async () => {
    // Data an error report must not carry: a token and customer text in local variables, and a
    // token and an email in the error message.
    const run = (secretToken: string, message: string, email: string) => {
      if (message) throw new Error(`token ${secretToken} rejected for ${email}`);
    };
    try {
      run(TOKEN, CUSTOMER_MESSAGE, EMAIL);
    } catch (err) {
      reportError(err, { route: "portal.reply", requestId: "req-abc12345" });
    }
    await Sentry.flush(2_000);

    const [event] = events();
    expect(event).toBeDefined();
    const json = JSON.stringify(event);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain(CUSTOMER_MESSAGE);
    expect(event).not.toHaveProperty("request");
    expect(event).not.toHaveProperty("user");
    expect(event).not.toHaveProperty("server_name");
    expect(event!.environment).toBe("test");
    expect(event!.tags).toMatchObject({ route: "portal.reply", request_id: "req-abc12345" });
    const exception = (
      event!.exception as { values: Array<{ value: string; stacktrace?: { frames?: object[] } }> }
    ).values[0]!;
    expect(exception.value).toBe("token [token] rejected for [email]");
    // Stack frames and their source lines are kept for debugging, without local variable values.
    const frames = exception.stacktrace?.frames as Array<{ context_line?: string; vars?: object }>;
    expect(frames.some((f) => f.context_line?.includes("run(TOKEN, CUSTOMER_MESSAGE, EMAIL)"))).toBe(true);
    expect(frames.every((f) => f.vars === undefined)).toBe(true);
  });
});
