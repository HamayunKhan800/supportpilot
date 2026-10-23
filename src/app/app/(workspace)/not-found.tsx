import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

/**
 * notFound() inside the workspace (e.g. a ticket number that does not exist) renders here,
 * inside the workspace layout, so the sidebar, menu and Ctrl/⌘ K stay available. The
 * wording does not say whether the item exists in another workspace.
 */
export default function WorkspaceNotFound() {
  return (
    <div className="flex max-w-lg flex-col gap-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="text-muted-foreground">
        This page or ticket doesn&apos;t exist in this workspace, or it has been removed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/app/tickets" className={buttonVariants()}>
          Go to tickets
        </Link>
        <Link href="/app" className={buttonVariants({ variant: "outline" })}>
          Overview
        </Link>
      </div>
    </div>
  );
}
