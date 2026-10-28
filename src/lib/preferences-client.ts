/**
 * Browser side effects for display preferences. Module-level functions (not component
 * code) so React's purity rules hold; components call them from event handlers only.
 */
import { sidebarCookie } from "./sidebar";
import { type ThemePreference, themeAttribute, themeColorEntries, themeCookie } from "./theme";

const secure = () => window.location.protocol === "https:";

/** Saves the theme and re-themes the page at once (no reload). */
export function applyTheme(next: ThemePreference) {
  document.cookie = themeCookie(next, secure());
  const root = document.documentElement;
  const attribute = themeAttribute(next);
  if (attribute) root.dataset.theme = attribute;
  else delete root.dataset.theme;
  syncThemeColor(next);
}

/**
 * Keeps the browser's address-bar colour in step with a theme switch (the server renders the
 * first one). Pages whose top is always dark (the landing hero) mark themselves and keep theirs.
 */
function syncThemeColor(next: ThemePreference) {
  if (document.querySelector("[data-fixed-theme-color]")) return;
  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  for (const { media, color } of themeColorEntries(next)) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    if (media) meta.media = media;
    document.head.append(meta);
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  document.cookie = sidebarCookie(collapsed, secure());
}

/** Apple keyboards show ⌘ for the "Mod" key; others show Ctrl. */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
