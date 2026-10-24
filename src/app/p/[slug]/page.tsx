import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPortal } from "@/server/modules/tickets/service";
import { AppError } from "@/server/platform/errors";
import { PortalForm } from "./portal-form";
import { PortalFrame } from "@/components/portal/portal-frame";

/** One lookup per request, shared by generateMetadata and the page. */
const loadPortal = cache(async (slug: string) => {
  try {
    return await getPortal(slug);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
});

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const portal = await loadPortal((await params).slug);
  return { title: portal ? `Contact ${portal.name} support` : "Support portal" };
}

export default async function PortalPage({ params }: PageProps<"/p/[slug]">) {
  const portal = await loadPortal((await params).slug);
  if (!portal) notFound();

  return (
    <PortalFrame workspaceName={portal.name}>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Contact support</h1>
            <p className="text-muted-foreground max-w-prose">
              Tell us what&apos;s happening and we&apos;ll get back to you. You&apos;ll get a private link to
              follow your request.
            </p>
          </header>
          <PortalForm slug={portal.slug} />
        </div>
        <aside aria-labelledby="next-steps-heading" className="min-w-0 lg:pt-2">
          <h2 id="next-steps-heading" className="text-sm font-semibold">
            What happens next
          </h2>
          <ol className="mt-4 flex flex-col gap-5">
            {NEXT_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs"
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-muted-foreground text-sm">{step.body(portal.name)}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </PortalFrame>
  );
}

const NEXT_STEPS = [
  {
    title: "You get a private link",
    body: () => "Save it: it's how you follow your request and reply to us.",
  },
  {
    title: "Our team reads your message",
    body: (name: string) => `Your request goes straight to the ${name} support team.`,
  },
  {
    title: "A person replies",
    body: () =>
      "Replies may be drafted with AI help, but a member of the team reviews each one before it's sent.",
  },
] as const;
