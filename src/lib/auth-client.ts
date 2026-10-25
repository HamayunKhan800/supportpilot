"use client";

import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "@/server/platform/auth/permissions";

/**
 * Browser auth client. Calls /api/auth/* on the current origin (no baseURL), where
 * rate limiting and CSRF/origin checks apply. `permissions` is pure data, safe to bundle.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles }), emailOTPClient()],
});

/** Plain-language messages for auth errors shown in forms. */
export function authErrorMessage(error: { status?: number; message?: string; code?: string } | null): string {
  if (!error) return "";
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (error.code === "PASSWORD_COMPROMISED") {
    return "This password has appeared in a data breach. Please choose a different one.";
  }
  if (error.status === 401 && error.code === "INVALID_EMAIL_OR_PASSWORD")
    return "Incorrect email or password.";
  if (error.code === "INVALID_OTP") return "That code isn't right. Check the newest email and try again.";
  if (error.code === "OTP_EXPIRED") return "That code has expired. Send a new one.";
  if (error.code === "TOO_MANY_ATTEMPTS") return "Too many wrong tries. Send a new code.";
  return error.message || "Something went wrong. Please try again.";
}
