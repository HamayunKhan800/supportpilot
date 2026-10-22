import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPortal } from "@/server/modules/tickets/service";
import { AppError } from "@/server/platform/errors";
import { PortalForm } from "./portal-form";

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
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">{portal.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Contact support</h1>
        <p className="text-muted-foreground">
          Tell us what&apos;s happening and we&apos;ll get back to you. You&apos;ll get a private link to
          follow your request.
        </p>
      </header>
      <PortalForm slug={portal.slug} />
      <footer className="text-muted-foreground text-xs">Powered by SupportPilot</footer>
    </main>
  );
}
