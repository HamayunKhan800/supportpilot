import type { Job, PgBoss } from "pg-boss";

import { handleDeadLetter, runIngestJob, type IngestDeps } from "@/server/modules/kb/ingest-job";
import { handleTriageDeadLetter, runTriageJob, type TriageDeps } from "@/server/modules/triage/job";
import {
  AI_TRIAGE_DEAD_LETTER_QUEUE,
  AI_TRIAGE_QUEUE,
  aiTriagePayloadSchema,
  KB_INGEST_DEAD_LETTER_QUEUE,
  KB_INGEST_QUEUE,
  kbIngestPayloadSchema,
} from "@/server/platform/jobs/queues";
import { reportError } from "@/server/platform/error-reporting";
import { logger } from "@/server/platform/logger";

import { traced } from "./traced-job";

/** Payloads that fail validation: retrying cannot fix them, so they are completed and reported. */
function malformed(queue: string, job: Job<unknown>): { status: "malformed" } {
  logger.error({ job: queue, jobId: job.id }, "malformed job dropped");
  reportError(new Error(`malformed ${queue} job dropped`), { job: queue, jobId: job.id });
  return { status: "malformed" };
}

export interface HandlerOptions {
  /** Ingest jobs processed at once by this process (each may run one PDF thread). */
  concurrency?: number;
  pollingIntervalSeconds?: number;
}

/** Registers the knowledge-base job handlers on a started pg-boss instance. */
export async function registerKbHandlers(
  boss: PgBoss,
  deps: IngestDeps,
  options: HandlerOptions = {},
): Promise<void> {
  const polling = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };

  await boss.work(
    KB_INGEST_QUEUE,
    { ...polling, includeMetadata: true, batchSize: 1, localConcurrency: options.concurrency ?? 2 },
    async ([job]) => {
      if (!job) return null;
      const payload = kbIngestPayloadSchema.safeParse(job.data);
      if (!payload.success) return malformed(KB_INGEST_QUEUE, job);
      return traced(KB_INGEST_QUEUE, job, payload.data, () =>
        runIngestJob(
          payload.data,
          { isFinalAttempt: job.retryCount >= job.retryLimit, signal: job.signal },
          deps,
        ),
      );
    },
  );

  await boss.work(KB_INGEST_DEAD_LETTER_QUEUE, { ...polling, batchSize: 1 }, async ([job]) => {
    if (!job) return null;
    const payload = kbIngestPayloadSchema.safeParse(job.data);
    if (!payload.success) return malformed(KB_INGEST_DEAD_LETTER_QUEUE, job);
    return traced(KB_INGEST_DEAD_LETTER_QUEUE, job, payload.data, async () => ({
      status: (await handleDeadLetter(payload.data, deps)) ? "marked_failed" : "unchanged",
    }));
  });
}

/** Registers the AI triage job handlers (M5 D4) on a started pg-boss instance. */
export async function registerTriageHandlers(
  boss: PgBoss,
  deps: TriageDeps,
  options: HandlerOptions = {},
): Promise<void> {
  const polling = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };

  await boss.work(
    AI_TRIAGE_QUEUE,
    { ...polling, includeMetadata: true, batchSize: 1, localConcurrency: options.concurrency ?? 2 },
    async ([job]) => {
      if (!job) return null;
      const payload = aiTriagePayloadSchema.safeParse(job.data);
      if (!payload.success) return malformed(AI_TRIAGE_QUEUE, job);
      return traced(AI_TRIAGE_QUEUE, job, payload.data, () =>
        runTriageJob(
          payload.data,
          { isFinalAttempt: job.retryCount >= job.retryLimit, signal: job.signal },
          deps,
        ),
      );
    },
  );

  await boss.work(AI_TRIAGE_DEAD_LETTER_QUEUE, { ...polling, batchSize: 1 }, async ([job]) => {
    if (!job) return null;
    const payload = aiTriagePayloadSchema.safeParse(job.data);
    if (!payload.success) return malformed(AI_TRIAGE_DEAD_LETTER_QUEUE, job);
    return traced(AI_TRIAGE_DEAD_LETTER_QUEUE, job, payload.data, async () => ({
      status: (await handleTriageDeadLetter(payload.data)) ? "marked_failed" : "unchanged",
    }));
  });
}
