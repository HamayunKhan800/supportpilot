import { EmailSendError, type EmailMessage, type EmailSender } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resend's REST API (https://resend.com/docs/api-reference/emails/send-email) over plain fetch,
 * so no extra package. Sending to anyone other than the account owner needs a verified domain.
 * Not retried: these emails are user-triggered and the user can ask again.
 */
export function createResendSender(options: {
  apiKey: string;
  from: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): EmailSender {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(message: EmailMessage) {
      let res: Response;
      try {
        res = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch {
        throw new EmailSendError("email provider unreachable or timed out");
      }
      // The response body can echo the recipient, so only the status is kept.
      if (!res.ok) throw new EmailSendError("email provider rejected the message", res.status);
    },
  };
}
