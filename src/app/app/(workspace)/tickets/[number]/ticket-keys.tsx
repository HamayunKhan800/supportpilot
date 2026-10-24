"use client";

import { useRouter } from "next/navigation";
import { usePageShortcuts } from "@/lib/use-page-shortcuts";

/** j / k on a ticket: next / previous ticket of the list the agent came from. Renders nothing. */
export function TicketKeys({
  previousHref,
  nextHref,
}: {
  previousHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  usePageShortcuts({
    ...(nextHref && { j: () => router.push(nextHref) }),
    ...(previousHref && { k: () => router.push(previousHref) }),
  });
  return null;
}
