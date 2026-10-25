"use client";

import { useEffect } from "react";

/**
 * Scroll reveals for the landing page.
 *
 * Where the browser supports scroll-driven animations (`animation-timeline: view()`), elements
 * marked `data-reveal` come into focus with the scroll itself: they start softly blurred and
 * 16 px low (never faded, so contrast is never reduced), and are sharp by the time they are 40% of a screen into view (a depth-of-
 * field feel, as on Linear). The browser runs it off the main thread; this script only marks what
 * is already on screen (which stays sharp) and sets <html data-scroll-focus>. CSS in globals.css.
 *
 * Elsewhere, the fallback: elements rise and fade in (300 ms, once) as they enter the viewport. Without this script, or with reduced motion, nothing is ever
 * hidden: the page only hides elements after it has marked <html data-reveal>, and it marks
 * everything already on screen (or above it) as revealed first, so nothing visible blinks.
 */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const show = (el: Element) => el.setAttribute("data-revealed", "");
    for (const el of items) {
      if (el.getBoundingClientRect().top < window.innerHeight) show(el);
    }
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) {
      document.documentElement.setAttribute("data-scroll-focus", "");
      return () => document.documentElement.removeAttribute("data-scroll-focus");
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Also reveal anything scrolled past (a jump to an anchor lower down).
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            show(entry.target);
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of items) if (!el.hasAttribute("data-revealed")) observer.observe(el);
    document.documentElement.setAttribute("data-reveal", "");
    return () => {
      observer.disconnect();
      document.documentElement.removeAttribute("data-reveal");
    };
  }, []);
  return null;
}
