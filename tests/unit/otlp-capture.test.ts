import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTracing } from "@/server/platform/telemetry/setup";
import { SPAN_ATTRIBUTES, withSpan } from "@/server/platform/telemetry/spans";

import { flattenOtlp, formatSpan, type OtlpExport } from "../../scripts/lib/otlp";

/**
 * Round trip: the real OTLP/HTTP exporter (through the redacting exporter) sends to a local
 * server, and `pnpm otel:capture`'s reader decodes what it sent.
 */
let server: Server;
const bodies: Array<{ contentType: string | undefined; url: string | undefined; body: OtlpExport }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      bodies.push({
        contentType: req.headers["content-type"],
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as OtlpExport,
      });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("otel:capture reads what the exporter sends", () => {
  it("decodes names, nesting, attributes, status and the service", async () => {
    const { port } = server.address() as AddressInfo;
    const tracing = startTracing({
      serviceName: "supportpilot-worker",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` },
    })!;
    await withSpan(
      "job ai.triage",
      { [SPAN_ATTRIBUTES.jobQueue]: "ai.triage", "sp.not_allowed": "x" },
      async () => {
        await withSpan(
          "ai triage",
          { [SPAN_ATTRIBUTES.genAiInputTokens]: 120, [SPAN_ATTRIBUTES.aiFallback]: false },
          () => Promise.reject(Object.assign(new Error("private words"), { code: "ai_timeout" })),
        ).catch(() => {});
      },
    );
    await tracing.shutdown(); // flushes the batch

    expect(bodies[0]?.url).toBe("/v1/traces");
    expect(bodies[0]?.contentType).toBe("application/json");
    const spans = bodies.flatMap((b) => flattenOtlp(b.body));
    const job = spans.find((s) => s.name === "job ai.triage")!;
    const ai = spans.find((s) => s.name === "ai triage")!;
    expect(job.service).toBe("supportpilot-worker");
    expect(job.attributes).toEqual({ [SPAN_ATTRIBUTES.jobQueue]: "ai.triage" });
    expect(ai.parentSpanId).toBe(job.spanId);
    expect(ai.traceId).toBe(job.traceId);
    expect(ai.attributes).toEqual({
      [SPAN_ATTRIBUTES.genAiInputTokens]: 120,
      [SPAN_ATTRIBUTES.aiFallback]: false,
      "error.type": "ai_timeout",
    });
    expect(ai.status.code).toBe(2);
    expect(JSON.stringify(spans)).not.toContain("private words");
    expect(formatSpan(ai)).toMatch(
      /supportpilot-worker\s+\d+\.\d ms {2}ai triage \[error\] {2}gen_ai\.usage\.input_tokens=120/,
    );
  });

  it("tolerates empty exports", () => {
    expect(flattenOtlp({})).toEqual([]);
    expect(flattenOtlp({ resourceSpans: [{ scopeSpans: [{ spans: [] }] }] })).toEqual([]);
  });
});
