"use client";

import { useLinkStatus } from "next/link";

/**
 * Place inside a <Link> that fills a row, tile or card: while that link's page is loading, a thin
 * moving line runs along the bottom of the nearest positioned box (the row), so the tapped item
 * shows it is on its way. It only appears after 120 ms, so fast pages never flicker, and it stands
 * still with reduced motion. Decorative: the page change itself is announced by its title.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden="true" data-link-pending="" className="link-pending" /> : null;
}
