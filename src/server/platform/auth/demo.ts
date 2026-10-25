import type { EmailSender } from "../email";
import { logger } from "../logger";

/**
 * Shared demo accounts (plan M8 step 2). Visitors to the live demo all sign in as the same
 * three users, so anything one visitor does to the account itself would break the demo for
 * the next one, or hand them lasting access. The demo accounts are recognised by their email
 * domain (DEMO_EMAIL_DOMAIN), which only the seed script uses.
 */

export function isDemoEmail(email: string | null | undefined, demoDomain: string): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  return (
    at > 0 &&
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() === demoDomain.toLowerCase()
  );
}

/**
 * Auth endpoints a demo account may not call. Each one either affects other visitors
 * (signing everyone out, removing or demoting members), grants access that outlives the daily
 * reset (inviting your own address, linking your own Google or GitHub account), or leaves
 * clutter (new workspaces). Profile edits, email change, account and workspace deletion are
 * already closed for everyone (auth.ts disabledPaths and library defaults).
 */
export const DEMO_LOCKED_PATHS: ReadonlySet<string> = new Set([
  "/change-password",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/unlink-account",
  "/organization/create",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/leave",
]);

export const DEMO_LOCKED_MESSAGE =
  "This is turned off for the shared demo accounts. Create your own account to try it.";

export const DEMO_SIGN_UP_MESSAGE = "This email domain is reserved for the demo accounts.";

/**
 * Never emails a demo address: nobody reads those inboxes, and before a deployment sets
 * DEMO_EMAIL_DOMAIN the default domain is not ours, so a reset link could reach a stranger.
 * Skipped sends look the same to the caller (no account enumeration).
 */
export function skipDemoRecipients(sender: EmailSender, demoDomain: string): EmailSender {
  return {
    send: async (message) => {
      if (isDemoEmail(message.to, demoDomain)) {
        logger.info({ event: "email.skipped_demo_recipient" }, "email to a demo account skipped");
        return;
      }
      await sender.send(message);
    },
  };
}
