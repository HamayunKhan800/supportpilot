"use client";

import { useEffect, useEffectEvent } from "react";
import { isTypingTarget, pageKeyFor } from "./shortcuts";

/**
 * Plain-letter shortcuts for one page (j/k, a, e, r). They pause while typing and inside menus
 * and dialogs, like the shell's shortcuts, and every one has a visible control too.
 */
export function usePageShortcuts(
  handlers: Partial<Record<string, (e: KeyboardEvent) => void>>,
  enabled = true,
) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target instanceof Element ? e.target : null;
    const key = pageKeyFor(
      {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        typing: isTypingTarget(target),
        inOverlay: Boolean(target?.closest('[role="dialog"], [role="menu"], [role="listbox"]')),
      },
      Object.keys(handlers),
    );
    const handler = key ? handlers[key] : undefined;
    if (!handler) return;
    e.preventDefault();
    handler(e);
  });

  useEffect(() => {
    if (!enabled) return;
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}
