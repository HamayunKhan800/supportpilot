import { z } from "zod";

/**
 * Background job queues (ADR-0005, plan M4 D9). Queue settings live in code and are
 * applied by `installJobs()` at release time, so every environment runs the same policy.
 */

export const KB_INGEST_QUEUE = "kb.ingest";
/** Receives kb.ingest jobs that failed every attempt, or whose worker died mid-job. */
export const KB_INGEST_DEAD_LETTER_QUEUE = "kb.ingest.dead";

export const kbIngestPayloadSchema = z
  .object({
    workspaceId: z.string().min(1).max(64), // Better Auth organization ids are opaque text
    documentId: z.uuid(),
  })
  .strict();

export type KbIngestPayload = z.infer<typeof kbIngestPayloadSchema>;

export const AI_TRIAGE_QUEUE = "ai.triage";
/** Receives ai.triage jobs that failed every attempt, or whose worker died mid-job. */
export const AI_TRIAGE_DEAD_LETTER_QUEUE = "ai.triage.dead";

export const aiTriagePayloadSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    ticketId: z.uuid(),
  })
  .strict();

export type AiTriagePayload = z.infer<typeof aiTriagePayloadSchema>;

export interface QueueSettings {
  /** Retries after the first attempt (pg-boss default: 2). */
  retryLimit: number;
  /** Base delay in seconds; doubled per retry with jitter when retryBackoff is on. */
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax?: number;
  /** A running job is failed (and retried) after this long. */
  expireInSeconds: number;
  /** The worker must check in this often, so a crashed worker's job is retried quickly. */
  heartbeatSeconds?: number;
  deadLetter?: string;
}

/**
 * kb.ingest: a temporary failure (embedding service busy or down) is retried 3 times at
 * about 30-60 s, 60-120 s and 120-240 s, which outlasts a per-minute free-tier quota.
 * One attempt is bounded by the PDF timeout (30 s) plus a few embedding calls (60 s
 * timeout each), so 10 minutes is a generous ceiling.
 */
export const QUEUE_SETTINGS: Record<string, QueueSettings> = {
  [KB_INGEST_QUEUE]: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 600,
    heartbeatSeconds: 30,
    deadLetter: KB_INGEST_DEAD_LETTER_QUEUE,
  },
  [KB_INGEST_DEAD_LETTER_QUEUE]: {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60,
  },
  /**
   * ai.triage (M5 D4, D13): the AI SDK makes no retries of its own, so the queue retries a
   * busy or unreachable provider 3 times at about 30-60 s, 60-120 s and 120-240 s. One attempt
   * is at most two model calls (one retry for invalid output) of 20 s each plus a few queries,
   * so 2 minutes is a safe ceiling.
   */
  [AI_TRIAGE_QUEUE]: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 120,
    heartbeatSeconds: 30,
    deadLetter: AI_TRIAGE_DEAD_LETTER_QUEUE,
  },
  [AI_TRIAGE_DEAD_LETTER_QUEUE]: {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60,
  },
};

/** Dead-letter queues are created first, because a queue may only name an existing one. */
export const QUEUE_INSTALL_ORDER = [
  KB_INGEST_DEAD_LETTER_QUEUE,
  KB_INGEST_QUEUE,
  AI_TRIAGE_DEAD_LETTER_QUEUE,
  AI_TRIAGE_QUEUE,
] as const;
