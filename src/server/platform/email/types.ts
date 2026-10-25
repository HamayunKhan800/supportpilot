/** Shared email types (kept apart so the implementations do not import index.ts). */

/** Plain text only: no HTML, so nothing in a message (a user's name) can inject markup. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    /** HTTP status from the provider, when there was a response. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}
