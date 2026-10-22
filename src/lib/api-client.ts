/**
 * Minimal browser client for /api/v1. Problem Details (RFC 9457) become a friendly
 * message plus per-field errors that forms can show next to each input.
 */
export interface ApiProblem {
  status: number;
  type?: string;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
  /** Extension members, e.g. `reason` for a rejected file or `existingDocumentId`. */
  [extension: string]: unknown;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: ApiProblem; message: string };

const MESSAGES: Record<number, string> = {
  400: "Please check the highlighted fields.",
  404: "We couldn't find that. The link may be wrong or no longer active.",
  409: "This request can no longer be changed.",
  413: "That message is too long.",
  429: "Too many attempts. Please wait a few minutes and try again.",
  502: "The AI provider rejected the request. Ask an admin to check the AI settings.",
  503: "The AI provider is unavailable right now. Please try again shortly.",
};

/** Per-call replacements for the generic messages above (e.g. 413 for a file, not a message). */
export type MessageOverrides = Partial<Record<number, string>>;

export function problemMessage(
  problem: ApiProblem,
  retryAfterSeconds?: number,
  overrides: MessageOverrides = {},
): string {
  // Conflicts carry a specific, user-facing explanation (stale version, closed request…).
  if (problem.status === 409 && problem.detail) return problem.detail;
  // A rejected upload says exactly what is wrong with the file (written for end users).
  if (problem.status === 400 && typeof problem.reason === "string" && problem.detail) return problem.detail;
  if (problem.status === 429 && retryAfterSeconds) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return (
    overrides[problem.status] ??
    MESSAGES[problem.status] ??
    "Something went wrong on our side. Please try again."
  );
}

/** First message per field, for inline display. */
export function fieldErrors(problem: ApiProblem): Record<string, string> {
  return Object.fromEntries(
    Object.entries(problem.errors ?? {}).map(([k, v]) => [k, v[0] ?? "Invalid value."]),
  );
}

export const postJson = <T>(url: string, body: unknown, overrides?: MessageOverrides) =>
  send<T>("POST", url, { json: body, overrides });
export const patchJson = <T>(url: string, body: unknown, overrides?: MessageOverrides) =>
  send<T>("PATCH", url, { json: body, overrides });
/** Multipart upload; the browser sets the boundary, so no Content-Type here. */
export const postForm = <T>(url: string, form: FormData, overrides?: MessageOverrides) =>
  send<T>("POST", url, { form, overrides });
export const postEmpty = <T>(url: string, overrides?: MessageOverrides) =>
  send<T>("POST", url, { overrides });
export const deleteResource = (url: string, overrides?: MessageOverrides) =>
  send<undefined>("DELETE", url, { overrides });

async function send<T>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  opts: { json?: unknown; form?: FormData; overrides?: MessageOverrides },
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: "same-origin" });
  } catch {
    const problem = { status: 0 };
    return { ok: false, problem, message: "You appear to be offline. Check your connection and try again." };
  }
  // 204 No Content (a delete) has no body to read.
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (res.ok) return { ok: true, data: data as T };
  const problem: ApiProblem = { status: res.status, ...(data && typeof data === "object" ? data : {}) };
  const retry = Number(res.headers.get("retry-after")) || undefined;
  return { ok: false, problem, message: problemMessage(problem, retry, opts.overrides) };
}
