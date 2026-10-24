"use client";

import { usePageShortcuts } from "@/lib/use-page-shortcuts";
import { useProgressRouter } from "@/lib/use-progress-router";

/** j / k on a ticket: next / previous ticket of the list the agent came from. Renders nothing. */
export function TicketKeys({
  previousHref,
  nextHref,
}: {
  previousHref: string | null;
  nextHref: string | null;
}) {
  const router = useProgressRouter();
  usePageShortcuts({
    ...(nextHref && { j: () => router.push(nextHref) }),
    ...(previousHref && { k: () => router.push(previousHref) }),
  });
  return null;
}
