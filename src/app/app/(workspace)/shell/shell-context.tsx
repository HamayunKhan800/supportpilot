"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavItem } from "@/lib/navigation";
import { applyTheme, saveSidebarCollapsed } from "@/lib/preferences-client";
import { isTypingTarget, shellActionFor } from "@/lib/shortcuts";
import type { ThemePreference } from "@/lib/theme";
import { CommandPalette } from "./command-palette";
import { ShortcutSheet } from "./shortcut-sheet";
import { ShellContext } from "./use-shell";

const WIDE = "(min-width: 64rem)"; // Tailwind's lg breakpoint, where the sidebar is shown

/**
 * App-shell state shared by the sidebar, the mobile header, the user menu and the command
 * palette, plus the global shortcuts (Ctrl/⌘ K, ?, [). Preferences are mirrored to cookies
 * so the server renders them on the next request.
 */
export function ShellProvider({
  children,
  items,
  initialTheme,
  initialCollapsed,
}: {
  children: React.ReactNode;
  items: NavItem[];
  initialTheme: ThemePreference;
  initialCollapsed: boolean;
}) {
  const [theme, setThemeState] = useState(initialTheme);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const setTheme = useCallback((next: ThemePreference) => {
    applyTheme(next);
    setThemeState(next);
  }, []);
  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  // Keep the cookie in step with the state (an external system, so an effect is right here).
  useEffect(() => saveSidebarCollapsed(collapsed), [collapsed]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      const action = shellActionFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        typing: isTypingTarget(target),
        inOverlay: Boolean(target?.closest('[role="dialog"], [role="menu"], [role="listbox"]')),
      });
      if (!action) return;
      if (action === "palette") {
        e.preventDefault();
        setShortcutsOpen(false);
        setPaletteOpen((open) => !open);
      } else if (action === "shortcuts") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (window.matchMedia(WIDE).matches) {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, collapsed, toggleSidebar, openPalette, openShortcuts }),
    [theme, setTheme, collapsed, toggleSidebar, openPalette, openShortcuts],
  );

  return (
    <ShellContext value={value}>
      {children}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={items} />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </ShellContext>
  );
}
