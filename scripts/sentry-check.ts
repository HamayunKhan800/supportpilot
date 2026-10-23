/**
 * Sends one test error to Sentry through the same path the app uses (our options, scrubber and
 * reporter), to confirm a DSN works (docs/observability.md):
 *
 *   SENTRY_DSN=https://...ingest.sentry.io/... pnpm sentry:check
 *
 * The event says "SupportPilot Sentry check" and is tagged route=sentry-check, so it is easy to
 * find under Issues and safe to resolve. Exits 1 unless Sentry answered with HTTP 2xx.
 */
import * as Sentry from "@sentry/node";

import { reportError, setErrorReporter } from "../src/server/platform/error-reporting";
import { buildSentryOptions, sentryReporter } from "../src/server/platform/telemetry/sentry";

async function main(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || !dsn.startsWith("https://")) {
    throw new Error("Set SENTRY_DSN to the https:// DSN from Sentry (Project Settings > Client Keys).");
  }

  // Sentry.close() reports true once its queue is empty, even when sending failed, so the result
  // is taken from the real transport's HTTP response instead.
  let response: { statusCode?: number } | undefined;
  let sendError: unknown;
  const transport: NonNullable<Sentry.NodeOptions["transport"]> = (transportOptions) => {
    const real = Sentry.makeNodeTransport(transportOptions);
    return {
      ...real,
      send: async (envelope) => {
        try {
          response = await real.send(envelope);
          return response;
        } catch (err) {
          sendError = err;
          throw err;
        }
      },
    };
  };
  Sentry.init({
    ...buildSentryOptions(
      {
        SENTRY_DSN: dsn,
        SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || "sentry-check",
        NODE_ENV: "production",
      },
      () => Sentry.openTelemetryIntegration(),
    ),
    transport,
  });
  let eventId: string | undefined;
  setErrorReporter(
    sentryReporter((err, hint) => {
      eventId = Sentry.captureException(err, hint);
    }),
  );

  reportError(new Error(`SupportPilot Sentry check ${new Date().toISOString()}`), {
    route: "sentry-check",
    requestId: "sentry-check",
  });
  await Sentry.close(10_000);
  const status = response?.statusCode;
  if (!eventId || status === undefined || status < 200 || status >= 300) {
    const reason =
      sendError instanceof Error ? sendError.message : status ? `HTTP ${status}` : "no response in 10 s";
    throw new Error(`Sentry did not accept the event (${reason}). Check the DSN and the network.`);
  }
  console.log(`Sentry accepted event ${eventId} (HTTP ${status}). Open Issues: "SupportPilot Sentry check".`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
