/**
 * A sliding one-minute limit on embedded texts, for eval runs against a free tier.
 *
 * Why per text: Gemini counts every text in a batch towards its per-minute limit
 * (AI Studio showed a peak of 148 against a limit of 100 when the eval only paused between
 * calls). Why serialised: question lookups can run in parallel, and separate pauses that
 * overlap don't slow anything down. Every caller waits in one queue.
 */
export interface TextRateLimiter {
  /** Resolves when `count` more texts fit in the last 60 seconds, then records them. */
  acquire(count: number): Promise<void>;
  readonly maxPerMinute: number;
}

export interface RateLimiterOptions {
  maxPerMinute: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createTextRateLimiter(options: RateLimiterOptions): TextRateLimiter {
  const { maxPerMinute } = options;
  if (!Number.isInteger(maxPerMinute) || maxPerMinute < 1) {
    throw new Error("maxPerMinute must be a positive whole number");
  }
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const sent: { at: number; count: number }[] = [];
  let queue: Promise<void> = Promise.resolve();

  async function take(count: number) {
    for (;;) {
      const t = now();
      while (sent.length && sent[0]!.at <= t - windowMs) sent.shift();
      const used = sent.reduce((n, s) => n + s.count, 0);
      if (used + count <= maxPerMinute) {
        sent.push({ at: t, count });
        return;
      }
      // Wait until enough of the oldest texts leave the window.
      let freed = 0;
      let waitUntil = t;
      for (const s of sent) {
        freed += s.count;
        waitUntil = s.at + windowMs;
        if (used - freed + count <= maxPerMinute) break;
      }
      await sleep(Math.max(1, waitUntil - t));
    }
  }

  return {
    maxPerMinute,
    acquire(count: number) {
      if (!Number.isInteger(count) || count < 1) return Promise.reject(new Error("count must be ≥ 1"));
      if (count > maxPerMinute) {
        return Promise.reject(
          new Error(`a batch of ${count} can never fit a limit of ${maxPerMinute}/minute`),
        );
      }
      const turn = queue.then(() => take(count));
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

/** Splits a list into pieces of at most `size` (so no batch exceeds the per-minute limit). */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
