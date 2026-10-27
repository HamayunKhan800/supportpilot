/**
 * The worker Lambda function's event handler (plan M8 revision 2, R4 and R5).
 *
 * The Lambda Web Adapter turns every non-HTTP invocation into `POST <pass-through path>`
 * (default /events) on this server, with the invocation's JSON payload as the body, and
 * returns our response as the invocation result. A 5xx response fails the invocation when
 * the function sets AWS_LWA_ERROR_STATUS_CODES, so Lambda counts it as an error and retries
 * asynchronous invocations.
 *
 * Accepted payloads (anything else is refused with 400):
 *   {"task":"drain"}       run the worker until the queues are empty (sent by the web app)
 *   {"task":"migrate"}     database migrations + job queues (deploy pipeline)
 *   {"task":"seed-reset"}  daily demo reset, then drain to index the articles (scheduler)
 *
 * The server listens on 127.0.0.1 only: the adapter runs in the same sandbox, and the
 * function has no public URL, so only callers allowed to invoke the function reach it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

export const jobsEventSchema = z.object({ task: z.enum(["drain", "migrate", "seed-reset"]) }).strict();
export type JobsTask = z.infer<typeof jobsEventSchema>["task"];

export interface StepResult {
  step: string;
  code: number;
  durationMs: number;
}

export interface TaskResult {
  ok: boolean;
  steps: StepResult[];
}

/** Runs one task; must finish (or give up) before `deadline` (epoch milliseconds). */
export type TaskRunner = (task: JobsTask, deadline: number) => Promise<TaskResult>;

export interface JobsServerOptions {
  passThroughPath: string;
  runTask: TaskRunner;
  log: (line: Record<string, unknown>) => void;
  now?: () => number;
  /** Used when the adapter's context header has no deadline. */
  fallbackBudgetMs?: number;
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * The invocation's deadline from the adapter's `x-amzn-lambda-context` header (the Lambda
 * runtime context as JSON). Its field is `deadline` in the Rust runtime the adapter uses;
 * `deadline_ms` is accepted too because the adapter's guide spells it that way.
 */
export function deadlineFrom(header: string | undefined, now: number, fallbackBudgetMs: number): number {
  if (header) {
    try {
      const context = JSON.parse(header) as Record<string, unknown>;
      for (const field of ["deadline", "deadline_ms"]) {
        const value = Number(context[field]);
        if (Number.isFinite(value) && value > now) return value;
      }
    } catch {
      // fall through to the fallback budget
    }
  }
  return now + fallbackBudgetMs;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createJobsServer(options: JobsServerOptions): Server {
  const { passThroughPath, runTask, log } = options;
  const now = options.now ?? Date.now;
  const fallbackBudgetMs = options.fallbackBudgetMs ?? 14 * 60_000;
  let busy = false;

  return createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") return send(res, 200, { status: "ok" });
    if (path !== passThroughPath) return send(res, 404, { error: "not found" });
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });

    void (async () => {
      const raw = await readBody(req);
      if (raw === null) return send(res, 413, { error: "event too large" });
      let parsed: ReturnType<typeof jobsEventSchema.safeParse>;
      try {
        parsed = jobsEventSchema.safeParse(JSON.parse(raw));
      } catch {
        parsed = jobsEventSchema.safeParse(undefined);
      }
      if (!parsed.success) {
        log({ level: "warn", msg: "unknown event refused" });
        return send(res, 400, { error: 'expected {"task":"drain"|"migrate"|"seed-reset"}' });
      }
      // Lambda sends one event at a time to an instance; this guards local misuse.
      if (busy) return send(res, 409, { error: "a task is already running" });
      busy = true;
      const { task } = parsed.data;
      const headerValue = req.headers["x-amzn-lambda-context"];
      const deadline = deadlineFrom(
        Array.isArray(headerValue) ? headerValue[0] : headerValue,
        now(),
        fallbackBudgetMs,
      );
      log({ level: "info", msg: "task started", task, budgetMs: deadline - now() });
      try {
        const result = await runTask(task, deadline);
        log({ level: result.ok ? "info" : "error", msg: "task finished", task, ...result });
        send(res, result.ok ? 200 : 500, { task, ...result });
      } catch (err) {
        log({
          level: "error",
          msg: "task crashed",
          task,
          error: err instanceof Error ? err.message : String(err),
        });
        send(res, 500, { task, ok: false, steps: [] });
      } finally {
        busy = false;
      }
    })();
  });
}
