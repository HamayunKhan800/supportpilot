import { Writable } from "node:stream";
import { SpanKind, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "@/server/platform/logger";
import {
  ALLOWED_SPAN_ATTRIBUTES,
  sanitizeAttributes,
  sanitizeSpan,
  sanitizeSpanName,
} from "@/server/platform/telemetry/exporter";
import {
  startTracing,
  tracesUrl,
  tracingEndpointConfigured,
  type Tracing,
} from "@/server/platform/telemetry/setup";
import { activeTraceIds, errorType, SPAN_ATTRIBUTES, withSpan } from "@/server/platform/telemetry/spans";

// A fake 43-character value shaped like a tracking token, built at run time so secret scanners
// do not mistake it for a real credential.
const TOKEN = ["Zk3pQ9vX2mL7", "cR4tY8nB1wE6", "hJ0sD5fA3gK9uI2oP7q"].join("");

function fakeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  const context = { traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 };
  return {
    name: "GET /t/" + TOKEN,
    kind: SpanKind.SERVER,
    spanContext: () => context,
    startTime: [1, 0],
    endTime: [2, 0],
    status: {
      code: SpanStatusCode.ERROR,
      message: "Customer jane@example.com wrote: my card was charged twice",
    },
    attributes: {
      "http.method": "GET",
      "http.status_code": 200,
      "http.target": `/t/${TOKEN}?ref=mail`,
      "http.url": `https://app.example/t/${TOKEN}`,
      "next.route": "/t/[token]",
      "next.span_type": "BaseServer.handleRequest",
      "db.statement": "select * from ticket where subject = 'refund please'",
      "gen_ai.prompt": "You are a support agent. Customer: my card was charged twice",
    },
    links: [{ context, attributes: { note: "secret" } }],
    events: [
      {
        name: "exception",
        time: [1, 5],
        attributes: {
          "exception.type": "TypeError",
          "exception.message": "bad input: my card was charged twice",
        },
      },
      { name: "log", time: [1, 6], attributes: { body: "customer text" } },
    ],
    duration: [1, 0],
    ended: true,
    resource: resourceFromAttributes({ "service.name": "test" }),
    instrumentationScope: { name: "next.js" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  };
}

describe("span name sanitizing (M6 D8)", () => {
  it("replaces a concrete path with the route pattern", () => {
    expect(sanitizeSpanName(`GET /t/${TOKEN}`, { "next.route": "/t/[token]" })).toBe("GET /t/[token]");
    expect(sanitizeSpanName(`render route (app) /t/${TOKEN}`, { "http.route": "/t/[token]" })).toBe(
      "render route (app) /t/[token]",
    );
  });

  it("hides a path when no route pattern is known", () => {
    expect(sanitizeSpanName("GET /reset-password?token=abc", {})).toBe("GET /[path]");
  });

  it("keeps only the host of a URL", () => {
    expect(
      sanitizeSpanName(
        "fetch POST https://generativelanguage.googleapis.com/v1beta/models/x:generate?alt=sse",
        {},
      ),
    ).toBe("fetch POST https://generativelanguage.googleapis.com");
  });

  it("leaves the app's own span names alone", () => {
    expect(sanitizeSpanName("ai draft", {})).toBe("ai draft");
    expect(sanitizeSpanName("job kb.ingest", {})).toBe("job kb.ingest");
  });
});

describe("attribute allowlist (M6 D8)", () => {
  it("keeps only allowed keys and counts the rest", () => {
    const { kept, dropped } = sanitizeAttributes({
      "http.method": "POST",
      "http.target": "/t/x",
      [SPAN_ATTRIBUTES.aiFeature]: "draft",
      "sp.ticket_subject": "anything not on the list",
    });
    expect(kept).toEqual({ "http.method": "POST", [SPAN_ATTRIBUTES.aiFeature]: "draft" });
    expect(dropped).toBe(2);
  });

  it("allows no text-bearing keys", () => {
    for (const key of ALLOWED_SPAN_ATTRIBUTES) {
      expect(key).not.toMatch(
        /target|url\.full|http\.url|query|statement|prompt|completion|message|body|content/,
      );
    }
  });

  it("sanitizes a whole span: name, attributes, status message, events and links", () => {
    const clean = sanitizeSpan(fakeSpan());
    const json = JSON.stringify({ ...clean, resource: undefined, spanContext: clean.spanContext() });
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("charged twice");
    expect(json).not.toContain("jane@");
    expect(json).not.toContain("refund please");
    expect(clean.name).toBe("GET /t/[token]");
    expect(clean.attributes).toEqual({
      "http.method": "GET",
      "http.status_code": 200,
      "next.route": "/t/[token]",
      "next.span_type": "BaseServer.handleRequest",
    });
    expect(clean.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(clean.events).toEqual([
      { name: "exception", time: [1, 5], attributes: { "exception.type": "TypeError" } },
    ]);
    expect(clean.links).toEqual([{ context: fakeSpan().spanContext() }]);
    expect(clean.droppedAttributesCount).toBe(4);
    expect(clean.droppedEventsCount).toBe(1);
    expect(clean.spanContext().traceId).toBe("a".repeat(32));
  });
});

describe("errorType", () => {
  it("uses a safe code, else the class name, never the message", () => {
    expect(errorType(Object.assign(new Error("Customer said x"), { code: "ai_timeout" }))).toBe("ai_timeout");
    expect(errorType(Object.assign(new Error("dup"), { code: "23505" }))).toBe("23505");
    expect(errorType(new TypeError("the customer's words"))).toBe("TypeError");
    expect(errorType(Object.assign(new Error("x"), { code: "has spaces and text" }))).toBe("Error");
    expect(errorType("a string")).toBe("unknown");
  });
});

describe("tracing setup", () => {
  it("is off unless an OTLP endpoint is configured", () => {
    expect(tracingEndpointConfigured({})).toBe(false);
    expect(tracingEndpointConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBe(false);
    expect(tracingEndpointConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" })).toBe(true);
    expect(tracingEndpointConfigured({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://c:4318/v1/traces" })).toBe(
      true,
    );
    expect(startTracing({ serviceName: "supportpilot-web", env: {} })).toBeNull();
  });

  it("builds the traces URL as the OpenTelemetry spec defines it", () => {
    expect(tracesUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" })).toBe(
      "http://localhost:4318/v1/traces",
    );
    expect(tracesUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example/base/" })).toBe(
      "https://otel.example/base/v1/traces",
    );
    expect(
      tracesUrl({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://ignored:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example/custom/path",
      }),
    ).toBe("https://collector.example/custom/path");
    expect(tracesUrl({})).toBeUndefined();
  });

  it("does nothing without a provider: spans are no-ops and logs get no ids", async () => {
    const result = await withSpan("off", {}, async (span) => {
      expect(span.isRecording()).toBe(false);
      return activeTraceIds();
    });
    expect(result).toEqual({});
  });

  it("starts an OTLP exporter when an endpoint is set, and shuts down cleanly", async () => {
    const otlp = startTracing({
      serviceName: "supportpilot-web",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9" },
    });
    expect(otlp).not.toBeNull();
    expect(trace.getTracer("x").startSpan("s").isRecording()).toBe(true);
    await otlp!.shutdown(); // nothing was ended, so nothing is sent
    expect(trace.getTracer("x").startSpan("s").isRecording()).toBe(false);
  });
});

describe("with tracing on", () => {
  const exporter = new InMemorySpanExporter();
  let tracing: Tracing;

  beforeAll(() => {
    tracing = startTracing({ serviceName: "supportpilot-test", exporter })!;
  });
  afterAll(async () => {
    await tracing.shutdown();
  });
  beforeEach(() => exporter.reset());

  it("exports spans through the redacting exporter", async () => {
    await withSpan("outer", { [SPAN_ATTRIBUTES.workspaceId]: "ws_1", "sp.secret_text": "no" }, async () => {
      trace.getActiveSpan()?.setAttribute("http.target", "/t/secret");
    });
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("outer");
    expect(span?.attributes).toEqual({ [SPAN_ATTRIBUTES.workspaceId]: "ws_1" });
    expect(span?.resource.attributes["service.name"]).toBe("supportpilot-test");
    // No resource detectors: no host name or command line.
    expect(
      Object.keys(span?.resource.attributes ?? {}).some(
        (k) => k.startsWith("process.") || k.startsWith("host."),
      ),
    ).toBe(false);
  });

  it("nests spans and marks a failure with error.type only", async () => {
    await expect(
      withSpan("outer", {}, () =>
        withSpan("inner", {}, async () => {
          throw Object.assign(new Error("customer wrote something private"), { code: "ai_unavailable" });
        }),
      ),
    ).rejects.toThrow("customer wrote");
    const spans = exporter.getFinishedSpans();
    const inner = spans.find((s) => s.name === "inner")!;
    const outer = spans.find((s) => s.name === "outer")!;
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
    expect(inner.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(inner.attributes).toEqual({ "error.type": "ai_unavailable" });
    expect(JSON.stringify(spans.map((s) => [s.attributes, s.events, s.status]))).not.toContain("private");
  });

  it("adds trace_id and span_id to log lines inside a span (NFR-OBS1)", async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(JSON.parse(chunk.toString()));
        cb();
      },
    });
    const logger = createLogger({ level: "info" }, stream);
    let ids: { traceId: string; spanId: string } | undefined;
    await withSpan("logged", {}, async (span) => {
      ids = span.spanContext();
      logger.info("inside");
    });
    logger.info("outside");
    expect(lines[0]).toMatchObject({ msg: "inside", trace_id: ids!.traceId, span_id: ids!.spanId });
    expect(lines[1]).not.toHaveProperty("trace_id");
  });
});

describe("attribute keys", () => {
  it("are unique and namespaced", () => {
    const values = Object.values(SPAN_ATTRIBUTES);
    expect(new Set(values).size).toBe(values.length);
    for (const key of values) expect(key).toMatch(/^(sp\.|gen_ai\.|error\.type$)/);
  });

  it("include no GenAI content keys", () => {
    const attrs: Attributes = Object.fromEntries(Object.values(SPAN_ATTRIBUTES).map((k) => [k, 1]));
    for (const key of [
      "gen_ai.prompt",
      "gen_ai.completion",
      "gen_ai.input.messages",
      "gen_ai.output.messages",
    ]) {
      expect(attrs).not.toHaveProperty([key]);
      expect(ALLOWED_SPAN_ATTRIBUTES.has(key)).toBe(false);
    }
  });
});
