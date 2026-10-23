import type { Job } from "pg-boss";

import { reportError } from "@/server/platform/error-reporting";
import { SPAN_ATTRIBUTES, withSpan } from "@/server/platform/telemetry/spans";

/**
 * Runs one job inside a trace span (plan M6 D7) carrying only ids, the attempt and the outcome.
 * An error thrown on the final attempt is unexpected (expected failures return a status), so
 * it is reported to the error tracker (D9) before pg-boss moves the job to its dead-letter
 * queue. Earlier attempts are retried and not reported.
 */
export async function traced<T extends { status: string } | null>(
  queue: string,
  job: Job<unknown> & { retryCount?: number; retryLimit?: number },
  ids: { workspaceId?: string; ticketId?: string; documentId?: string },
  run: () => Promise<T>,
): Promise<T> {
  const attributes = {
    [SPAN_ATTRIBUTES.jobQueue]: queue,
    [SPAN_ATTRIBUTES.jobId]: job.id,
    ...(job.retryCount === undefined ? {} : { [SPAN_ATTRIBUTES.jobAttempt]: job.retryCount + 1 }),
    ...(ids.workspaceId ? { [SPAN_ATTRIBUTES.workspaceId]: ids.workspaceId } : {}),
    ...(ids.ticketId ? { [SPAN_ATTRIBUTES.ticketId]: ids.ticketId } : {}),
    ...(ids.documentId ? { [SPAN_ATTRIBUTES.documentId]: ids.documentId } : {}),
  };
  return withSpan(`job ${queue}`, attributes, async (span) => {
    try {
      const result = await run();
      if (result) span.setAttribute(SPAN_ATTRIBUTES.jobOutcome, result.status);
      return result;
    } catch (err) {
      const finalAttempt =
        job.retryCount === undefined || job.retryLimit === undefined || job.retryCount >= job.retryLimit;
      if (finalAttempt) reportError(err, { job: queue, jobId: job.id });
      throw err;
    }
  });
}
