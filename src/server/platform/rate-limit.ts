import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { appRateLimit } from "./db/schema";
import { getEnv } from "./env";

/**
 * Fixed-window rate limiter in PostgreSQL (plan D7): shared by every app instance,
 * no extra infrastructure. One atomic upsert per check.
 * Stale rows are harmless (one per key) and will be pruned by a scheduled job (M5/M8).
 */
export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Builds a storage key. Identifying parts (IP addresses, tokens) are HMAC'd with the
 * server secret, so the table never holds raw personal data or usable tokens.
 */
export function rateLimitKey(scope: string, ...parts: string[]): string {
  const digest = createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(parts.join("\u0000"))
    .digest("base64url")
    .slice(0, 32);
  return `${scope}:${digest}`;
}

export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const start = windowStart(now, rule.windowSeconds);
  const [row] = await getDb()
    .db.insert(appRateLimit)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: appRateLimit.key,
      set: {
        count: sql`CASE WHEN ${appRateLimit.windowStart} = excluded.window_start THEN ${appRateLimit.count} + 1 ELSE 1 END`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ count: appRateLimit.count });
  const count = row!.count;
  const resetMs = start.getTime() + rule.windowSeconds * 1000 - now.getTime();
  return {
    allowed: count <= rule.max,
    remaining: Math.max(0, rule.max - count),
    retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
  };
}

/**
 * Client IP for rate limiting. X-Forwarded-For is trivially spoofable, so it is used
 * only when TRUST_PROXY_HEADERS is on (a proxy we control overwrites it). With a single
 * trusted proxy, the rightmost entry is the address that proxy saw.
 */
export function clientIp(headers: Headers, trustProxyHeaders: boolean): string {
  if (!trustProxyHeaders) return "unknown";
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return entries.at(-1) ?? "unknown";
}
