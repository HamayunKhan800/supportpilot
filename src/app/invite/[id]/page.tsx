import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
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
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;ve been invited</h1>
          <p className="text-muted-foreground text-sm">
            Sign in or create an account using the email address the invitation was sent to.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <Link href={`/sign-in?next=${next}`} className={buttonVariants({ size: "lg", className: "h-10" })}>
            Sign in
          </Link>
          <Link
            href={`/sign-up?next=${next}`}
            className={buttonVariants({ size: "lg", variant: "outline", className: "h-10" })}
          >
            Create an account
          </Link>
        </div>
      </>
    );
  } else {
    const inv = await loadInvitation(h, id);
    body = inv ? (
      <>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Join {inv.organizationName}</h1>
          <p className="text-muted-foreground text-sm">
            {inv.inviterEmail} invited you to join as <strong>{inv.role}</strong>.
          </p>
        </div>
        <div className="mt-6">
          <InvitationResponse invitationId={inv.id} workspaceId={inv.organizationId} />
        </div>
      </>
    ) : (
      <>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
          <p className="text-muted-foreground text-sm">
            This invitation has expired, was already used, or was sent to a different email address. You are
            signed in as {session.user.email}.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/app" className={buttonVariants({ variant: "outline" })}>
            Go to the app
          </Link>
          <SignOutButton />
        </div>
      </>
    );
  }

  return <AuthShell>{body}</AuthShell>;
}
