import { createContext, useContext } from "react";
import type { ThemePreference } from "@/lib/theme";

/**
 * App-shell state, provided by <ShellProvider> (shell-context.tsx). Kept in its own module so
 * the components the provider renders (the command palette) can use it without an import cycle.
 */
export interface ShellContextValue {
  theme: ThemePreference;
  setTheme: (next: ThemePreference) => void;
  /** Wide screens only: the sidebar shows icons without labels. */
  collapsed: boolean;
  toggleSidebar: () => void;
  openPalette: () => void;
  openShortcuts: () => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>");
  return value;
}
