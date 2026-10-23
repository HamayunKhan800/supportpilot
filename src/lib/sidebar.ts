/**
 * Sidebar preference (expanded or collapsed to icons) on wide screens. Like the theme, it
 * lives in a plain cookie so the server renders the right width on the first byte: no
 * layout jump and no pre-paint script. Display-only; unknown values mean "expanded".
 */
export const SIDEBAR_COOKIE = "sp_sidebar";

export function parseSidebarCollapsed(value: string | null | undefined): boolean {
  return value === "collapsed";
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** A `document.cookie` assignment that stores the preference ("expanded" deletes the cookie). */
export function sidebarCookie(collapsed: boolean, secure: boolean): string {
  const parts = collapsed
    ? [`${SIDEBAR_COOKIE}=collapsed`, "Path=/", `Max-Age=${ONE_YEAR_SECONDS}`, "SameSite=Lax"]
    : [`${SIDEBAR_COOKIE}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
