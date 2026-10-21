import type { Metadata } from "next";
import { safeRedirect } from "@/lib/safe-redirect";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const next = safeRedirect(typeof params.next === "string" ? params.next : undefined);
  return <SignUpForm next={next} />;
}
