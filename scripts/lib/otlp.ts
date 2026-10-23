/**
 * Reads OTLP/HTTP JSON trace exports (the format @opentelemetry/exporter-trace-otlp-http sends)
 * into flat span records, for `pnpm otel:capture` (docs/observability.md).
 */

type OtlpValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpValue[] };
};
type OtlpAttribute = { key: string; value: OtlpValue };

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: OtlpAttribute[];
  events?: Array<{ name: string; attributes?: OtlpAttribute[] }>;
  status?: { code?: number; message?: string };
}

export interface OtlpExport {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans?: Array<{ scope?: { name?: string }; spans?: OtlpSpan[] }>;
  }>;
}

export type AttributeValue = string | number | boolean | AttributeValue[];

export interface CapturedSpan {
  service: string;
  scope: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  durationMs: number;
  attributes: Record<string, AttributeValue>;
  events: Array<{ name: string; attributes: Record<string, AttributeValue> }>;
  status: { code: number; message?: string };
}

function valueOf(value: OtlpValue): AttributeValue {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  return (value.arrayValue?.values ?? []).map(valueOf);
}

function attributesOf(list: OtlpAttribute[] | undefined): Record<string, AttributeValue> {
  return Object.fromEntries((list ?? []).map((a) => [a.key, valueOf(a.value)]));
}

export function flattenOtlp(body: OtlpExport): CapturedSpan[] {
  const out: CapturedSpan[] = [];
  for (const rs of body.resourceSpans ?? []) {
    const service = String(attributesOf(rs.resource?.attributes)["service.name"] ?? "unknown");
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        out.push({
          service,
          scope: ss.scope?.name ?? "",
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId || null,
          name: span.name,
          durationMs: (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) / 1e6,
          attributes: attributesOf(span.attributes),
          events: (span.events ?? []).map((e) => ({ name: e.name, attributes: attributesOf(e.attributes) })),
          status: {
            code: span.status?.code ?? 0,
            ...(span.status?.message ? { message: span.status.message } : {}),
          },
        });
      }
    }
  }
  return out;
}

/** One readable line per span: service, duration, name and a few key attributes. */
export function formatSpan(span: CapturedSpan): string {
  const keys = Object.entries(span.attributes)
    .filter(([key]) => !key.startsWith("next.span_"))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : String(value)}`)
    .join(" ");
  const failed = span.status.code === 2 ? " [error]" : "";
  return `${span.service.padEnd(20)} ${span.durationMs.toFixed(1).padStart(8)} ms  ${span.name}${failed}  ${keys}`;
}
