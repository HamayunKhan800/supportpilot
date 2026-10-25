import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

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
