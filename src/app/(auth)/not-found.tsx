import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/**
 * "Not found" inside the sign-in card. The root not-found page brings its own logo and <main>;
 * here the card already has both, so this is only the card's content. Shown, for example, for
 * the password reset and email code pages while email is switched off.
 */
export default function AuthNotFound() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground text-sm">
        This page isn&apos;t available. The link may have expired, or this feature is switched off here.
      </p>
      <Link
        href="/sign-in"
        className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 w-full" })}
      >
        Back to sign in
      </Link>
    </div>
  );
}
