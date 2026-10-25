/**
 * Container entry point for single-service hosting (plan M8 D2), bundled to
 * .build/start.mjs and run from the image's /app folder:
 *
 *   node .build/start.mjs
 *
 * Starts the Next.js server (server.js) and the background worker (.build/worker.mjs) and
 * supervises both (scripts/lib/supervisor.ts). The image's default command is still the
 * web server alone, for platforms that run the worker as its own service.
 *
 * LAUNCHER_GRACE_MS (default 9000) must stay below the platform's shutdown deadline
 * (Cloud Run: 10 seconds), and WORKER_SHUTDOWN_TIMEOUT_MS below LAUNCHER_GRACE_MS.
 */
import { supervise, WEB_ONLY_ENV, withoutKeys } from "./lib/supervisor";

const graceMs = Number(process.env.LAUNCHER_GRACE_MS ?? 9_000);
if (!Number.isInteger(graceMs) || graceMs < 1_000 || graceMs > 60_000) {
  console.error(JSON.stringify({ level: "fatal", msg: "LAUNCHER_GRACE_MS must be 1000-60000" }));
  process.exit(1);
}

const log = (line: Record<string, unknown>) =>
  console.log(JSON.stringify({ ...line, time: new Date().toISOString(), service: "launcher" }));

const supervisor = supervise(
  [
    { name: "web", command: process.execPath, args: ["server.js"] },
    {
      name: "worker",
      command: process.execPath,
      args: [".build/worker.mjs"],
      env: withoutKeys(process.env, WEB_ONLY_ENV),
    },
  ],
  { graceMs, log },
);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => supervisor.stop(signal));
}

void supervisor.done.then((code) => {
  log({ level: code === 0 ? "info" : "error", msg: "launcher exiting", code });
  process.exit(code);
});
