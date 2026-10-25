"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import {
  finishNavigation,
  getNavigationState,
  getServerNavigationState,
  isTrackedNavigation,
  startNavigation,
  subscribeNavigation,
  trackedLinkHref,
} from "@/lib/navigation-progress";

/**
 * A thin bar along the top edge while a page change is in progress. It appears only after
 * 120 ms, creeps towards the end while waiting, then fills and fades when the new URL lands.
 * Purely visual (aria-hidden): Next.js already announces the new page title to screen readers.
 * Styling lives in globals.css because the CSP forbids inline styles.
 */
export function NavigationProgress() {
  const state = useSyncExternalStore(subscribeNavigation, getNavigationState, getServerNavigationState);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // Detect link clicks and GET form submits. Clicks in the capture phase: Next's <Link> calls
  // preventDefault() in its own handler, so the native default can't be used as a signal.
  // Submits in the bubble phase, after the page's own handlers: a form whose script takes over
  // (preventDefault) either stays on the page (knowledge search) or navigates through
  // useProgressRouter, which reports itself. Tracking those here would leave the bar, and the
  // busy state, running until the give-up timer.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = trackedLinkHref(event, anchor, new URL(window.location.href));
      if (href) startNavigation(href);
    }
    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (event.defaultPrevented) return;
      if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== "get") return;
      if (form.target && form.target !== "_self") return;
      const target = new URL(form.action, window.location.href);
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form, event.submitter)) {
        if (typeof value === "string") params.append(key, value);
      }
      target.search = params.toString();
      if (isTrackedNavigation(target, new URL(window.location.href))) startNavigation(target.href);
    }
    window.addEventListener("click", onClick, { capture: true });
    window.addEventListener("submit", onSubmit);
    return () => {
      window.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("submit", onSubmit);
    };
  }, []);

  // From now on, newly added `.enter-fade` items fade in (globals.css, design step 8.5).
  useEffect(() => {
    document.documentElement.dataset.interactive = "";
  }, []);

  // The new page has landed when the path or query changes.
  useEffect(() => {
    finishNavigation();
  }, [pathname, search]);

  return <div aria-hidden="true" data-nav-progress={state} className="nav-progress" />;
}
