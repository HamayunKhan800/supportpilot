"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The hero headline's typing loop (owner request, 2026-10-25): it types out, holds, deletes from
 * the end like a backspace, and types again. The letters are drawn by CSS (globals.css, "type-ch");
 * this component only switches the stage with data-type-phase. The pattern follows accessible
 * typewriter headlines (WCAG 2.2.2 Pause, Stop, Hide):
 * - Screen readers and search engines get the sentence once (the sr-only copy in page.tsx); the
 *   animated letters are aria-hidden, so nothing is announced on each change.
 * - A Pause button stops it with the full sentence showing; Play starts it again. The label
 *   changes (Pause typing / Play typing), so it has no aria-pressed as well.
 * - Reduced motion: no loop and no button, the headline is simply there.
 * - The button keeps a scroll margin, so focusing it never leaves it under the sticky header
 *   (WCAG 2.4.11 Focus Not Obscured).
 * - It waits while the tab is hidden or the headline is off-screen, and never moves the layout
 *   (letters change colour only).
 */

/** Matches globals.css: 250 ms start + 26 ms per letter over 59 positions, then the caret blinks. */
const TYPED_MS = 250 + 59 * 26;
/** Time to read the whole sentence before it is deleted. */
const HOLD_MS = 4000;
/** 16 ms per letter while deleting, plus a short pause on the empty line. */
const ERASE_MS = 59 * 16 + 450;

type Phase = "type" | "erase" | "still";

export function HeroHeadline({
  id,
  className,
  labelledBy,
  children,
}: {
  id: string;
  className: string;
  /** Id of the element holding the full sentence, when the heading also contains links. */
  labelledBy?: string;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("type");
  const [paused, setPaused] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onScreen = useRef(true);

  useEffect(() => {
    const el = headingRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      onScreen.current = entry?.isIntersecting ?? true;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout>;
    // Delete only while someone can see it; otherwise keep the full sentence and check again.
    const holdThenErase = () => {
      timer = setTimeout(() => {
        if (document.hidden || !onScreen.current) return holdThenErase();
        setPhase("erase");
        timer = setTimeout(() => {
          setPhase("type");
          timer = setTimeout(holdThenErase, TYPED_MS);
        }, ERASE_MS);
      }, HOLD_MS);
    };
    timer = setTimeout(holdThenErase, TYPED_MS);
    return () => clearTimeout(timer);
  }, [paused]);

  return (
    <>
      <h1
        ref={headingRef}
        id={id}
        aria-labelledby={labelledBy}
        className={className}
        data-type-phase={paused ? "still" : phase}
      >
        {children}
      </h1>
      <button
        type="button"
        onClick={() => {
          setPaused((p) => !p);
          setPhase("type");
        }}
        className="text-muted-foreground hover:text-foreground mt-3 inline-flex h-7 w-fit cursor-pointer scroll-mt-24 items-center gap-1.5 rounded-md text-xs font-medium transition-colors motion-reduce:hidden"
      >
        {paused ? (
          <Play aria-hidden="true" className="size-3.5" />
        ) : (
          <Pause aria-hidden="true" className="size-3.5" />
        )}
        {paused ? "Play typing" : "Pause typing"}
      </button>
    </>
  );
}
