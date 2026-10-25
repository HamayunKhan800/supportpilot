"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getNavigationState,
  getNavigationTarget,
  getServerNavigationState,
  getServerNavigationTarget,
  subscribeNavigation,
} from "@/lib/navigation-progress";

type Busy = "page" | "data";

/**
 * Feedback inside the workspace while a page change is really in progress (the top bar already
 * runs; this covers waits that last). Rendered as the last child of <main>:
 *
 * - Going to another page: after 300 ms, a skeleton shaped like that page covers the old one
 *   (the old page is not the answer any more). Fast changes never show it.
 * - The same page with a new query (a filter, a period): the old results stay readable but dim
 *   slightly after 200 ms (only parts marked `data-busy-dim`), so what you type is never hidden.
 *
 * Client-only on purpose: a route `loading.tsx` streams a hidden SVG with an inline style that the
 * strict CSP blocks (docs/design/pages.md). <main> gets `aria-busy` while waiting.
 */
export function RouteBusy() {
  const state = useSyncExternalStore(subscribeNavigation, getNavigationState, getServerNavigationState);
  const target = useSyncExternalStore(subscribeNavigation, getNavigationTarget, getServerNavigationTarget);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  const targetPath = target.split("?")[0] ?? "";
  const busy: Busy | null =
    state !== "loading" || !target
      ? null
      : targetPath === pathname
        ? "data"
        : targetPath.startsWith("/app")
          ? "page"
          : null;

  // Mark <main> (this component's parent) for the CSS and for assistive technology.
  useEffect(() => {
    const main = ref.current?.parentElement;
    if (!main) return;
    if (busy) {
      main.setAttribute("data-route-busy", busy);
      main.setAttribute("aria-busy", "true");
    } else {
      main.removeAttribute("data-route-busy");
      main.removeAttribute("aria-busy");
    }
  }, [busy]);

  return (
    <div ref={ref} aria-hidden="true" className="route-skeleton" data-show={busy === "page" ? "" : undefined}>
      {busy === "page" && <PageSkeleton path={targetPath} />}
    </div>
  );
}

function Line({ className }: { className: string }) {
  return <div className={`skeleton ${className}`} />;
}

function Header() {
  return (
    <div className="flex flex-col gap-2">
      <Line className="h-7 w-48" />
      <Line className="h-4 w-72 max-w-full" />
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="bg-card divide-y rounded-xl border">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Line className="size-4 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Line className={i % 3 === 1 ? "h-3.5 w-2/3" : "h-3.5 w-1/2"} />
            <Line className="h-3 w-1/4" />
          </div>
          <Line className="hidden h-3 w-16 md:block" />
        </div>
      ))}
    </div>
  );
}

function Tabs() {
  return (
    <div className="flex gap-4 border-b pb-3">
      <Line className="h-4 w-16" />
      <Line className="h-4 w-14" />
      <Line className="h-4 w-20" />
    </div>
  );
}

/** A rough outline of the page being opened: the same blocks in the same places. */
function PageSkeleton({ path }: { path: string }) {
  let body: React.ReactNode;
  if (/^\/app\/tickets\/\d+/.test(path)) {
    body = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          <Line className="h-24 w-full rounded-xl" />
          <Line className="h-32 w-full rounded-xl" />
          <Line className="h-28 w-full rounded-xl" />
        </div>
        <Line className="hidden h-72 rounded-xl lg:block" />
      </div>
    );
  } else if (path.startsWith("/app/tickets")) {
    body = (
      <>
        <Tabs />
        <div className="flex gap-1.5">
          <Line className="h-8 w-28" />
          <Line className="h-8 w-24" />
          <Line className="h-8 w-32" />
        </div>
        <Rows count={8} />
      </>
    );
  } else if (path.startsWith("/app/analytics")) {
    body = (
      <>
        <Tabs />
        <Line className="h-80 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Line className="h-48 rounded-xl" />
          <Line className="h-48 rounded-xl" />
        </div>
      </>
    );
  } else if (path === "/app") {
    body = (
      <>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-card flex flex-col gap-2 p-4">
              <Line className="h-4 w-20" />
              <Line className="h-7 w-12" />
            </div>
          ))}
        </div>
        <Line className="h-64 w-full rounded-xl" />
        <Rows count={4} />
      </>
    );
  } else if (
    path.startsWith("/app/knowledge") ||
    path.startsWith("/app/audit") ||
    path.startsWith("/app/members")
  ) {
    body = <Rows count={7} />;
  } else {
    body = (
      <>
        <Line className="h-40 w-full rounded-xl" />
        <Line className="h-40 w-full rounded-xl" />
      </>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Header />
      {body}
    </div>
  );
}
