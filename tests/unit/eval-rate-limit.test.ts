import { describe, expect, it } from "vitest";

import { chunked, createTextRateLimiter } from "../../scripts/lib/rate-limit";

/** A fake clock: sleeping just moves time forward, so no test waits for real. */
function fakeClock() {
  const clock = {
    t: 0,
    sleeps: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.t += ms;
    },
  };
  return clock;
}

/** Largest number of texts sent within any 60-second window. */
function peakPerMinute(log: { at: number; count: number }[], windowMs = 60_000) {
  return Math.max(
    0,
    ...log.map((e) =>
      log.filter((o) => o.at > e.at - windowMs && o.at <= e.at).reduce((n, o) => n + o.count, 0),
    ),
  );
}

describe("text rate limiter (free-tier per-minute limit, counted per text)", () => {
  it("lets texts through without waiting until the minute's limit is used", async () => {
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 100, now: clock.now, sleep: clock.sleep });
    await limiter.acquire(60);
    await limiter.acquire(40);
    expect(clock.sleeps).toEqual([]);
  });

  it("waits exactly until the oldest texts leave the window", async () => {
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 100, now: clock.now, sleep: clock.sleep });
    await limiter.acquire(60); // t = 0
    clock.t = 10_000;
    await limiter.acquire(40); // t = 10 s, now full
    clock.t = 20_000;
    await limiter.acquire(30); // needs the 60 from t = 0 to expire: wait until t = 60 s
    expect(clock.t).toBe(60_000);
    expect(clock.sleeps).toEqual([40_000]);
  });

  it("a batch counts as all of its texts, not as one request", async () => {
    // The old pacing paused between calls only; a 100-text batch then counted as "one".
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 80, now: clock.now, sleep: clock.sleep });
    await limiter.acquire(50);
    await limiter.acquire(50);
    expect(clock.t).toBe(60_000);
  });

  it("parallel callers share one queue, so the limit holds in every minute", async () => {
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 10, now: clock.now, sleep: clock.sleep });
    const log: { at: number; count: number }[] = [];
    await Promise.all(
      Array.from({ length: 35 }, async () => {
        await limiter.acquire(1);
        log.push({ at: clock.t, count: 1 });
      }),
    );
    expect(log).toHaveLength(35);
    expect(peakPerMinute(log)).toBe(10);
    expect(clock.t).toBe(180_000); // 35 texts at 10 per minute: the last group starts at 3 minutes
  });

  it("rejects a batch that can never fit, and bad settings", async () => {
    const limiter = createTextRateLimiter({ maxPerMinute: 5 });
    await expect(limiter.acquire(6)).rejects.toThrow(/never fit/);
    await expect(limiter.acquire(0)).rejects.toThrow();
    // A rejected call doesn't block the queue for the next one.
    await expect(limiter.acquire(5)).resolves.toBeUndefined();
    expect(() => createTextRateLimiter({ maxPerMinute: 0 })).toThrow();
    expect(() => createTextRateLimiter({ maxPerMinute: 2.5 })).toThrow();
  });

  it("even spacing: no burst, sends spread at the allowed rate (finding #86)", async () => {
    // A sliding window alone let 60 texts go at once, then 60 more a minute later; Google's
    // minutes don't line up with ours, so both bursts could count in one of its minutes.
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 50, maxBatch: 10, even: true, ...clock });
    const log: { at: number; count: number }[] = [];
    for (let i = 0; i < 10; i++) {
      await limiter.acquire(10);
      log.push({ at: clock.t, count: 10 });
    }
    // 10 texts at 50 per minute use 12 seconds each.
    expect(log.map((e) => e.at)).toEqual([0, 12, 24, 36, 48, 60, 72, 84, 96, 108].map((s) => s * 1000));
    // Even a window placed anywhere (Google's) holds at most 50 + one batch.
    for (let start = -60_000; start < 120_000; start += 1_000) {
      const inWindow = log
        .filter((e) => e.at >= start && e.at < start + 60_000)
        .reduce((n, e) => n + e.count, 0);
      expect(inWindow).toBeLessThanOrEqual(50);
    }
  });

  it("limits tokens per minute too, so long passages slow the pace", async () => {
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 100, maxTokensPerMinute: 1_000, ...clock });
    await limiter.acquire(1, 600);
    await limiter.acquire(1, 600); // 1,200 > 1,000: waits for the first to leave the window
    expect(clock.t).toBe(60_000);
    const c2 = fakeClock();
    const paced = createTextRateLimiter({ maxPerMinute: 100, maxTokensPerMinute: 1_000, even: true, ...c2 });
    await paced.acquire(1, 500);
    await paced.acquire(1, 10);
    expect(c2.t).toBe(30_000); // 500 tokens at 1,000 per minute use 30 seconds
  });

  it("a single passage over the token limit still goes, alone, instead of waiting for ever", async () => {
    const clock = fakeClock();
    const limiter = createTextRateLimiter({ maxPerMinute: 100, maxTokensPerMinute: 1_000, ...clock });
    await limiter.acquire(1, 100);
    await limiter.acquire(1, 5_000); // waits until the window is empty, then goes
    expect(clock.t).toBe(60_000);
  });

  it("validates batch and token settings", () => {
    expect(createTextRateLimiter({ maxPerMinute: 50, maxBatch: 10 }).maxBatch).toBe(10);
    expect(createTextRateLimiter({ maxPerMinute: 50 }).maxBatch).toBe(50);
    expect(() => createTextRateLimiter({ maxPerMinute: 5, maxBatch: 6 })).toThrow();
    expect(() => createTextRateLimiter({ maxPerMinute: 5, maxTokensPerMinute: 0 })).toThrow();
  });

  it("chunked splits lists into batches no larger than the limit", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 3)).toEqual([]);
    expect(chunked([1, 2], 80)).toEqual([[1, 2]]);
  });
});
