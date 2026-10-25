import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { safeRedirect } from "@/lib/safe-redirect";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Check your email" };

/**
 * Where sign-up and an unverified sign-in land: enter the 6-digit code. The page looks the same
 * whether or not the address already had an account (T3): the owner of a taken address gets a
 * notice instead of a code.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  if (!getAuthFeatures().email) notFound();
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email.trim().slice(0, 254) : "";
  if (!email.includes("@")) redirect("/sign-in");
  const next = safeRedirect(typeof params.next === "string" ? params.next : undefined);
  return <VerifyEmailForm email={email} next={next} fromSignIn={params.from === "sign-in"} />;
}
