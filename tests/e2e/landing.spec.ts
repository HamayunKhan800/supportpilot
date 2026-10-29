import { audit, expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The landing page, "The cited sentence" (docs/design/landing.md): calls to action, the phone
 * menu, section links, the citation in the headline, the stage slider, the inline Approve & send
 * button, the results sentence's single highlight pass, the email box, scroll reveals (and their
 * absence with reduced motion), no sideways scrolling and no Content Security Policy violations.
 */

const HEADLINE = "AI drafts. You approve.";

test("the calls to action lead to the demo, sign-up and sign-in", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Try the live demo" }).first().click();
  await expect(page).toHaveURL(/\/demo$/);
  // The test server has no DEMO_PASSWORD, so /demo explains instead of offering roles.
  await expect(page.getByRole("heading", { level: 1, name: "Try the live demo" })).toBeVisible();
  await expect(page.getByText("The demo isn’t set up on this server.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Create a workspace" }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/);

  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("on a phone the menu opens, traps focus, closes with Escape and on a link", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "wide screens show the links in the header");
  await page.goto("/");
  const button = page.getByRole("button", { name: "Menu" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // Scrolled first, so the header is frosted glass before the menu opens.
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(page.locator("header")).toHaveCSS("backdrop-filter", /blur/);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "How it works" })).toBeFocused();
  await expect(nav.getByRole("link", { name: "Try the live demo" })).toHaveAttribute("href", "/demo");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await audit(page, `landing menu (${theme})`);
  }
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await expect(page.locator("header")).not.toHaveCSS("backdrop-filter", /blur/);

  // Tab from the last item comes back to the menu button.
  await nav.getByRole("link", { name: "Sign in" }).focus();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");

  await button.click();
  await nav.getByRole("link", { name: "Results" }).click();
  await expect(nav).toBeHidden();
  await expect(page.getByRole("heading", { level: 2, name: "Tested in public." })).toBeInViewport();
});

test("section links scroll to their sections", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone menu test covers its links");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [link, heading] of [
    ["Results", "Tested in public."],
    ["Developers", "Read every line."],
  ] as const) {
    await nav.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeInViewport();
  }
  await nav.getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("slider", { name: "Ticket stage" })).toBeInViewport();
});

test("the citation number in the headline opens and closes its passage", async ({ page }) => {
  await page.goto("/");
  const cite = page.getByRole("button", { name: "Citation 1: the passage it came from" });
  const passage = page.getByRole("figure", { name: "Citation 1" });
  await expect(cite).toHaveAttribute("aria-expanded", "true");
  await expect(passage).toContainText("Annual plans can be refunded in full within 30 days");
  await cite.click();
  await expect(cite).toHaveAttribute("aria-expanded", "false");
  await expect(passage).toBeHidden();
  await cite.press("Enter");
  await expect(passage).toBeVisible();
  // The passage never covers the headline.
  const [h1, fig] = await Promise.all([
    page.getByRole("heading", { level: 1 }).boundingBox(),
    passage.boundingBox(),
  ]);
  expect(fig!.y).toBeGreaterThanOrEqual(h1!.y + h1!.height);
});

test("the slider moves one ticket through its stages, by keyboard too", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Ticket stage" });
  const how = page.locator("#how");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("First, a ticket arrives");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Then it is labelled");
  await expect(slider).toHaveAttribute("aria-valuetext", "Labelled");
  await page.keyboard.press("End");
  await expect(how.getByRole("heading", { level: 2 })).toHaveText("Last, a person approves");
  await expect(how).toContainText("Approved by Ayesha and sent");
});

test("Approve & send in the sentence shows that a person sent it", async ({ page }) => {
  await page.goto("/");
  const send = page.getByRole("button", { name: "Approve & send" });
  await send.click();
  await expect(page.getByRole("button", { name: "Sent by you" })).toBeVisible();
  await expect(page.getByText("Sent, by a person: you.")).toBeVisible();
  await page.getByRole("button", { name: "Sent by you" }).click();
  await expect(send).toBeVisible();
});

test("the results sentence lights each result once, then stays lit", async ({ page }) => {
  await page.goto("/");
  const tally = page.locator(".lp-tally");
  await expect(tally).toContainText("133 of 133 citations pointed at a real passage");
  await tally.scrollIntoViewIfNeeded();
  await expect(tally).toHaveAttribute("data-run", "");
  // Four clauses at 1.25 s each: done within five seconds (WCAG 2.2.2), then nothing moves.
  await expect(tally).not.toHaveAttribute("data-run", /.*/, { timeout: 7_000 });
  await expect(tally.locator(".k[data-on]")).toHaveCount(0);
});

test("the email box opens sign-up with the address filled in", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Work email").fill("sam@team.example");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/sign-up\?email=sam%40team\.example$/);
  await expect(page.getByLabel("Email")).toHaveValue("sam@team.example");
  // Anything that is not an address is ignored.
  await page.goto("/sign-up?email=%3Cscript%3E");
  await expect(page.getByLabel("Email")).toHaveValue("");
});

test("sections below the fold come into focus as they scroll into view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-scroll-focus", "");
  // The block that holds the heading carries the blur (scroll-driven, so it eases with the scroll).
  const block = page.locator("#results .copy");
  const blurPx = () =>
    block.evaluate((el) => Number(/blur\(([\d.]+)px\)/.exec(getComputedStyle(el).filter)?.[1] ?? 0));
  await expect.poll(blurPx).toBeGreaterThan(2);
  await block.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await expect.poll(blurPx).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("filter", "none");
});

/** The big footer name is cropped only at the bottom: its last letter stays inside the footer. */
async function footerNameFits(page: Page) {
  return page.evaluate(() => {
    const name = document.querySelector(".lp-name")!;
    const word = name.firstElementChild!.getBoundingClientRect();
    const box = name.getBoundingClientRect();
    return word.right <= box.right + 1 && word.left >= 0;
  });
}

test("with reduced motion nothing is hidden or animated, and the results are all lit", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-reveal");
  await expect(page.locator("html")).not.toHaveAttribute("data-scroll-focus");
  const tally = page.locator(".lp-tally");
  await tally.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_500);
  await expect(tally).not.toHaveAttribute("data-run", /.*/);
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length,
  );
  expect(running).toBe(0);
  // Reduced motion shortens transitions instead of removing them; the name must still be measured right.
  expect(await footerNameFits(page)).toBe(true);
});

test("the page fits a phone screen, the footer name fits its width, and the CSP stays clean", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text()))
      violations.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no sideways scrolling").toBeLessThanOrEqual(0);
  expect(await footerNameFits(page)).toBe(true);
  expect(violations).toEqual([]);
});
