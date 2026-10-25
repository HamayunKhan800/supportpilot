/**
 * Fixed messages for the errors Better Auth sends back to /sign-in as ?error=<code> after a
 * Google or GitHub sign-in (better-auth oauth2/errors). The code itself is never shown.
 */
const SOCIAL_ERRORS: Record<string, string> = {
  account_not_linked:
    "An account with this email already exists. Sign in with your email and password instead.",
  email_not_verified:
    "Your email with that provider isn't verified. Verify it there, or sign up with a password.",
  email_not_found: "That provider didn't share an email address. Sign up with a password instead.",
  access_denied: "Sign-in was cancelled.",
};
const FALLBACK = "That sign-in didn't work. Please try again or use your password.";

export function socialErrorMessage(code: unknown): string {
  if (typeof code !== "string" || !code) return "";
  return Object.hasOwn(SOCIAL_ERRORS, code) ? SOCIAL_ERRORS[code]! : FALLBACK;
}
