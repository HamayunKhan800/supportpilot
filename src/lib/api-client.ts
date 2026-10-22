/**
 * Minimal browser client for /api/v1. Problem Details (RFC 9457) become a friendly
 * message plus per-field errors that forms can show next to each input.
 */
export interface ApiProblem {
  status: number;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: ApiProblem; message: string };

const MESSAGES: Record<number, string> = {
  400: "Please check the highlighted fields.",
  404: "We couldn't find that. The link may be wrong or no longer active.",
  409: "This request can no longer be changed.",
  413: "That message is too long.",
  429: "Too many attempts. Please wait a few minutes and try again.",
};

export function problemMessage(problem: ApiProblem, retryAfterSeconds?: number): string {
  // Conflicts carry a specific, user-facing explanation (stale version, closed request…).
  if (problem.status === 409 && problem.detail) return problem.detail;
  if (problem.status === 429 && retryAfterSeconds) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return MESSAGES[problem.status] ?? "Something went wrong on our side. Please try again.";
}

/** First message per field, for inline display. */
export function fieldErrors(problem: ApiProblem): Record<string, string> {
  return Object.fromEntries(
    Object.entries(problem.errors ?? {}).map(([k, v]) => [k, v[0] ?? "Invalid value."]),
  );
}

export const postJson = <T>(url: string, body: unknown) => sendJson<T>("POST", url, body);
export const patchJson = <T>(url: string, body: unknown) => sendJson<T>("PATCH", url, body);

async function sendJson<T>(method: "POST" | "PATCH", url: string, body: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    const problem = { status: 0 };
    return { ok: false, problem, message: "You appear to be offline. Check your connection and try again." };
  }
  const data = await res.json().catch(() => undefined);
  if (res.ok) return { ok: true, data: data as T };
  const problem: ApiProblem = { status: res.status, ...(typeof data === "object" ? data : {}) };
  const retry = Number(res.headers.get("retry-after")) || undefined;
  return { ok: false, problem, message: problemMessage(problem, retry) };
}
