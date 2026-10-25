import type { EmailMessage } from "../email";
import { RESET_PASSWORD_EXPIRES_IN_SECONDS, VERIFICATION_CODE_EXPIRES_IN_SECONDS } from "./policy";

/**
 * The account emails (docs/plans/accounts-and-email.md). Plain text, and nothing a user typed
 * (such as a name) is included, so a message can't be used to carry someone else's words.
 */

const minutes = (seconds: number) => Math.round(seconds / 60);
const SIGN_OFF = "\n\nSupportPilot";

export function resetPasswordEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: "Reset your SupportPilot password",
    text:
      `Someone asked to reset the password for this email address. To choose a new password, open this link ` +
      `within ${minutes(RESET_PASSWORD_EXPIRES_IN_SECONDS)} minutes. It works once:\n\n${url}\n\n` +
      `If you didn't ask for this, you can ignore this email. Your password won't change.${SIGN_OFF}`,
  };
}

export function passwordChangedEmail(to: string, signInUrl: string): EmailMessage {
  return {
    to,
    subject: "Your SupportPilot password was changed",
    text:
      `The password for your SupportPilot account was just changed, and every other device was signed out.\n\n` +
      `If this was you, there's nothing to do. If it wasn't, reset your password now from the sign-in page ` +
      `(choose "Forgot password?"):\n\n${signInUrl}${SIGN_OFF}`,
  };
}

export function verificationCodeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your SupportPilot verification code`,
    text:
      `Your verification code is:\n\n${code}\n\n` +
      `It expires in ${minutes(VERIFICATION_CODE_EXPIRES_IN_SECONDS)} minutes. ` +
      `If you didn't create a SupportPilot account, you can ignore this email.${SIGN_OFF}`,
  };
}

/**
 * Sent to the owner of an email address when someone tries to sign up with it again. The sign-up
 * response looks the same either way (no account enumeration, T3); this tells the real owner.
 */
export function signUpAttemptEmail(to: string, signInUrl: string): EmailMessage {
  return {
    to,
    subject: "Someone tried to create a SupportPilot account with your email",
    text:
      `Someone tried to create a new SupportPilot account with this email address, but you already have one.\n\n` +
      `If it was you, sign in instead (or choose "Forgot password?" there):\n\n${signInUrl}\n\n` +
      `If it wasn't you, you can ignore this email. Nothing was changed.${SIGN_OFF}`,
  };
}
