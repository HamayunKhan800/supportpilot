import type { Metadata } from "next";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { safeRedirect } from "@/lib/safe-redirect";
import { SignUpForm } from "./sign-up-form";

/** A plausible address from ?email=, or nothing. It only fills the field; sign-up validates as usual. */
function prefillEmail(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length > 254) return "";
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const next = safeRedirect(typeof params.next === "string" ? params.next : undefined);
  return <SignUpForm next={next} features={getAuthFeatures()} defaultEmail={prefillEmail(params.email)} />;
}
