import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

/**
 * The app's own trace spans (plan M6 D7, D8; ADR-0018). Depends only on the OpenTelemetry API,
 * which does nothing until a tracer provider is started (see ./setup.ts), so this costs almost
 * nothing when tracing is off.
 *
 * Privacy rule: span attributes are metadata only: ids, counts, model names, durations,
 * outcome codes. Never ticket, message, draft or article text, names, emails, prompts or model
 * output, and never an error's message (it can quote input). Only the keys below may be set,
 * and the exporter drops any other key (./exporter.ts), so a forgotten rule fails closed.
 */
export const SPAN_ATTRIBUTES = {
  workspaceId: "sp.workspace_id",
  ticketId: "sp.ticket_id",
  documentId: "sp.document_id",
  jobId: "sp.job.id",
  jobQueue: "sp.job.queue",
  jobAttempt: "sp.job.attempt",
  jobOutcome: "sp.job.outcome",
  aiFeature: "sp.ai.feature",
  aiOutcome: "sp.ai.outcome",
  aiCostMicros: "sp.ai.cost_micros",
  aiLatencyMs: "sp.ai.latency_ms",
  aiTtftMs: "sp.ai.ttft_ms",
  aiFallback: "sp.ai.fallback",
  kbTopK: "sp.kb.top_k",
  kbResults: "sp.kb.results",
  kbTopScore: "sp.kb.top_score",
  kbEmbeddingMs: "sp.kb.embedding_ms",
  kbRetrievalMs: "sp.kb.retrieval_ms",
  draftId: "sp.draft_id",
  draftOutcome: "sp.draft.outcome",
  draftErrorCode: "sp.draft.error_code",
  draftInvalidCitations: "sp.draft.invalid_citations",
  // OpenTelemetry GenAI semantic conventions (metadata keys only; the conventions' message
  // and prompt keys are deliberately absent).
  genAiOperation: "gen_ai.operation.name",
  genAiProvider: "gen_ai.provider.name",
  genAiModel: "gen_ai.request.model",
  genAiInputTokens: "gen_ai.usage.input_tokens",
  genAiOutputTokens: "gen_ai.usage.output_tokens",
  genAiFinishReasons: "gen_ai.response.finish_reasons",
  errorType: "error.type",
} as const;

export const TRACER_NAME = "supportpilot";

/**
 * A short, safe label for an error: an app error code (`ai_timeout`, `not_found`), a Postgres
 * SQLSTATE, or the error class name. Never the message.
 */
export function errorType(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(code)) return code;
  if (err instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(err.name)) return err.name;
  return "unknown";
}

/**
 * Runs `fn` inside a new active span, so spans and log lines inside it share its trace id.
 * A thrown error marks the span as failed with `error.type` (see errorType) and is rethrown.
 * Deliberately not `span.recordException()`: that records the message and stack.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return trace.getTracer(TRACER_NAME).startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute(SPAN_ATTRIBUTES.errorType, errorType(err));
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Sets attributes on the current span, if there is one (no-op when tracing is off). */
export function annotateActiveSpan(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

/** The current trace and span ids, for log lines (pino mixin); empty when there is no span. */
export function activeTraceIds(): { trace_id?: string; span_id?: string } {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !trace.isSpanContextValid(context)) return {};
  return { trace_id: context.traceId, span_id: context.spanId };
}
