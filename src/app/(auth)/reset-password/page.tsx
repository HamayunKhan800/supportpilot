import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { ResetPasswordForm } from "./reset-password-form";

/** With email switched off the page is a 404, and the tab says so too. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { title: getAuthFeatures().email ? "Choose a new password" : "Page not found" };
}

/**
 * The reset link (/api/auth/reset-password/<token>) checks the token and lands here with
 * ?token=… or, if it has expired or was used, ?error=INVALID_TOKEN. Sent with no-referrer
 * (security-headers.ts) so the token never leaks to another site.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  if (!getAuthFeatures().email) notFound();
  const params = await searchParams;
  const token = typeof params.token === "string" && !params.error ? params.token : "";
  return <ResetPasswordForm token={token} />;
}
