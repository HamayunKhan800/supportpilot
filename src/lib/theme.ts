/**
 * Theme preference: "system" (follow the device), "light" or "dark".
 *
 * Stored in a plain cookie so the server can render <html data-theme="…"> on the first byte:
 * no script runs before paint, so there is no flash of the wrong theme and the strict,
 * nonce-based CSP needs no exception (ADR-0011). "system" is the absence of the cookie;
 * then the CSS follows `prefers-color-scheme`. The value is display-only and never trusted
 * for anything else; unknown values fall back to "system".
 */
export const THEME_COOKIE = "sp_theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** The `data-theme` attribute for <html>, or undefined to follow the device. */
export function themeAttribute(preference: ThemePreference): "light" | "dark" | undefined {
  return preference === "system" ? undefined : preference;
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** A `document.cookie` assignment that stores the preference ("system" deletes the cookie). */
export function themeCookie(preference: ThemePreference, secure: boolean): string {
  const parts =
    preference === "system"
      ? [`${THEME_COOKIE}=`, "Path=/", "Max-Age=0", "SameSite=Lax"]
      : [`${THEME_COOKIE}=${preference}`, "Path=/", `Max-Age=${ONE_YEAR_SECONDS}`, "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
