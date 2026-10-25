import type { Metadata } from "next";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { safeRedirect } from "@/lib/safe-redirect";
import { socialErrorMessage } from "../social-errors";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

/** Messages other pages can ask for with ?notice=… (fixed texts, never echoed from the URL). */
const NOTICES: Record<string, string> = {
  "password-reset": "Password changed. Please sign in with your new password.",
  "email-verified": "Email confirmed. Please sign in.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeRedirect(typeof params.next === "string" ? params.next : undefined);
  const notice =
    params.registered === "1"
      ? "Account created. Please sign in."
      : (typeof params.notice === "string" && NOTICES[params.notice]) || "";
  return (
    <SignInForm
      next={next}
      notice={notice}
      providerError={socialErrorMessage(params.error)}
      features={getAuthFeatures()}
    />
  );
}
