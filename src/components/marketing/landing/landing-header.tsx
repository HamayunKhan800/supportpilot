"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The landing page's sticky header. It is see-through with no divider while the page is at the
 * top (it sits on the hero's paper field, so it reads as part of the page); the frosted background and the bottom border appear
 * only once the page scrolls under it. Sets `data-scrolled` directly (no re-render per scroll).
 */
export function LandingHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const update = () => header.toggleAttribute("data-scrolled", window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header
      ref={ref}
      className="landing-header text-foreground data-[scrolled]:border-border data-[scrolled]:glass-bar sticky top-0 z-40 border-b border-transparent transition-[border-color] duration-200 ease-out data-[scrolled]:[--glass-alpha:88%] data-[scrolled]:[--glass-base:var(--background)] motion-reduce:transition-none"
    >
      {children}
    </header>
  );
}
