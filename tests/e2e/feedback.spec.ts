import type { Page } from "@playwright/test";
import { appShell, email, expect, signIn, signUp, test, workspaceNav } from "./fixtures";

/**
 * Design step 8: feedback, loading states and motion (docs/plans/feedback-and-motion.md).
 * 8.1: a page change that takes a while shows the top progress bar, which goes away once the
 * new page lands. The server is slowed on purpose so the wait is long enough to see.
 */

async function ownerWorkspace(page: Page, who: string) {
  await signUp(page, "Fay Feedback", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Feedback Co");
  await page
    .getByLabel("Workspace address")
    .fill(`feedback-${Date.now().toString(36)}-${test.info().project.name}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(appShell(page)).toBeVisible();
}

/** Delay Next.js page-data requests (they carry the `rsc` header) to simulate a slow network. */
async function slowPageChanges(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

const bar = (page: Page) => page.locator("[data-nav-progress]");
const barOpacity = (page: Page) => bar(page).evaluate((el) => Number(getComputedStyle(el).opacity));

test("a slow page change shows the top progress bar until the new page lands", async ({ page }) => {
  await ownerWorkspace(page, email("feedback-nav"));
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
  expect(await barOpacity(page)).toBe(0);

  await slowPageChanges(page, 1500);
  const nav = await workspaceNav(page);
  await nav.getByRole("link", { name: "Knowledge" }).click();

  await expect(bar(page)).toHaveAttribute("data-nav-progress", "loading");
  await expect.poll(() => barOpacity(page)).toBeGreaterThan(0.5);
  await expect(page).toHaveURL(/\/app\/knowledge$/);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge base" })).toBeVisible();
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
  expect(await barOpacity(page)).toBe(0);
});

test("page changes from the command palette show the bar too", async ({ page, isMobile }) => {
  test.skip(isMobile, "the palette's keyboard shortcut is a desktop feature");
  await ownerWorkspace(page, email("feedback-palette"));
  await slowPageChanges(page, 1500);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search or jump to" }).fill("Members");
  await page.keyboard.press("Enter");

  await expect(bar(page)).toHaveAttribute("data-nav-progress", "loading");
  await expect(page).toHaveURL(/\/app\/members$/);
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
});

test("tapping a link to the page already open shows nothing", async ({ page }) => {
  await ownerWorkspace(page, email("feedback-same"));
  await slowPageChanges(page, 1500);
  const nav = await workspaceNav(page);
  await nav.getByRole("link", { name: "Overview" }).click();
  await page.waitForTimeout(400);
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
});
