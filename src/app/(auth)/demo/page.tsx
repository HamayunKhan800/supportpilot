import type { Metadata } from "next";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { buttonVariants } from "@/components/ui/button";
import type { DemoError, DemoRole } from "@/server/platform/auth/demo-sign-in";
import { getEnv } from "@/server/platform/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Live demo" };

/** The three shared accounts, in the order most visitors want them. */
const ROLES: { role: DemoRole; name: string; does: string }[] = [
  { role: "agent", name: "Agent", does: "Answer tickets: review AI drafts, check their sources and send." },
  { role: "admin", name: "Admin", does: "Everything an agent does, plus help articles and AI settings." },
  { role: "owner", name: "Owner", does: "Everything, plus members, the audit log and usage." },
];

const ERRORS: Record<DemoError, string> = {
  busy: "Too many demo sign-ins from your network just now. Please wait a minute and try again.",
  unavailable: "The demo could not open. Please try again, or sign in with the demo details in the README.",
};

export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const params = await searchParams;
  const enabled = Boolean(getEnv().DEMO_PASSWORD);
  const error =
    typeof params.error === "string" && params.error in ERRORS ? ERRORS[params.error as DemoError] : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Try the live demo</h1>
        <p className="text-muted-foreground text-sm">
          A shared sample workspace for Nimbus, a made-up company. Pick a role; there is nothing to fill in.
        </p>
      </div>
      {enabled ? (
        <>
          <FormAlert message={error} />
          <ul className="flex flex-col gap-3" aria-label="Demo roles">
            {ROLES.map((r, i) => (
              <li key={r.role}>
                <form method="post" action="/api/demo/sign-in" className="flex flex-col gap-2">
                  <input type="hidden" name="role" value={r.role} />
                  <button
                    type="submit"
                    className={cn(
                      buttonVariants({ variant: i === 0 ? "default" : "outline" }),
                      "h-11 w-full",
                    )}
                  >
                    Continue as {r.name}
                  </button>
                  <p className="text-muted-foreground text-sm">{r.does}</p>
                </form>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            Visitors share these accounts, and everything resets once a day. The AI stops for the day at the
            demo&rsquo;s daily limit.
          </p>
        </>
      ) : (
        <p className="text-sm">
          The demo isn&rsquo;t set up on this server.{" "}
          <Link href="/sign-up" className="font-medium underline underline-offset-4">
            Create a workspace
          </Link>{" "}
          instead.
        </p>
      )}
    </div>
  );
}
