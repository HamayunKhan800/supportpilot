import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  THEME_COLORS,
  THEME_COOKIE,
  themeAttribute,
  themeColorEntries,
  themeCookie,
} from "@/lib/theme";

describe("theme preference", () => {
  it("accepts only light and dark; anything else means follow the device", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    for (const value of [undefined, null, "", "system", "DARK", "dark;", '"><script>', "light dark"]) {
      expect(parseThemePreference(value)).toBe("system");
    }
  });

  it("maps the preference to the <html data-theme> attribute", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });

  it("stores an explicit choice for a year, scoped to the whole site", () => {
    expect(themeCookie("dark", false)).toBe(`${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`);
    expect(themeCookie("light", true)).toBe(
      `${THEME_COOKIE}=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });

  it("deletes the cookie for 'follow the device'", () => {
    expect(themeCookie("system", true)).toBe(`${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
  });

  it("gives the browser one colour for an explicit theme and one per scheme otherwise", () => {
    expect(themeColorEntries("dark")).toEqual([{ color: THEME_COLORS.dark }]);
    expect(themeColorEntries("light")).toEqual([{ color: THEME_COLORS.light }]);
    expect(themeColorEntries("system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    ]);
  });
});
