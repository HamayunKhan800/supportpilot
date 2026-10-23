import type { Page } from "@playwright/test";
import { accountMenu, appShell, audit, email, expect, signIn, signUp, test } from "./fixtures";

/**
 * Design system step 2: the app shell (docs/plans/design-system.md). Sidebar with groups and
 * collapse, the Ctrl/⌘ K command palette, the "?" shortcut sheet, the account menu, and the
 * mobile drawer. Every overlay is audited with axe while open.
 */

async function ownerWorkspace(page: Page, who: string) {
  await signUp(page, "Sam Shell", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Shell Co");
  await page
    .getByLabel("Workspace address")
    .fill(`shell-${Date.now().toString(36)}-${test.info().project.name}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Shell Co" })).toBeVisible();
  await expect(appShell(page)).toBeVisible();
}

test.describe("wide screens", () => {
  test.skip(({ isMobile }) => isMobile, "the sidebar is a drawer on mobile (tested below)");

  test("sidebar groups links, marks the current page and remembers being collapsed", async ({ page }) => {
    await ownerWorkspace(page, email("shell-sidebar"));
    const nav = page.getByRole("navigation", { name: "Workspace" });
    for (const group of ["Work", "Insights", "Admin"]) {
      await expect(nav.getByRole("list", { name: group })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Evaluation" }).click();
    await expect(page).toHaveURL(/\/app\/analytics\/evaluation$/);
    // The more specific link owns the page; its parent section is not also highlighted.
    await expect(nav.getByRole("link", { name: "Evaluation" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Analytics" })).not.toHaveAttribute("aria-current");

    const toggle = page.getByRole("button", { name: "Sidebar" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Labels are visually hidden but still name the links.
    await expect(nav.getByRole("link", { name: "Members" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Sidebar" })).toHaveAttribute("aria-expanded", "false");
    await audit(page, "collapsed sidebar");

    await page.keyboard.press("[");
    await expect(page.getByRole("button", { name: "Sidebar" })).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(async () => (await page.context().cookies()).find((c) => c.name === "sp_sidebar"))
      .toBeUndefined();
  });

  test("command palette: jump to pages, tickets and settings from the keyboard", async ({ page }) => {
    await ownerWorkspace(page, email("shell-palette"));
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const input = palette.getByRole("combobox", { name: "Search or jump to" });

    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
    await expect(input).toBeFocused();
    await audit(page, "command palette");

    // Arrow keys move the highlighted option; focus stays in the text box.
    const options = palette.getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id"))!);
    await expect(input).toBeFocused();

    await input.fill("know");
    await expect(options.first()).toHaveText("Knowledge");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/knowledge$/);
    await expect(palette).toBeHidden();

    await appShell(page).click();
    await input.fill("#7");
    await expect(options.first()).toHaveText("Open ticket #7");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/tickets\/7$/);
    // A missing ticket keeps the app shell (workspace not-found page, not the global one).
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    await expect(appShell(page)).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("refund");
    await expect(options.first()).toHaveText("Search tickets for “refund”");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/tickets\?q=refund$/);

    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("dark");
    await palette.getByRole("option", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("ControlOrMeta+k");
    await input.fill("zzzz");
    // Nothing matches, so the only option left is the ticket search fallback.
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText("Search tickets for “zzzz”");
    await audit(page, "command palette, fallback only (dark)");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("shortcut sheet opens with ?, but not while typing", async ({ page }) => {
    await ownerWorkspace(page, email("shell-keys"));
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await page.keyboard.press("?");
    await expect(sheet).toBeVisible();
    await audit(page, "shortcut sheet");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.goto("/app/tickets");
    await page.getByLabel("Search").fill("");
    await page.getByLabel("Search").press("?");
    await expect(page.getByLabel("Search")).toHaveValue("?");
    await expect(sheet).toBeHidden();
  });

  test("account menu: account page, theme and sign out", async ({ page }) => {
    await ownerWorkspace(page, email("shell-menu"));
    const menu = await accountMenu(page);
    await expect(menu.getByRole("group", { name: "Theme" })).toBeVisible();
    await audit(page, "account menu");
    await menu.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    // Client-side navigation does not unload the page, so the menu must close itself.
    await expect(menu).toBeHidden();

    await (await accountMenu(page)).getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});

test.describe("narrow screens", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile layout only");

  test("a menu button opens the navigation drawer, which closes after navigating", async ({ page }) => {
    await ownerWorkspace(page, email("shell-mobile"));
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeHidden();

    const menuButton = page.getByRole("button", { name: "Open navigation" });
    const searchButton = appShell(page);
    // WCAG 2.5.8: targets well above the 24 px minimum.
    for (const target of [menuButton, searchButton]) {
      const box = (await target.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
    }

    await menuButton.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await audit(page, "mobile navigation drawer");
    await drawer.getByRole("link", { name: "Members" }).click();
    await expect(page).toHaveURL(/\/app\/members$/);
    await expect(drawer).toBeHidden();

    await searchButton.click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await audit(page, "mobile command palette");
  });
});
