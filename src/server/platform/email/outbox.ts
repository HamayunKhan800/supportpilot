import { createHash, timingSafeEqual } from "node:crypto";
import type { EmailMessage, EmailSender } from "./types";

/**
 * Development and test "delivery": messages are kept in memory instead of sent, and read back
 * through /api/dev/email-outbox, which needs EMAIL_OUTBOX_TOKEN. Kept on globalThis so every
 * route bundle in the server process shares one outbox. Never use it on a public deployment.
 */

export interface OutboxMessage extends EmailMessage {
  sentAt: string;
}

const MAX_MESSAGES = 50;
/** Request header that carries EMAIL_OUTBOX_TOKEN. */
export const OUTBOX_TOKEN_HEADER = "x-outbox-token";
const globalForOutbox = globalThis as unknown as { __spEmailOutbox?: OutboxMessage[] };
const messages = () => (globalForOutbox.__spEmailOutbox ??= []);

export function createOutboxSender(): EmailSender {
  return {
    async send(message) {
      const box = messages();
      box.push({ ...message, sentAt: new Date().toISOString() });
      if (box.length > MAX_MESSAGES) box.splice(0, box.length - MAX_MESSAGES);
    },
  };
}

/** Newest first; only those to `to` when given (compared case-insensitively). */
export function readOutbox(to?: string): OutboxMessage[] {
  const wanted = to?.trim().toLowerCase();
  return messages()
    .filter((m) => !wanted || m.to.toLowerCase() === wanted)
    .reverse();
}

export function clearOutbox(): void {
  messages().length = 0;
}

/**
 * Whether a request may read the outbox: only when the outbox is the email provider, and only
 * with the right token (compared in constant time). Anything else should look like a 404.
 */
export function canReadOutbox(
  env: { EMAIL_PROVIDER?: string | undefined; EMAIL_OUTBOX_TOKEN?: string | undefined },
  token: string | null,
): boolean {
  if (env.EMAIL_PROVIDER !== "outbox" || !env.EMAIL_OUTBOX_TOKEN || !token) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(token), digest(env.EMAIL_OUTBOX_TOKEN));
}
