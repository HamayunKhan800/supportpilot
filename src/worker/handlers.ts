import type { PgBoss } from "pg-boss";

import { handleDeadLetter, runIngestJob, type IngestDeps } from "@/server/modules/kb/ingest-job";
import {
  KB_INGEST_DEAD_LETTER_QUEUE,
  KB_INGEST_QUEUE,
  kbIngestPayloadSchema,
} from "@/server/platform/jobs/queues";
import { logger } from "@/server/platform/logger";

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
      if (!payload.success) {
        // Retrying cannot fix a malformed job: complete it and leave a trace.
        logger.error({ job: KB_INGEST_QUEUE, jobId: job.id }, "malformed ingest job dropped");
        return { status: "malformed" };
      }
      return runIngestJob(
        payload.data,
        { isFinalAttempt: job.retryCount >= job.retryLimit, signal: job.signal },
        deps,
      );
    },
  );

  await boss.work(KB_INGEST_DEAD_LETTER_QUEUE, { ...polling, batchSize: 1 }, async ([job]) => {
    if (!job) return null;
    const payload = kbIngestPayloadSchema.safeParse(job.data);
    if (!payload.success) {
      logger.error({ job: KB_INGEST_DEAD_LETTER_QUEUE, jobId: job.id }, "malformed dead-letter job dropped");
      return { status: "malformed" };
    }
    return { changed: await handleDeadLetter(payload.data, deps) };
  });
}
