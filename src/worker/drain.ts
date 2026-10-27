/**
 * Drain mode (plan M8 revision 2, R4): on Lambda the worker is not always running. The web
 * app wakes it after queueing a job; it then works until the queues are empty and exits, so
 * nothing keeps the database awake between visits.
 *
 * The worker keeps running while any job is ready or running, or while a retry is due
 * before the deadline (a failed AI call is retried after 30 s to 4 min). Once there is
 * nothing to do it waits `idleMs` more, which also covers a job whose transaction commits
 * just after the wake-up call. A retry due after the deadline is left for the next wake-up
 * (the next upload, ticket or daily reset).
 */
import type { PendingJobs } from "@/server/platform/jobs/boss";

export type DrainDecision = "work" | "idle" | "stop-idle" | "stop-deadline";

export function drainDecision(input: {
  now: number;
  /** When there was last something to do (start time at first). */
  lastBusyAt: number;
  deadline: number;
  idleMs: number;
  pending: PendingJobs;
}): DrainDecision {
  const { now, lastBusyAt, deadline, idleMs, pending } = input;
  if (now >= deadline) return "stop-deadline";
  const retryDueInTime = pending.nextRetryAt !== null && pending.nextRetryAt.getTime() < deadline;
  if (pending.ready > 0 || pending.active > 0 || retryDueInTime) return "work";
  return now - lastBusyAt >= idleMs ? "stop-idle" : "idle";
}

/** Polls until the decision is a stop, and returns it. */
export async function waitUntilDrained(options: {
  deadline: number;
  idleMs: number;
  pollMs: number;
  pending: () => Promise<PendingJobs>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ decision: "stop-idle" | "stop-deadline"; left: PendingJobs }> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastBusyAt = now();
  for (;;) {
    const pending = await options.pending();
    const decision = drainDecision({
      now: now(),
      lastBusyAt,
      deadline: options.deadline,
      idleMs: options.idleMs,
      pending,
    });
    if (decision === "stop-idle" || decision === "stop-deadline") return { decision, left: pending };
    if (decision === "work") lastBusyAt = now();
    await sleep(options.pollMs);
  }
}
