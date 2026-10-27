import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/server/platform/db/client";
import { createBoss, pendingJobs } from "@/server/platform/jobs/boss";

/**
 * Drain mode reads unfinished work straight from pg-boss's job table (plan M8 revision 2,
 * R4). Uses a queue of its own so other tests' jobs can't change the counts.
 */
const QUEUE = `test.drain.${Date.now()}`;

describe("pendingJobs (worker drain mode)", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = createBoss(process.env.DATABASE_URL!, "worker", 2);
    await boss.start();
    await boss.createQueue(QUEUE);
  });

  afterAll(async () => {
    await boss.deleteQueue(QUEUE);
    await boss.stop({ graceful: false });
  });

  const pending = () => pendingJobs(getDb().db, [QUEUE]);

  it("sees nothing in an empty queue", async () => {
    expect(await pending()).toEqual({ ready: 0, active: 0, nextRetryAt: null });
  });

  it("counts a waiting job as ready, then as active once a worker takes it, then nothing", async () => {
    await boss.send(QUEUE, { n: 1 });
    expect(await pending()).toMatchObject({ ready: 1, active: 0 });

    const [job] = await boss.fetch(QUEUE);
    expect(job).toBeDefined();
    expect(await pending()).toMatchObject({ ready: 0, active: 1 });

    await boss.complete(QUEUE, job!.id);
    expect(await pending()).toEqual({ ready: 0, active: 0, nextRetryAt: null });
  });

  it("reports when a delayed job becomes due, without counting it as ready", async () => {
    const before = Date.now();
    await boss.send(QUEUE, { n: 2 }, { startAfter: 120 });
    const result = await pending();
    expect(result.ready).toBe(0);
    expect(result.nextRetryAt).toBeInstanceOf(Date);
    const dueInMs = result.nextRetryAt!.getTime() - before;
    expect(dueInMs).toBeGreaterThan(100_000);
    expect(dueInMs).toBeLessThan(130_000);
  });

  it("ignores queues it was not asked about", async () => {
    expect(await pendingJobs(getDb().db, ["no.such.queue"])).toEqual({
      ready: 0,
      active: 0,
      nextRetryAt: null,
    });
  });
});
