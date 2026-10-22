import { createHash, randomBytes } from "node:crypto";

/**
 * Customer tracking tokens (plan D1, threat T6). 32 random bytes = 256 bits, base64url
 * (43 characters). Only the SHA-256 hash is stored, so a database leak reveals no
 * working links. A fast hash is appropriate here: the input is high-entropy random
 * data, not a human-chosen password, so brute force is infeasible either way.
 */
export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateTrackingToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Hash for lookup, or null when the input can't be a token (rejected before any query). */
export function hashTrackingToken(candidate: string): string | null {
  return TOKEN_PATTERN.test(candidate) ? hashToken(candidate) : null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
