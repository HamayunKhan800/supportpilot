/**
 * Per-minute limits on embedded texts and tokens, for eval runs against a free tier.
 *
 * Why per text: Gemini counts every text in a batch towards its per-minute limit
 * (AI Studio showed a peak of 148 against a limit of 100 when the eval only paused between
 * calls). Why tokens too: gemini-embedding-2's free tier also allows 30,000 tokens per
 * minute, and 60 long passages can exceed that on their own. Why even spacing: a sliding
 * window still allowed a full minute's texts in one burst, and Google's minute boundaries
 * don't line up with ours, so two bursts a minute apart can land in one of Google's minutes
 * (milestones #85, #86). Why serialised: parallel question lookups share one queue.
 */
export interface TextRateLimiter {
  /** Resolves when `count` texts (about `tokens` tokens) may be sent, then records them. */
  acquire(count: number, tokens?: number): Promise<void>;
  readonly maxPerMinute: number;
  /** Largest batch to send in one call (keeps bursts small). */
  readonly maxBatch: number;
}

export interface RateLimiterOptions {
  maxPerMinute: number;
  /** Also limit estimated tokens per minute (optional). */
  maxTokensPerMinute?: number;
  /** Largest batch per call; defaults to maxPerMinute. */
  maxBatch?: number;
  /** Spread sends evenly over the minute instead of allowing a burst (default false). */
  even?: boolean;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const positiveInt = (n: number) => Number.isInteger(n) && n >= 1;

export function createTextRateLimiter(options: RateLimiterOptions): TextRateLimiter {
  const { maxPerMinute, maxTokensPerMinute } = options;
  if (!positiveInt(maxPerMinute)) throw new Error("maxPerMinute must be a positive whole number");
  if (maxTokensPerMinute !== undefined && !positiveInt(maxTokensPerMinute)) {
    throw new Error("maxTokensPerMinute must be a positive whole number");
  }
  const maxBatch = options.maxBatch ?? maxPerMinute;
  if (!positiveInt(maxBatch) || maxBatch > maxPerMinute) {
    throw new Error("maxBatch must be a positive whole number no larger than maxPerMinute");
  }
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const sent: { at: number; count: number; tokens: number }[] = [];
  let nextEvenAt = -Infinity;
  let queue: Promise<void> = Promise.resolve();

  /** How long until this send fits the sliding window (0 = now). */
  function windowWait(t: number, count: number, tokens: number): number {
    while (sent.length && sent[0]!.at <= t - windowMs) sent.shift();
    const usedCount = sent.reduce((n, s) => n + s.count, 0);
    const usedTokens = sent.reduce((n, s) => n + s.tokens, 0);
    // `empty`: nothing else in the window, so even a batch over the token limit may go alone
    // (otherwise one long passage could wait for ever).
    const fits = (c: number, k: number, empty: boolean) =>
      c + count <= maxPerMinute &&
      (maxTokensPerMinute === undefined || empty || k + tokens <= maxTokensPerMinute);
    if (fits(usedCount, usedTokens, sent.length === 0)) return 0;
    // Wait until enough of the oldest sends leave the window.
    let c = usedCount;
    let k = usedTokens;
    for (let i = 0; i < sent.length; i++) {
      c -= sent[i]!.count;
      k -= sent[i]!.tokens;
      if (fits(c, k, i === sent.length - 1)) return Math.max(1, sent[i]!.at + windowMs - t);
    }
    return Math.max(1, sent[sent.length - 1]!.at + windowMs - t);
  }

  async function take(count: number, tokens: number) {
    for (;;) {
      const t = now();
      const wait = Math.max(options.even ? nextEvenAt - t : 0, windowWait(t, count, tokens));
      if (wait <= 0) {
        sent.push({ at: t, count, tokens });
        if (options.even) {
          // The time this send "uses up" at the allowed rate, by texts and by tokens.
          const byCount = (count * windowMs) / maxPerMinute;
          const byTokens = maxTokensPerMinute ? (tokens * windowMs) / maxTokensPerMinute : 0;
          nextEvenAt = t + Math.max(byCount, byTokens);
        }
        return;
      }
      await sleep(wait);
    }
  }

  return {
    maxPerMinute,
    maxBatch,
    acquire(count: number, tokens = 0) {
      if (!positiveInt(count)) return Promise.reject(new Error("count must be ≥ 1"));
      if (count > maxPerMinute) {
        return Promise.reject(
          new Error(`a batch of ${count} can never fit a limit of ${maxPerMinute}/minute`),
        );
      }
      const turn = queue.then(() => take(count, Math.max(0, tokens)));
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

/** Rough token count for limiting only (about 4 characters per token for English). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
