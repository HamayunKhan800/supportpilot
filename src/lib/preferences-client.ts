/**
 * Browser side effects for display preferences. Module-level functions (not component
 * code) so React's purity rules hold; components call them from event handlers only.
 */
import { sidebarCookie } from "./sidebar";
import { type ThemePreference, themeAttribute, themeCookie } from "./theme";

const secure = () => window.location.protocol === "https:";

/** Saves the theme and re-themes the page at once (no reload). */
export function applyTheme(next: ThemePreference) {
  document.cookie = themeCookie(next, secure());
  const root = document.documentElement;
  const attribute = themeAttribute(next);
  if (attribute) root.dataset.theme = attribute;
  else delete root.dataset.theme;
}

export function saveSidebarCollapsed(collapsed: boolean) {
  document.cookie = sidebarCookie(collapsed, secure());
}

/** Apple keyboards show ⌘ for the "Mod" key; others show Ctrl. */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
