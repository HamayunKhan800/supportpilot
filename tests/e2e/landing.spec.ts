import { expect, test } from "./fixtures";

/**
 * The landing page (docs/design/landing.md): calls to action, section links, the workflow tabs,
 * scroll reveals (and their absence with reduced motion), no sideways scrolling on a phone, and
 * no Content Security Policy violations from the new styles.
 */

test("the calls to action lead to sign-up and sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Support replies drafted by AI, approved by your team." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create a workspace" }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("section links scroll to their sections", async ({ page, isMobile }) => {
  test.skip(isMobile, "the section links are in the header on wide screens and in the footer on phones");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [link, heading] of [
    ["How it works", "From new ticket to approved reply"],
    ["Guardrails", "Guardrails you can see on every draft"],
    ["Evaluation", "Measured, not assumed"],
  ] as const) {
    await nav.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeInViewport();
  }
});

test("the workflow tabs switch scenes with the mouse and the keyboard", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Stages of a ticket" });
  const triage = tabs.getByRole("tab", { name: /^Triage/ });
  const search = tabs.getByRole("tab", { name: /^Search/ });
  const review = tabs.getByRole("tab", { name: /^Review and send/ });
  await expect(triage).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Applied automatically: category and priority.");

  await search.click();
  await expect(search).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Not close enough: not used");

  await search.focus();
  await page.keyboard.press("End");
  await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(review).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Sent an AI-drafted reply");
});

test("sections below the fold reveal as they scroll into view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-reveal", "");
  const tile = page.locator("#guardrails li[data-reveal]").first();
  await expect(tile).not.toHaveAttribute("data-revealed");
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toHaveAttribute("data-revealed", "");
  await expect(tile).toHaveCSS("opacity", "1");
});

test("with reduced motion nothing is hidden or animated", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-reveal");
  await expect(page.locator("#guardrails li[data-reveal]").first()).toHaveCSS("opacity", "1");
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length,
  );
  expect(running).toBe(0);
});

test("the page fits a phone screen and keeps the CSP clean", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text()))
      violations.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no sideways scrolling").toBeLessThanOrEqual(0);
  expect(violations).toEqual([]);
});
