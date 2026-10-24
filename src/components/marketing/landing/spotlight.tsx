"use client";

import { useEffect } from "react";

/**
 * Cards marked `data-spotlight` get a soft light on their border that follows the mouse
 * (design step 10.2; the ring itself is CSS in globals.css). One listener for the whole page;
 * it only writes two CSS variables on the card under the pointer. Mouse only: touch has no hover.
 */
export function Spotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    let event: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const e = event;
      if (!e || !(e.target instanceof Element)) return;
      const card = e.target.closest<HTMLElement>("[data-spotlight]");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
      card.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
    };
    const onMove = (e: PointerEvent) => {
      event = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
