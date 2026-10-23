import type { Attributes } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

import { SPAN_ATTRIBUTES } from "./spans";

/**
 * Every span passes through here before it leaves the process (plan M6 D8; ADR-0018). It is an
 * allowlist, so anything not listed is dropped, including attributes a future library adds:
 *
 * - Next.js records `http.target` (the raw path and query) on each request span
 *   (Next.js OpenTelemetry guide, "Default Spans"). Paths can hold secrets, such as a
 *   customer's ticket link `/t/<token>` or a password-reset token, so only the route
 *   *pattern* (`next.route`, `http.route`) is kept.
 * - Span names that contain a path or URL are rebuilt from the route pattern or the host.
 * - Status messages and event attributes other than `exception.type` are dropped (an
 *   exception's message and stack can quote user input).
 */
const NEXT_ATTRIBUTES = [
  "http.method",
  "http.request.method",
  "http.status_code",
  "http.response.status_code",
  "http.route",
  "next.route",
  "next.span_type",
  "next.rsc",
  "next.page",
  "next.segment",
  "net.peer.name",
  "server.address",
] as const;

export const ALLOWED_SPAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...NEXT_ATTRIBUTES,
  ...Object.values(SPAN_ATTRIBUTES),
]);

const URL_PATTERN = /\bhttps?:\/\/([^/\s?#]+)[^\s]*/g;
const PATH_PATTERN = /(^|\s)\/[^\s]*/g;

function routeOf(attributes: Attributes): string | undefined {
  const route = attributes["next.route"] ?? attributes["http.route"];
  return typeof route === "string" ? route : undefined;
}

/** `GET /t/abc123?x=1` → `GET /t/[token]`; `fetch GET https://host/p?k=v` → `fetch GET https://host`. */
export function sanitizeSpanName(name: string, attributes: Attributes): string {
  const route = routeOf(attributes);
  const withoutUrls = name.replace(URL_PATTERN, (_match, host: string) => `https://${host}`);
  return withoutUrls.replace(PATH_PATTERN, (_match, lead: string) => `${lead}${route ?? "/[path]"}`);
}

export function sanitizeAttributes(attributes: Attributes): { kept: Attributes; dropped: number } {
  const kept: Attributes = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(attributes)) {
    if (ALLOWED_SPAN_ATTRIBUTES.has(key)) kept[key] = value;
    else dropped++;
  }
  return { kept, dropped };
}

export function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const { kept, dropped } = sanitizeAttributes(span.attributes);
  const events = span.events
    .filter((event) => event.name === "exception")
    .map((event) => {
      const type = event.attributes?.["exception.type"];
      return {
        name: event.name,
        time: event.time,
        attributes: typeof type === "string" ? { "exception.type": type } : {},
      };
    });
  return {
    name: sanitizeSpanName(span.name, span.attributes),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: kept,
    links: span.links.map((link) => ({ context: link.context })),
    events,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount + dropped,
    droppedEventsCount: span.droppedEventsCount + (span.events.length - events.length),
    droppedLinksCount: span.droppedLinksCount,
  };
}

/** Wraps the real exporter (OTLP in production, in-memory in tests) with sanitizeSpan. */
export class RedactingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans.map(sanitizeSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
