/**
 * Wakes the worker after a job is queued (plan M8 revision 2, R4). On AWS Lambda the worker
 * only runs when invoked: the web app sends it {"task":"drain"} as an asynchronous
 * invocation (Lambda queues it and retries failures itself), and the worker works until the
 * queues are empty (src/worker/drain.ts). Nothing polls on a schedule, so the database can
 * sleep between visits.
 *
 * Off unless WORKER_FUNCTION_NAME is set, so local runs, tests and always-on workers behave
 * exactly as before.
 *
 * Calls are made while the enqueuing transaction is still open; the worker keeps checking
 * for WORKER_DRAIN_IDLE_MS (15 s) before it stops, which covers the commit. Repeated calls
 * from one web instance within DEBOUNCE_MS are skipped: a worker woken by the first call is
 * still running then. A failed wake-up never fails the request; the job then waits for the
 * next wake-up (the next upload, ticket or the daily reset).
 */
import { getWakeEnv } from "../env";
import { logger } from "../logger";

export type InvokeAsync = (functionName: string, payload: string, signal: AbortSignal) => Promise<void>;

export const WAKE_PAYLOAD = JSON.stringify({ task: "drain" });
export const WAKE_DEBOUNCE_MS = 5_000;
export const WAKE_TIMEOUT_MS = 2_000;

export interface WakerOptions {
  functionName: string | undefined;
  invoke: InvokeAsync;
  now?: () => number;
  log?: Pick<typeof logger, "warn">;
}

export function createWorkerWaker(options: WakerOptions): () => Promise<void> {
  const { functionName, invoke } = options;
  if (!functionName) return async () => {};
  const now = options.now ?? Date.now;
  const log = options.log ?? logger;
  let lastWakeAt = Number.NEGATIVE_INFINITY;
  return async () => {
    if (now() - lastWakeAt < WAKE_DEBOUNCE_MS) return;
    lastWakeAt = now();
    try {
      await invoke(functionName, WAKE_PAYLOAD, AbortSignal.timeout(WAKE_TIMEOUT_MS));
    } catch (err) {
      lastWakeAt = Number.NEGATIVE_INFINITY; // let the next job try again
      log.warn(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        "could not wake the worker; the job waits for the next wake-up",
      );
    }
  };
}

/** The real call: Lambda Invoke with InvocationType "Event" (asynchronous, 202 Accepted). */
const lambdaInvoke: InvokeAsync = async (functionName, payload, signal) => {
  // Loaded only when waking is configured, so other runs never pay for it.
  const { InvokeCommand, LambdaClient } = await import("@aws-sdk/client-lambda");
  const globalForClient = globalThis as unknown as { __spLambdaClient?: InstanceType<typeof LambdaClient> };
  globalForClient.__spLambdaClient ??= new LambdaClient({ maxAttempts: 2 });
  const result = await globalForClient.__spLambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(payload),
    }),
    { abortSignal: signal },
  );
  if (result.StatusCode !== 202)
    throw new Error(`Lambda answered ${result.StatusCode ?? "nothing"}, not 202`);
};

let waker: (() => Promise<void>) | undefined;

/** Wakes the worker if this deployment is configured to (WORKER_FUNCTION_NAME). */
export function wakeWorker(): Promise<void> {
  waker ??= createWorkerWaker({ functionName: getWakeEnv().WORKER_FUNCTION_NAME, invoke: lambdaInvoke });
  return waker();
}
