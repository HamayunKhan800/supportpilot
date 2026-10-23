/**
 * A tiny local trace receiver, for viewing traces without Docker (docs/observability.md):
 *
 *   pnpm otel:capture [--port 4318] [--out spans.jsonl]
 *
 * then start the app with OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318. Each span is
 * printed as one line; with --out, every span is also appended to a file as JSON, which is how
 * the leak check in docs/observability.md searches a real server's traces.
 *
 * Accepts OTLP/HTTP JSON on POST /v1/traces only. Listens on 127.0.0.1: a development tool,
 * not a collector. For a real UI, use Jaeger (docs/observability.md).
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

import { flattenOtlp, formatSpan, type OtlpExport } from "./lib/otlp";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { port: { type: "string", default: "4318" }, out: { type: "string" } },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be 1-65535");

  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/traces") {
      res.writeHead(404).end();
      return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      res.writeHead(415).end("send OTLP/HTTP JSON");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const spans = flattenOtlp(JSON.parse(Buffer.concat(chunks).toString("utf8")) as OtlpExport);
        for (const span of spans) {
          console.log(formatSpan(span));
          if (values.out) appendFileSync(values.out, JSON.stringify(span) + "\n");
        }
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } catch {
        res.writeHead(400).end("invalid OTLP JSON");
      }
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Receiving traces on http://127.0.0.1:${port}/v1/traces (Ctrl+C to stop)`);
    console.log(`Start the app with OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
