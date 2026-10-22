import { ZodError } from "zod";

/**
 * Domain errors → RFC 9457 Problem Details (application/problem+json).
 * Unknown errors become a generic 500. Internal details are logged, never
 * returned to clients (OWASP A10: Mishandling of Exceptional Conditions).
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    detail?: string,
    public readonly fieldErrors?: Record<string, string[]>,
    /** Extra response headers, e.g. Retry-After on 429. */
    public readonly headers?: Record<string, string>,
    /** Extra Problem Details members (RFC 9457 §3.2), e.g. the id of a duplicate. */
    public readonly extensions?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = "AppError";
  }
}

export const Errors = {
  badRequest: (detail?: string, fieldErrors?: Record<string, string[]>) =>
    new AppError(400, "bad_request", "Bad Request", detail, fieldErrors),
  unauthorized: () => new AppError(401, "unauthorized", "Unauthorized", "Authentication required."),
  forbidden: () => new AppError(403, "forbidden", "Forbidden", "You do not have access to this action."),
  /** Used for cross-tenant access too, so resource existence is not revealed. */
  notFound: () => new AppError(404, "not_found", "Not Found", "The requested resource was not found."),
  conflict: (detail?: string, code = "conflict", extensions?: Record<string, string>) =>
    new AppError(409, code, "Conflict", detail, undefined, undefined, extensions),
  payloadTooLarge: (maxBytes: number) =>
    new AppError(
      413,
      "payload_too_large",
      "Payload Too Large",
      `Request bodies are limited to ${maxBytes} bytes.`,
    ),
  fileTooLarge: (maxBytes: number) =>
    new AppError(
      413,
      "payload_too_large",
      "Payload Too Large",
      `Files are limited to ${maxBytes / 1024 / 1024} MB.`,
    ),
  unsupportedMediaType: (detail = "Send a JSON body (application/json).") =>
    new AppError(415, "unsupported_media_type", "Unsupported Media Type", detail),
  /** RFC 9110 §10.2.3: Retry-After tells well-behaved clients when to come back. */
  tooManyRequests: (retryAfterSeconds?: number) =>
    new AppError(
      429,
      "rate_limited",
      "Too Many Requests",
      "Too many requests. Please retry later.",
      undefined,
      retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : undefined,
    ),
  serviceUnavailable: (detail?: string, retryAfterSeconds?: number) =>
    new AppError(
      503,
      "service_unavailable",
      "Service Unavailable",
      detail,
      undefined,
      retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : undefined,
    ),
  /** An upstream service (e.g. the AI provider) failed in a way retrying won't fix. */
  badGateway: (detail?: string) => new AppError(502, "bad_gateway", "Bad Gateway", detail),
};

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: Record<string, string[]>;
  [extension: string]: unknown;
}

const PROBLEM_TYPE_BASE = "https://supportpilot.dev/problems/";

export function toProblem(err: unknown, ctx: { requestId?: string; instance?: string } = {}): ProblemDetails {
  if (err instanceof AppError) {
    return {
      // First, so an extension can never replace a standard member.
      ...err.extensions,
      type: PROBLEM_TYPE_BASE + err.code,
      title: err.title,
      status: err.status,
      detail: err.message,
      instance: ctx.instance,
      requestId: ctx.requestId,
      ...(err.fieldErrors ? { errors: err.fieldErrors } : {}),
    };
  }
  if (err instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "(root)";
      (errors[key] ??= []).push(issue.message);
    }
    return {
      type: PROBLEM_TYPE_BASE + "validation_error",
      title: "Validation Failed",
      status: 400,
      detail: "One or more fields are invalid.",
      instance: ctx.instance,
      requestId: ctx.requestId,
      errors,
    };
  }
  return {
    type: PROBLEM_TYPE_BASE + "internal_error",
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred.",
    instance: ctx.instance,
    requestId: ctx.requestId,
  };
}

export function problemResponse(problem: ProblemDetails, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/problem+json");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(problem), { status: problem.status, headers: h });
}
