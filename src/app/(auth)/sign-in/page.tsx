import type { Metadata } from "next";
import { safeRedirect } from "@/lib/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeRedirect(typeof params.next === "string" ? params.next : undefined);
  return <SignInForm next={next} registered={params.registered === "1"} />;
}
