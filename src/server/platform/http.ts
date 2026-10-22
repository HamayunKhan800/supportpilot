import type { Logger } from "pino";
import { AppError, problemResponse, toProblem } from "./errors";
import { logger } from "./logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

export interface RouteContext<P = unknown> {
  params: P;
  requestId: string;
  log: Logger;
}

type Handler<P> = (req: Request, ctx: RouteContext<P>) => Promise<Response>;

/**
 * Wraps every API route handler:
 * - request ID (from proxy, or generated) on logs + response
 * - one structured "request completed" log line with status and duration
 * - any thrown error → RFC 9457 Problem Details; 5xx details logged, never leaked
 */
export interface RouteOptions {
  /** Leave the request path out of error bodies (`instance`) when it contains a secret. */
  redactPath?: boolean;
}

export function withRoute<P = unknown>(name: string, handler: Handler<P>, options: RouteOptions = {}) {
  return async (req: Request, nextCtx?: { params?: Promise<P> | P }): Promise<Response> => {
    const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));
    const log = logger.child({ requestId, route: name });
    const start = performance.now();
    const method = req.method;
    let status = 500;
    try {
      const params = (await nextCtx?.params) as P;
      const res = await handler(req, { params, requestId, log });
      const headers = new Headers(res.headers);
      headers.set(REQUEST_ID_HEADER, requestId);
      status = res.status;
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      const instance = options.redactPath ? undefined : new URL(req.url).pathname;
      const problem = toProblem(err, { requestId, instance });
      status = problem.status;
      if (!(err instanceof AppError) && problem.status >= 500) {
        // Unexpected failure: full detail (incl. stack) for debugging/alerting.
        log.error({ err: serializeError(err) }, "unhandled error in route");
      } else if (problem.status >= 500) {
        // Deliberate 5xx (e.g. dependency down): expected, so no stack noise.
        log.error({ status: problem.status, type: problem.type }, "request failed");
      } else {
        log.warn({ status: problem.status, type: problem.type }, "request rejected");
      }
      const extra = err instanceof AppError ? err.headers : undefined;
      return problemResponse(problem, { ...extra, [REQUEST_ID_HEADER]: requestId });
    } finally {
      log.info({ method, status, durationMs: Math.round(performance.now() - start) }, "request completed");
    }
  };
}

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { message: String(err) };
}
