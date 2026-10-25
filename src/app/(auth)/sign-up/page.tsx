import type { Metadata } from "next";
import { getAuthFeatures } from "@/server/platform/auth/features";
import { safeRedirect } from "@/lib/safe-redirect";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const next = safeRedirect(typeof params.next === "string" ? params.next : undefined);
  return <SignUpForm next={next} features={getAuthFeatures()} />;
}
