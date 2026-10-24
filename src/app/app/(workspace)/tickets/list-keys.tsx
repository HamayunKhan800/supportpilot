"use client";

import { usePageShortcuts } from "@/lib/use-page-shortcuts";

/** Moves focus to the next/previous ticket link; Enter then opens it (a normal link). */
function moveFocus(step: 1 | -1) {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-row-link]"));
  if (links.length === 0) return;
  const current = links.indexOf(document.activeElement as HTMLAnchorElement);
  const next =
    current === -1
      ? step === 1
        ? 0
        : links.length - 1
      : Math.min(links.length - 1, Math.max(0, current + step));
  links[next]!.focus();
  links[next]!.scrollIntoView({ block: "nearest" });
}

/** j / k on the ticket list. Renders nothing. */
export function ListKeys() {
  usePageShortcuts({ j: () => moveFocus(1), k: () => moveFocus(-1) });
  return null;
}
