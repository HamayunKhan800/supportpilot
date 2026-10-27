/**
 * What each worker-function task runs (plan M8 revision 2, R4 and R5). Every step is one of
 * the image's existing, separately tested entry points, run as a child process:
 *
 *   drain       node .build/worker.mjs   (with WORKER_DRAIN_DEADLINE: exits when the queues are empty)
 *   migrate     node .build/migrate.mjs
 *   seed-reset  node .build/seed-demo.mjs --reset, then drain (indexes the re-added articles)
 *
 * Steps run one after another and stop at the first failure. A step still running near the
 * invocation's deadline gets SIGTERM, then SIGKILL, so the function answers before Lambda
 * cuts it off.
 */
import { spawn } from "node:child_process";

import type { JobsTask, StepResult, TaskResult } from "./lambda-jobs";
import { WEB_ONLY_ENV, withoutKeys } from "./supervisor";

export interface StepSpec {
  step: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** The worker stops taking new jobs this long before the deadline. */
export const DRAIN_MARGIN_MS = 45_000;
/** A step still running this long before the deadline is sent SIGTERM. */
export const STOP_MARGIN_MS = 20_000;
/** ...and SIGKILL this long after that. */
export const KILL_GRACE_MS = 10_000;

export function planTask(task: JobsTask, deadline: number, env: NodeJS.ProcessEnv): StepSpec[] {
  // The worker and the migration never need the web app's secrets (least privilege).
  const lean = withoutKeys(env, WEB_ONLY_ENV);
  const drain: StepSpec = {
    step: "drain",
    args: [".build/worker.mjs"],
    env: { ...lean, WORKER_DRAIN_DEADLINE: String(deadline - DRAIN_MARGIN_MS) },
  };
  switch (task) {
    case "drain":
      return [drain];
    case "migrate":
      return [{ step: "migrate", args: [".build/migrate.mjs"], env: lean }];
    case "seed-reset":
      // The seed signs the demo users up through the auth library, so it needs the web settings.
      return [{ step: "seed-reset", args: [".build/seed-demo.mjs", "--reset"], env }, drain];
  }
}

export interface RunOptions {
  command?: string;
  now?: () => number;
  log: (line: Record<string, unknown>) => void;
}

function runStep(spec: StepSpec, deadline: number, options: Required<RunOptions>): Promise<StepResult> {
  const started = options.now();
  return new Promise((resolve) => {
    const child = spawn(options.command, spec.args, { stdio: "inherit", env: spec.env });
    let killTimer: NodeJS.Timeout | undefined;
    const stopTimer = setTimeout(
      () => {
        options.log({ level: "warn", msg: "step near the deadline; stopping it", step: spec.step });
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      },
      Math.max(0, deadline - STOP_MARGIN_MS - started),
    );
    const finish = (code: number) => {
      clearTimeout(stopTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ step: spec.step, code, durationMs: options.now() - started });
    };
    child.on("error", (err) => {
      options.log({ level: "error", msg: "step failed to start", step: spec.step, error: err.message });
      finish(1);
    });
    child.on("exit", (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

export async function runSteps(
  steps: StepSpec[],
  deadline: number,
  options: RunOptions,
): Promise<TaskResult> {
  const resolved: Required<RunOptions> = {
    command: options.command ?? process.execPath,
    now: options.now ?? Date.now,
    log: options.log,
  };
  const results: StepResult[] = [];
  for (const spec of steps) {
    const result = await runStep(spec, deadline, resolved);
    results.push(result);
    if (result.code !== 0) return { ok: false, steps: results };
  }
  return { ok: true, steps: results };
}
