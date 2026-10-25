import type { Env } from "../env";
import { logger } from "../logger";
import { createOutboxSender } from "./outbox";
import { createResendSender } from "./resend";
import { EmailSendError, type EmailMessage, type EmailSender } from "./types";

export { EmailSendError, type EmailMessage, type EmailSender } from "./types";

/**
 * Outbound email (docs/plans/accounts-and-email.md). One small interface with two real
 * implementations: Resend for deployments with a verified domain, and an in-memory outbox for
 * development and tests. No email setting = no email features (null).
 */

export type EmailEnv = Pick<Env, "EMAIL_PROVIDER" | "EMAIL_FROM" | "RESEND_API_KEY">;

export function createEmailSender(env: EmailEnv): EmailSender | null {
  if (env.EMAIL_PROVIDER === "resend") {
    // Both are guaranteed by the settings check (env.ts) when the provider is resend.
    return createResendSender({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! });
  }
  if (env.EMAIL_PROVIDER === "outbox") return createOutboxSender();
  return null;
}

/** Which flow an email belongs to, for logs (never the address or the content). */
export type EmailKind = "password-reset" | "password-changed" | "verification-code" | "sign-up-attempt";

/**
 * Sends without waiting, so a response never takes longer for an existing account than for an
 * unknown one (Better Auth and OWASP advice against timing attacks). Failures are logged.
 */
export function sendInBackground(sender: EmailSender, message: EmailMessage, kind: EmailKind): void {
  void sender.send(message).catch((err: unknown) => {
    const status = err instanceof EmailSendError ? err.status : undefined;
    logger.warn({ event: "email.send_failed", kind, status }, "email could not be sent");
  });
}
