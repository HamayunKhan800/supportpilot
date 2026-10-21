import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getAuth } from "@/server/platform/auth";
import { getSessionContext } from "@/server/platform/auth/context";
import { InvitationResponse } from "./invitation-response";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

async function loadInvitation(h: Headers, id: string) {
  try {
    return await getAuth().api.getInvitation({ headers: h, query: { id } });
  } catch {
    return null; // not found, expired, already used, or addressed to another email
  }
}

export default async function InvitePage({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const h = await headers();
  const session = await getSessionContext(h);
  const next = encodeURIComponent(`/invite/${id}`);

  let body: React.ReactNode;
  if (!session) {
    // Reveal nothing about the invitation until the invitee signs in.
    body = (
      <>
        <CardHeader>
          <h1 className="text-xl leading-snug font-semibold">You&apos;ve been invited</h1>
          <CardDescription>
            Sign in or create an account using the email address the invitation was sent to.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Link href={`/sign-in?next=${next}`} className={buttonVariants({ size: "lg" })}>
            Sign in
          </Link>
          <Link href={`/sign-up?next=${next}`} className={buttonVariants({ size: "lg", variant: "outline" })}>
            Create an account
          </Link>
        </CardContent>
      </>
    );
  } else {
    const inv = await loadInvitation(h, id);
    body = inv ? (
      <>
        <CardHeader>
          <h1 className="text-xl leading-snug font-semibold">Join {inv.organizationName}</h1>
          <CardDescription>
            {inv.inviterEmail} invited you to join as <strong>{inv.role}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationResponse invitationId={inv.id} workspaceId={inv.organizationId} />
        </CardContent>
      </>
    ) : (
      <>
        <CardHeader>
          <h1 className="text-xl leading-snug font-semibold">Invitation unavailable</h1>
          <CardDescription>
            This invitation has expired, was already used, or was sent to a different email address. You are
            signed in as {session.user.email}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/app" className={buttonVariants({ variant: "outline" })}>
            Go to the app
          </Link>
          <SignOutButton />
        </CardContent>
      </>
    );
  }

  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">{body}</Card>
    </main>
  );
}
