"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { startNavigation } from "@/lib/navigation-progress";
import type { LiveNotice } from "@/lib/live-notice";
import { notify } from "@/lib/toast";

/** How often an open page checks for news (design step 8.4). */
export const LIVE_INTERVAL_MS = 15_000;

/**
 * True while refreshing could get in the way: someone is typing or choosing in a field, or a
 * modal dialog is open. React keeps typed text across a refresh, but a select menu would close
 * and screen-reader users would hear the page change under them.
 */
export function isBusy(doc: Document): boolean {
  const el = doc.activeElement;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type))
    return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return doc.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Keeps a server-rendered page current, without WebSockets: every 15 s while the tab is
 * visible (and at once when the person comes back to the tab) it re-renders the page on the
 * server, keeping everything typed on screen. When something newer than anything seen so far
 * arrives, it shows a quiet toast, which screen readers announce politely. The first render
 * never notifies; give the component a `key` per view (filters, ticket) to start afresh.
 */
export function LiveRefresh({
  notice,
  interval = LIVE_INTERVAL_MS,
}: {
  notice?: LiveNotice | null;
  interval?: number;
}) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const highest = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    lastRefresh.current = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || isBusy(document)) return;
      lastRefresh.current = Date.now();
      router.refresh();
    };
    const timer = window.setInterval(refresh, interval);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh.current >= interval) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, interval]);

  const order = notice?.order ?? null;
  useEffect(() => {
    if (highest.current === undefined) {
      highest.current = order; // what was already there when the page opened
      return;
    }
    if (order === null || !notice || (highest.current !== null && order <= highest.current)) return;
    highest.current = order;
    const href = notice.href;
    notify(notice.title, {
      tone: "info",
      description: notice.description,
      action: href
        ? {
            label: "Open",
            onClick: () => {
              startNavigation(href);
              router.push(href);
            },
          }
        : undefined,
    });
    // Only a higher order is news; the rest of the notice is read when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  return null;
}
