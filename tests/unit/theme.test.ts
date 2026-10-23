import { describe, expect, it } from "vitest";
import { parseThemePreference, THEME_COOKIE, themeAttribute, themeCookie } from "@/lib/theme";

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
});
