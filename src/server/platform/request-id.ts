export const REQUEST_ID_HEADER = "x-request-id";

// Accept a caller-supplied ID only if it is short and safe to log (prevents
// log injection / unbounded header values); otherwise generate a fresh one.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function resolveRequestId(incoming: string | null | undefined): string {
  if (incoming && SAFE_ID.test(incoming)) return incoming;
  return crypto.randomUUID();
}
