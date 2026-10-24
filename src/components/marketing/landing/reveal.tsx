"use client";

import { useEffect } from "react";

/**
 * Scroll reveals for the landing page: elements marked `data-reveal` rise and fade in (300 ms,
 * once) as they enter the viewport. Without this script, or with reduced motion, nothing is ever
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
