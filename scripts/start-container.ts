/**
 * Container entry point, bundled to .build/start.mjs and run from the image's /app folder:
 *
 *   node .build/start.mjs        web server + worker in one container, supervised
 *                                (scripts/lib/supervisor.ts; plan M8 D2)
 *   node .build/start.mjs web    the web server only, in this process (the web Lambda function)
 *   node .build/start.mjs jobs   the worker Lambda function's event handler
 *                                (scripts/lib/lambda-jobs.ts; plan M8 revision 2, R4)
 *
 * Every mode first loads secrets from SSM Parameter Store when SSM_PARAMETER_PATHS is set
 * (scripts/lib/ssm-env.ts), and creates the Next.js cache folder under /tmp: on Lambda
 * only /tmp is writable, and the image links .next/cache there.
 *
 * LAUNCHER_GRACE_MS (default 9000) must stay below the platform's shutdown deadline, and
 * WORKER_SHUTDOWN_TIMEOUT_MS below LAUNCHER_GRACE_MS.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createJobsServer } from "./lib/lambda-jobs";
import { planTask, runSteps } from "./lib/lambda-tasks";
import { loadParametersIntoEnv, parseParameterPaths, ssmParameterReader } from "./lib/ssm-env";
import { supervise, WEB_ONLY_ENV, withoutKeys } from "./lib/supervisor";

/** Where .next/cache points in the image (Dockerfile). */
const NEXT_CACHE_DIR = "/tmp/next-cache";

const log = (line: Record<string, unknown>) =>
  console.log(JSON.stringify({ ...line, time: new Date().toISOString(), service: "launcher" }));

function fail(msg: string): never {
  console.error(JSON.stringify({ level: "fatal", msg, service: "launcher" }));
  process.exit(1);
}

async function loadSecrets(): Promise<void> {
  const paths = parseParameterPaths(process.env.SSM_PARAMETER_PATHS);
  if (paths.length === 0) return;
  const started = Date.now();
  const names = await loadParametersIntoEnv(paths, ssmParameterReader(), process.env);
  // Names only: values are secrets.
  log({ level: "info", msg: "settings loaded from SSM", names, ms: Date.now() - started });
}

function runAll(): void {
  const graceMs = Number(process.env.LAUNCHER_GRACE_MS ?? 9_000);
  if (!Number.isInteger(graceMs) || graceMs < 1_000 || graceMs > 60_000) {
    fail("LAUNCHER_GRACE_MS must be 1000-60000");
  }
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
}

async function runWeb(): Promise<void> {
  // The Next.js standalone server starts listening when loaded, and handles its own signals.
  await import(pathToFileURL(path.resolve("server.js")).href);
}

function runJobs(): void {
  const port = Number(process.env.AWS_LWA_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail("AWS_LWA_PORT must be a port number");
  const server = createJobsServer({
    passThroughPath: process.env.AWS_LWA_PASS_THROUGH_PATH ?? "/events",
    runTask: (task, deadline) => runSteps(planTask(task, deadline, process.env), deadline, { log }),
    log,
  });
  server.listen(port, "127.0.0.1", () => log({ level: "info", msg: "jobs handler ready", port }));
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "all";
  if (!["all", "web", "jobs"].includes(mode)) fail(`Unknown mode "${mode}" (use web, jobs or nothing)`);
  await loadSecrets();
  mkdirSync(NEXT_CACHE_DIR, { recursive: true });
  if (mode === "web") await runWeb();
  else if (mode === "jobs") runJobs();
  else runAll();
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
