import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { ForgotPasswordForm } from "./forgot-password-form";

/** With email switched off the page is a 404, and the tab says so too. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { title: getAuthFeatures().email ? "Forgot password" : "Page not found" };
}

export default async function ForgotPasswordPage() {
  await connection();
  // Password reset needs email. Without it there is no page (and no link to it).
  if (!getAuthFeatures().email) notFound();
  return <ForgotPasswordForm />;
}
