/**
 * Runs the web server and the background worker as two child processes of one container
 * (plan M8 D2: one Cloud Run service, scale to zero). ADR-0008 stays true: one image, two
 * processes, and either can move to its own service later without code changes.
 *
 * Rules:
 *  - A stop signal (SIGTERM from the platform, SIGINT locally) is passed to every child.
 *    Children that have not exited after `graceMs` are killed, so the container always
 *    stops before the platform's own deadline (Cloud Run: 10 seconds after SIGTERM).
 *  - If one child exits on its own, the other is stopped and the container exits non-zero,
 *    so the platform replaces the instance instead of serving with half the app missing.
 */
import { spawn, type ChildProcess } from "node:child_process";

export interface ChildSpec {
  /** Short name used in log lines, e.g. "web". */
  name: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface SupervisorOptions {
  /** How long children get to exit after a stop signal before they are killed. */
  graceMs: number;
  log: (line: Record<string, unknown>) => void;
}

export interface Supervisor {
  /** Resolves with the exit code the container should use, once every child has exited. */
  done: Promise<number>;
  /** Passes a stop signal to every running child (idempotent). */
  stop: (signal: NodeJS.Signals) => void;
}

/**
 * Settings the worker never needs (least privilege, as in `workerEnvSchema`). The worker
 * child gets the container's environment without them.
 */
export const WEB_ONLY_ENV = [
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "EMAIL_OUTBOX_TOKEN",
  "DEMO_PASSWORD",
] as const;

export function withoutKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * After a stop signal, a child has stopped cleanly if it exited 0, exited with the shell
 * convention for "ended by SIGTERM/SIGINT" (128 + 15 = 143, 128 + 2 = 130; Next.js exits
 * 143), or was ended by that signal directly.
 */
export function stoppedCleanly(code: number | null, signal: NodeJS.Signals | null): boolean {
  return code === 0 || code === 143 || code === 130 || signal === "SIGTERM" || signal === "SIGINT";
}

export function supervise(specs: ChildSpec[], options: SupervisorOptions): Supervisor {
  const { graceMs, log } = options;
  const running = new Map<string, ChildProcess>();
  let stopping = false;
  let exitCode = 0;
  let killTimer: NodeJS.Timeout | undefined;
  let resolveDone!: (code: number) => void;
  const done = new Promise<number>((resolve) => (resolveDone = resolve));

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log({ level: "info", msg: "stopping children", signal });
    for (const child of running.values()) child.kill(signal);
    killTimer = setTimeout(() => {
      for (const [name, child] of running) {
        log({ level: "warn", msg: "child did not stop in time; killing it", child: name, graceMs });
        child.kill("SIGKILL");
      }
    }, graceMs);
    killTimer.unref();
  };

  for (const spec of specs) {
    const child = spawn(spec.command, spec.args, { stdio: "inherit", env: spec.env ?? process.env });
    running.set(spec.name, child);
    log({ level: "info", msg: "child started", child: spec.name, pid: child.pid });

    child.on("error", (err) => {
      // Spawn failure (e.g. missing file). An "exit" event may not follow, so finish here.
      log({ level: "error", msg: "child failed to start", child: spec.name, error: err.message });
      if (!running.delete(spec.name)) return;
      exitCode = exitCode || 1;
      stop("SIGTERM");
      if (running.size === 0) finish();
    });

    child.on("exit", (code, signal) => {
      if (!running.delete(spec.name)) return;
      const unexpected = !stopping;
      log({
        level: unexpected ? "error" : "info",
        msg: unexpected ? "child exited unexpectedly" : "child stopped",
        child: spec.name,
        code,
        signal,
      });
      if (unexpected) {
        // Even a clean exit is a failure here: the container must not run half the app.
        exitCode = code && code > 0 ? code : 1;
        stop("SIGTERM");
      } else if (!stoppedCleanly(code, signal)) {
        exitCode = exitCode || (code && code > 0 ? code : 1);
      }
      if (running.size === 0) finish();
    });
  }

  function finish() {
    if (killTimer) clearTimeout(killTimer);
    resolveDone(exitCode);
  }

  return { done, stop };
}
