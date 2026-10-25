import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  await connection();
  // Password reset needs email. Without it there is no page (and no link to it).
  if (!getAuthFeatures().email) notFound();
  return <ForgotPasswordForm />;
}
