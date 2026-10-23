import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  TracerProvider,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import { RedactingSpanExporter } from "./exporter";

/**
 * Starts OpenTelemetry tracing for one process (plan M6 D7; ADR-0018). Off unless an OTLP
 * endpoint is configured with the standard variables `OTEL_EXPORTER_OTLP_ENDPOINT` or
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (see tracesUrl). The exporter itself reads
 * `OTEL_EXPORTER_OTLP_HEADERS` for a backend that needs a key.
 *
 * Set up by hand rather than with NodeSDK or @vercel/otel: no automatic library
 * instrumentation (which records SQL and URLs), no resource detectors (which record the host
 * and the process's command line), and one place, RedactingSpanExporter, that every span
 * passes through. The Next.js server's own request spans and the app's spans (./spans.ts) are
 * enough to see where time goes.
 *
 * No propagator is registered: nothing here continues a trace across services, so incoming
 * `traceparent` headers are ignored and outgoing requests (to the AI provider) get none.
 *
 * Call it before Sentry.init (Sentry's guide for an existing OpenTelemetry setup).
 */
export interface TracingOptions {
  serviceName: "supportpilot-web" | "supportpilot-worker" | (string & {});
  serviceVersion?: string;
  /** The process environment, or a test's. */
  env?: Record<string, string | undefined>;
  /** Tests: export here (synchronously) instead of over OTLP. */
  exporter?: SpanExporter;
}

export interface Tracing {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export function tracingEndpointConfigured(env: Record<string, string | undefined>): boolean {
  return tracesUrl(env) !== undefined;
}

/**
 * The traces URL, as the OpenTelemetry exporter spec defines it: the signal-specific variable is
 * used as is; the base endpoint gets `v1/traces` appended.
 */
export function tracesUrl(env: Record<string, string | undefined>): string | undefined {
  if (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/v1/traces`;
}

export function startTracing(options: TracingOptions): Tracing | null {
  const url = tracesUrl(options.env ?? process.env);
  if (!options.exporter && !url) return null;

  const exporter = new RedactingSpanExporter(options.exporter ?? new OTLPTraceExporter({ url }));
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      ...(options.serviceVersion ? { [ATTR_SERVICE_VERSION]: options.serviceVersion } : {}),
    }),
    // Long values are cut, as a backstop; the attributes themselves are short metadata.
    spanLimits: { attributeValueLengthLimit: 256 },
    spanProcessors: [
      options.exporter ? new SimpleSpanProcessor({ exporter }) : new BatchSpanProcessor({ exporter }),
    ],
  });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);

  return {
    forceFlush: () => provider.forceFlush(),
    shutdown: async () => {
      await provider.shutdown();
      trace.disable();
      context.disable();
    },
  };
}
