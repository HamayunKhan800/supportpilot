"use client";

import { useEffect, useRef } from "react";
import { getNavigationState, subscribeNavigation } from "@/lib/navigation-progress";
import { cn } from "@/lib/utils";

/**
 * One highlight that slides to the selected item of a menu, tab bar or segmented control, instead
 * of the old highlight vanishing and a new one appearing (Linear, Vercel). Drop it into the element
 * that holds the items (which must be `relative`); it finds the active item itself:
 *
 *   <nav className="group/ind relative"><SlidingIndicator className="bg-muted rounded-md" /><ul>…</ul></nav>
 *
 * - Active item: the first match of `selector` (default: `aria-current` or `aria-selected="true"`).
 *   A click on another item moves the highlight at once, before its page has loaded; it settles
 *   on the real active item when the page changes or the navigation ends.
 * - Progressive: until it has measured, the list keeps its own static highlight. Once ready it sets
 *   `data-ind-ready` on the list, and items hide their static highlight with
 *   `group-data-[ind-ready]/ind:...` classes. Without JavaScript nothing changes.
 * - Positions are set through the CSSOM (custom properties), which the strict CSP allows. Size
 *   changes (sidebar collapse, window resize) move it without animation; reduced motion: no slide.
 * - `variant="underline"` / `"overline"` keep only the horizontal position and width (a 2 px bar
 *   along the bottom / top). Render it as the first child of the list's container, and make the
 *   items `relative` so they paint above it.
 */
export function SlidingIndicator({
  className,
  selector = '[aria-current]:not([aria-current="false"]), [aria-selected="true"]',
  itemSelector = 'a[href], [role="tab"]',
  variant = "box",
}: {
  className?: string;
  selector?: string;
  itemSelector?: string;
  variant?: "box" | "underline" | "overline";
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    const list = el?.parentElement;
    if (!el || !list) return;
    let frame = 0;
    let clicked: Element | null = null;
    let last = "";

    const place = (target: Element | null, animate: boolean) => {
      if (!target || !list.contains(target)) {
        el.dataset.hidden = "";
        return;
      }
      const box = target.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        el.dataset.hidden = "";
        return;
      }
      const parent = list.getBoundingClientRect();
      const x = box.left - parent.left - list.clientLeft + list.scrollLeft;
      const y = box.top - parent.top - list.clientTop + list.scrollTop;
      const key = `${x},${y},${box.width},${box.height}`;
      if (key === last && !("hidden" in el.dataset)) return;
      last = key;
      if (!animate) el.dataset.instant = "";
      el.style.setProperty("--ind-x", `${x}px`);
      el.style.setProperty("--ind-y", `${y}px`);
      el.style.setProperty("--ind-w", `${box.width}px`);
      el.style.setProperty("--ind-h", `${box.height}px`);
      delete el.dataset.hidden;
      if (!animate) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => delete el.dataset.instant);
        });
      }
    };

    const active = () => list.querySelector(selector);
    const sync = (animate: boolean) => place(clicked ?? active(), animate);

    sync(false);
    list.setAttribute("data-ind-ready", "");

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const item = (event.target as Element | null)?.closest?.(itemSelector);
      if (!item || !list.contains(item) || item.getAttribute("aria-disabled") === "true") return;
      if (item.tagName === "A" && (item as HTMLAnchorElement).target === "_blank") return;
      clicked = item;
      place(item, true);
    };
    // The real selection changed (a new page rendered, a tab was chosen with the keyboard).
    const mutations = new MutationObserver(() => {
      clicked = null;
      sync(true);
    });
    mutations.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current", "aria-selected", "data-active", "hidden"],
    });
    const resize = new ResizeObserver(() => sync(false));
    resize.observe(list);
    // A navigation that ended without changing this list (cancelled, or the same page).
    const unsubscribe = subscribeNavigation(() => {
      if (getNavigationState() !== "loading" && clicked) {
        clicked = null;
        sync(true);
      }
    });

    list.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener("click", onClick);
      list.removeAttribute("data-ind-ready");
      mutations.disconnect();
      resize.disconnect();
      unsubscribe();
    };
  }, [selector, itemSelector]);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-hidden=""
      className={cn("sliding-indicator", variant !== "box" && `sliding-indicator-${variant}`, className)}
    />
  );
}
