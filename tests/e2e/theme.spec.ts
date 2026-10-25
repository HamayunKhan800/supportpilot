import type { Page } from "@playwright/test";
import { accountMenu, audit, closeDrawer, email, expect, signIn, signUp, test } from "./fixtures";

/**
 * Design system step 1: light, dark and "follow the device" themes (docs/plans/design-system.md).
 * The theme is applied by the server (cookie -> <html data-theme>) and by CSS
 * (prefers-color-scheme), so these tests also prove there is no pre-paint script: the CSP
 * fixture fails any test on a policy violation.
 */

/**
 * Perceived lightness (0..1) of the page background, from the computed colour. Chromium
 * reports it as lab(), oklch() or rgb() depending on how the stylesheet was compiled.
 */
async function backgroundLightness(page: Page): Promise<number> {
  const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lab = /^lab\(([\d.]+)/.exec(color);
  if (lab) return Number(lab[1]) / 100;
  const oklch = /^oklch\(([\d.]+)/.exec(color);
  if (oklch) return Number(oklch[1]);
  const rgb = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
  if (!rgb) throw new Error(`unexpected colour ${color}`);
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => Number(v) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function expectDark(page: Page) {
  await expect.poll(() => backgroundLightness(page)).toBeLessThan(0.3);
}
async function expectLight(page: Page) {
  await expect.poll(() => backgroundLightness(page)).toBeGreaterThan(0.9);
}

async function createWorkspace(page: Page, who: string, name: string) {
  await signUp(page, "Theo Theme", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill(name);
  await page
    .getByLabel("Workspace address")
    .fill(`theme-${Date.now().toString(36)}-${test.info().project.name}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Picks a theme in the account menu and closes the menu again. */
async function chooseTheme(page: Page, name: "Light" | "Dark" | "Device") {
  const menu = await accountMenu(page);
  await menu.getByRole("menuitemradio", { name }).click();
  await expect(menu.getByRole("menuitemradio", { name })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await closeDrawer(page);
}

async function checkedTheme(page: Page) {
  const menu = await accountMenu(page);
  const checked = await menu.getByRole("menuitemradio", { checked: true }).textContent();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await closeDrawer(page);
  return checked?.trim();
}

test("follows the device theme until the user picks one, and remembers the choice", async ({ page }) => {
  await createWorkspace(page, email(`theme-${test.info().project.name}`), "Theme Co");
  const html = page.locator("html");

  // No choice yet: the device decides.
  await expect(html).not.toHaveAttribute("data-theme");
  expect(await checkedTheme(page)).toBe("Device");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectDark(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expectLight(page);

  // An explicit choice beats the device setting, immediately and after a reload.
  await page.emulateMedia({ colorScheme: "dark" });
  await chooseTheme(page, "Light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expectLight(page);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await checkedTheme(page)).toBe("Light");
  await expectLight(page);

  await chooseTheme(page, "Dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectDark(page);
  await page.goto("/app/members");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expectDark(page);

  // Back to the device setting: the cookie is removed.
  await chooseTheme(page, "Device");
  await expect(html).not.toHaveAttribute("data-theme");
  await expectLight(page);
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme");
  expect((await page.context().cookies()).find((c) => c.name === "sp_theme")).toBeUndefined();
});

test("ignores a tampered theme cookie", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "sp_theme", value: '"><b>x', url: baseURL! }]);
  await page.goto("/sign-in");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});

test("dark theme has no serious accessibility violations", async ({ page, baseURL }) => {
  // Scans a dozen settled pages, about 2 s each: close to the default 30 s on a small machine.
  test.slow();
  await page.context().addCookies([{ name: "sp_theme", value: "dark", url: baseURL! }]);
  for (const path of ["/", "/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await audit(page, `${path} (dark)`);
  }
  await createWorkspace(page, email(`theme-a11y-${test.info().project.name}`), "Dark Co");
  await expectDark(page);
  for (const path of [
    "/app",
    "/app/members",
    "/app/settings",
    "/app/audit",
    "/app/account",
    "/app/tickets",
    "/app/knowledge",
    "/app/analytics",
    "/app/analytics/evaluation",
  ]) {
    await page.goto(path);
    await audit(page, `${path} (dark)`);
  }
});

test("device-preferred dark theme has no serious accessibility violations", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/sign-in"]) {
    await page.goto(path);
    await expectDark(page);
    await audit(page, `${path} (device dark)`);
  }
});
