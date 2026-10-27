import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createJobsServer, deadlineFrom, type TaskRunner } from "../../scripts/lib/lambda-jobs";
import { DRAIN_MARGIN_MS, planTask, runSteps } from "../../scripts/lib/lambda-tasks";
import {
  loadParametersIntoEnv,
  parseParameterPaths,
  SsmEnvError,
  type ParameterReader,
} from "../../scripts/lib/ssm-env";
import { drainDecision, waitUntilDrained } from "@/worker/drain";

/** Plan M8 revision 2: the pieces that run the image on AWS Lambda. */

describe("SSM settings (ssm-env)", () => {
  const folders: Record<string, { name: string; value: string }[]> = {
    "/sp/prod/shared/": [{ name: "/sp/prod/shared/DATABASE_URL", value: "postgres://db" }],
    "/sp/prod/web/": [
      { name: "/sp/prod/web/BETTER_AUTH_SECRET", value: "s".repeat(40) },
      { name: "/sp/prod/web/GEMINI_API_KEY", value: "secret-key" },
    ],
  };
  const read: ParameterReader = async (path) => folders[path] ?? [];

  it("parses a comma-separated list of folders and adds the trailing slash", () => {
    expect(parseParameterPaths(" /sp/prod/shared , /sp/prod/web/ ")).toEqual([
      "/sp/prod/shared/",
      "/sp/prod/web/",
    ]);
    expect(parseParameterPaths(undefined)).toEqual([]);
    expect(parseParameterPaths("  ")).toEqual([]);
  });

  it("refuses paths that are not folders, and duplicates", () => {
    expect(() => parseParameterPaths("sp/prod")).toThrow(SsmEnvError);
    expect(() => parseParameterPaths("/sp/../x")).not.toThrow(); // dots are legal SSM name characters
    expect(() => parseParameterPaths("/sp prod/")).toThrow(SsmEnvError);
    expect(() => parseParameterPaths("/a/,/a")).toThrow(/twice/);
  });

  it("copies each parameter into the environment under its last path part", async () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    const names = await loadParametersIntoEnv(["/sp/prod/shared/", "/sp/prod/web/"], read, env);
    expect(names).toEqual(["BETTER_AUTH_SECRET", "DATABASE_URL", "GEMINI_API_KEY"]);
    expect(env.DATABASE_URL).toBe("postgres://db");
    expect(env.GEMINI_API_KEY).toBe("secret-key");
  });

  it("fails when a variable is also set in the function settings, without showing either value", async () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", GEMINI_API_KEY: "other-value" };
    const error = await loadParametersIntoEnv(["/sp/prod/web/"], read, env).catch((e: Error) => e);
    expect(error).toBeInstanceOf(SsmEnvError);
    expect((error as Error).message).toMatch(/GEMINI_API_KEY is set both/);
    expect((error as Error).message).not.toMatch(/secret-key|other-value/);
    expect(env.BETTER_AUTH_SECRET).toBeUndefined(); // nothing is applied when anything is wrong
  });

  it("fails when two folders hold the same name, or a name is not an environment variable", async () => {
    const twice: ParameterReader = async (path) => [{ name: `${path}DATABASE_URL`, value: "x" }];
    await expect(loadParametersIntoEnv(["/a/", "/b/"], twice, { NODE_ENV: "test" })).rejects.toThrow(
      /more than one SSM folder/,
    );
    const lower: ParameterReader = async () => [{ name: "/a/database_url", value: "x" }];
    await expect(loadParametersIntoEnv(["/a/"], lower, { NODE_ENV: "test" })).rejects.toThrow(
      /not named like/,
    );
  });
});

describe("worker function events (lambda-jobs)", () => {
  let server: ReturnType<typeof createJobsServer> | undefined;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  async function start(runTask: TaskRunner, logs: Record<string, unknown>[] = []) {
    server = createJobsServer({
      passThroughPath: "/events",
      runTask,
      log: (l) => logs.push(l),
      now: () => 1_000,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
  }
  const post = (body: string, headers: Record<string, string> = {}) => ({
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });

  it("answers the readiness check", async () => {
    const call = await start(async () => ({ ok: true, steps: [] }));
    const res = await call("/healthz");
    expect(res.status).toBe(200);
  });

  it("runs a known task with the deadline from the adapter's context header", async () => {
    const seen: [string, number][] = [];
    const call = await start(async (task, deadline) => {
      seen.push([task, deadline]);
      return { ok: true, steps: [{ step: task, code: 0, durationMs: 5 }] };
    });
    const res = await call(
      "/events",
      post('{"task":"drain"}', { "x-amzn-lambda-context": '{"deadline":901000}' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      task: "drain",
      ok: true,
      steps: [{ step: "drain", code: 0, durationMs: 5 }],
    });
    expect(seen).toEqual([["drain", 901_000]]);
  });

  it("answers 500 when a step fails, so Lambda counts the invocation as failed", async () => {
    const call = await start(async () => ({
      ok: false,
      steps: [{ step: "migrate", code: 1, durationMs: 1 }],
    }));
    expect((await call("/events", post('{"task":"migrate"}'))).status).toBe(500);
  });

  it("refuses unknown or malformed events without running anything", async () => {
    let runs = 0;
    const call = await start(async () => {
      runs++;
      return { ok: true, steps: [] };
    });
    for (const body of ['{"task":"rm -rf"}', '{"task":"drain","extra":1}', "not json", "{}"]) {
      expect((await call("/events", post(body))).status).toBe(400);
    }
    expect((await call("/events", { method: "GET" })).status).toBe(405);
    expect((await call("/other", post('{"task":"drain"}'))).status).toBe(404);
    expect((await call("/events", post(`{"task":"${"x".repeat(70_000)}"}`))).status).toBe(413);
    expect(runs).toBe(0);
  });

  it("reads the deadline from either field name, and falls back to a fixed budget", () => {
    expect(deadlineFrom('{"deadline":5000}', 1000, 99)).toBe(5000);
    expect(deadlineFrom('{"deadline_ms":6000}', 1000, 99)).toBe(6000);
    expect(deadlineFrom('{"deadline":500}', 1000, 99)).toBe(1099); // already past
    expect(deadlineFrom("garbage", 1000, 99)).toBe(1099);
    expect(deadlineFrom(undefined, 1000, 99)).toBe(1099);
  });
});

describe("worker function tasks (lambda-tasks)", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://db",
    BETTER_AUTH_SECRET: "s",
    DEMO_PASSWORD: "p",
  };

  it("drain runs the worker in drain mode without the web app's secrets", () => {
    const [drain, ...rest] = planTask("drain", 100_000, env);
    expect(rest).toEqual([]);
    expect(drain!.args).toEqual([".build/worker.mjs"]);
    expect(drain!.env.WORKER_DRAIN_DEADLINE).toBe(String(100_000 - DRAIN_MARGIN_MS));
    expect(drain!.env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(drain!.env.DEMO_PASSWORD).toBeUndefined();
    expect(drain!.env.DATABASE_URL).toBe("postgres://db");
  });

  it("migrate runs the migration script, also without web secrets", () => {
    const steps = planTask("migrate", 100_000, env);
    expect(steps.map((s) => s.args)).toEqual([[".build/migrate.mjs"]]);
    expect(steps[0]!.env.BETTER_AUTH_SECRET).toBeUndefined();
  });

  it("seed-reset resets the demo (with the web settings it needs), then drains", () => {
    const steps = planTask("seed-reset", 100_000, env);
    expect(steps.map((s) => s.step)).toEqual(["seed-reset", "drain"]);
    expect(steps[0]!.args).toEqual([".build/seed-demo.mjs", "--reset"]);
    expect(steps[0]!.env.BETTER_AUTH_SECRET).toBe("s");
    expect(steps[1]!.env.BETTER_AUTH_SECRET).toBeUndefined();
  });

  it("seed-reset gets a throwaway auth secret on Lambda, where the worker can't read the web one", () => {
    const { BETTER_AUTH_SECRET: _web, ...workerEnv } = env;
    const first = planTask("seed-reset", 100_000, workerEnv);
    const second = planTask("seed-reset", 100_000, workerEnv);
    const secret = first[0]!.env.BETTER_AUTH_SECRET;
    expect(secret).toMatch(/^[A-Za-z0-9+/]{43}=$/); // 32 random bytes
    expect(second[0]!.env.BETTER_AUTH_SECRET).not.toBe(secret); // fresh every run
    expect(first[1]!.env.BETTER_AUTH_SECRET).toBeUndefined(); // the drain still gets none
    expect(workerEnv).not.toHaveProperty("BETTER_AUTH_SECRET"); // the caller's env is untouched
  });

  const node = (step: string, code: string) => ({ step, args: ["-e", code], env: process.env });

  it("runs steps in order and stops at the first failure", async () => {
    const result = await runSteps(
      [node("one", "process.exit(0)"), node("two", "process.exit(3)"), node("three", "process.exit(0)")],
      Date.now() + 60_000,
      { log: () => {} },
    );
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => [s.step, s.code])).toEqual([
      ["one", 0],
      ["two", 3],
    ]);
  });

  it("stops a step that is still running near the deadline", async () => {
    const logs: Record<string, unknown>[] = [];
    const started = Date.now();
    // Deadline already inside the stop margin: SIGTERM at once; the child exits on it.
    const result = await runSteps(
      [node("slow", 'process.on("SIGTERM", () => process.exit(143)); setInterval(() => {}, 1000)')],
      Date.now() + 1_000,
      { log: (l) => logs.push(l) },
    );
    // 143 if the child's handler ran, 1 if the signal arrived before the handler was set.
    expect(result).toMatchObject({ ok: false, steps: [{ step: "slow" }] });
    expect(result.steps[0]!.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(logs).toContainEqual(expect.objectContaining({ msg: "step near the deadline; stopping it" }));
  });
});

describe("worker drain mode (drain)", () => {
  const empty = { ready: 0, active: 0, nextRetryAt: null };
  const base = { now: 10_000, lastBusyAt: 10_000, deadline: 100_000, idleMs: 5_000 };

  it("works while jobs are ready or running, or a retry is due before the deadline", () => {
    expect(drainDecision({ ...base, pending: { ...empty, ready: 1 } })).toBe("work");
    expect(drainDecision({ ...base, pending: { ...empty, active: 1 } })).toBe("work");
    expect(drainDecision({ ...base, pending: { ...empty, nextRetryAt: new Date(50_000) } })).toBe("work");
  });

  it("stops after the idle time, and leaves a retry due after the deadline for the next wake-up", () => {
    expect(drainDecision({ ...base, pending: empty })).toBe("idle");
    expect(drainDecision({ ...base, now: 15_000, pending: empty })).toBe("stop-idle");
    expect(
      drainDecision({ ...base, now: 15_000, pending: { ...empty, nextRetryAt: new Date(200_000) } }),
    ).toBe("stop-idle");
  });

  it("always stops at the deadline, even with work left", () => {
    expect(drainDecision({ ...base, now: 100_000, pending: { ...empty, ready: 5 } })).toBe("stop-deadline");
  });

  it("waits until the queues have been empty for the idle time", async () => {
    let clock = 0;
    const readings = [1, 1, 0, 0, 0, 0, 0, 0, 0];
    const result = await waitUntilDrained({
      deadline: 1_000_000,
      idleMs: 3_000,
      pollMs: 1_000,
      pending: async () => ({ ...empty, ready: readings.shift() ?? 0 }),
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    });
    expect(result.decision).toBe("stop-idle");
    // Busy at t=0 and t=1000; empty from t=2000; stops once 3000 ms have passed since t=1000.
    expect(clock).toBe(4_000);
  });
});
