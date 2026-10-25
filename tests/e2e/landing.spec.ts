import type { Page } from "@playwright/test";
import { audit, expect, test } from "./fixtures";

/**
 * The landing page (docs/design/landing.md): calls to action, section links, the workflow tabs,
 * scroll reveals (and their absence with reduced motion), no sideways scrolling on a phone, and
 * no Content Security Policy violations from the new styles, and the live demo in the hero.
 */

test("the calls to action lead to sign-up and sign-in", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Support replies drafted by AI, approved by your team." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create a workspace" }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.goto("/");
  // On phones the header holds only the logo and a menu button (design step 11).
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
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await audit(page, `landing menu (${theme})`);
  }
  // The page behind does not scroll while the menu is open.
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  // The header turns solid so page text does not show through it.
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
  await nav.getByRole("link", { name: "Guardrails" }).click();
  await expect(nav).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 2, name: "Guardrails you can see on every draft" }),
  ).toBeInViewport();
});

test("section links scroll to their sections", async ({ page, isMobile }) => {
  test.skip(isMobile, "on phones the section links are in the menu (tested above)");
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
  await expect(page.locator("#how-it-works").getByRole("tabpanel")).toContainText(
    "Applied automatically: category and priority.",
  );

  await search.click();
  await expect(search).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#how-it-works").getByRole("tabpanel")).toContainText(
    "Not close enough: not used",
  );

  await search.focus();
  await page.keyboard.press("End");
  await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(review).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#how-it-works").getByRole("tabpanel")).toContainText("Sent an AI-drafted reply");
});

test("sections below the fold come into focus as they scroll into view", async ({ page }) => {
  await page.goto("/");
  // Chromium supports scroll-driven animations, so the scroll-linked version runs (not the timed
  // fallback): blurred below the fold, sharp once well into view, never faded.
  await expect(page.locator("html")).toHaveAttribute("data-scroll-focus", "");
  await expect(page.locator("html")).not.toHaveAttribute("data-reveal");
  const tile = page.locator("#guardrails li[data-reveal]").first();
  await expect(tile).not.toHaveAttribute("data-revealed");
  // A real blur (not "blur(0px)"): a clipping ancestor with overflow: hidden would become the
  // view timeline's scroller and leave everything sharp, which an earlier version missed.
  const blurPx = () =>
    tile.evaluate((el) => Number(/blur\(([\d.]+)px\)/.exec(getComputedStyle(el).filter)?.[1] ?? 0));
  await expect.poll(blurPx).toBeGreaterThan(4);
  await expect(tile).toHaveCSS("opacity", "1");
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toHaveCSS("filter", /^(none|blur\(0px\))$/);
  // Content already on screen when the page opens is never blurred.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("filter", "none");
});

test("with reduced motion nothing is hidden or animated", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-reveal");
  await expect(page.locator("html")).not.toHaveAttribute("data-scroll-focus");
  await expect(page.locator("#guardrails li[data-reveal]").first()).toHaveCSS("opacity", "1");
  await expect(page.locator("#guardrails li[data-reveal]").first()).toHaveCSS("filter", "none");
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

test.describe("the live demo in the hero", () => {
  const demo = (page: Page) =>
    page.getByRole("group", { name: /^Interactive demo of the SupportPilot inbox/ });

  test("plays by itself: a new ticket arrives and gets a draft", async ({ page }) => {
    await page.goto("/");
    await demo(page).scrollIntoViewIfNeeded();
    await expect(page.getByText("Playing. Click anything to take over.")).toBeVisible();
    // The script brings in #129 and drafts a reply to it.
    await expect(
      demo(page).getByText("Can I add a second admin to our plan?").filter({ visible: true }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      demo(page).getByText("Reply sent to Daniel Kim.").filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("the visitor can take over, approve a draft and see a refusal", async ({ page, isMobile }) => {
    await page.goto("/");
    await demo(page).getByRole("button", { name: "Approve & send" }).click();
    await expect(page.getByText(/^Your turn:/)).toBeVisible();
    await expect(
      demo(page).getByText("Reply sent to Priya Shah.").filter({ visible: true }).first(),
    ).toBeVisible();

    // The Portuguese request: triage isn't confident enough, and no article answers it.
    const pick = isMobile
      ? demo(page).getByRole("button", { name: /^#130/ })
      : demo(page).getByRole("button", { name: /Vocês vendem licença vitalícia/ });
    await pick.click();
    await expect(demo(page).getByText("Needs review").filter({ visible: true }).first()).toBeVisible();
    await demo(page).getByRole("button", { name: "Generate draft" }).click();
    await expect(demo(page).getByText(/^No article is close enough to this question/)).toBeVisible();

    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByText("Playing. Click anything to take over.")).toBeVisible();
  });

  test("can be paused, and waits for the visitor with reduced motion", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused. Press play, or try it yourself.")).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(demo(page).getByText("Can I add a second admin to our plan?")).toHaveCount(0);
  });
});

test.describe("the live sections", () => {
  test("the workflow tour advances by itself and stops once a tab is chosen", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#how-it-works");
    await section.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const tabs = section.getByRole("tablist", { name: "Stages of a ticket" });
    await expect(tabs.getByRole("tab", { name: /^Search/ })).toHaveAttribute("aria-selected", "true", {
      timeout: 12_000,
    });
    await tabs.getByRole("tab", { name: /^Triage/ }).click();
    await expect(tabs.getByRole("tab", { name: /^Triage/ })).toHaveAttribute("aria-selected", "true");
    // The tour's progress line is gone: nothing moves on its own any more.
    await expect(section.locator(".land-progress")).toHaveCount(0);
  });

  test("the citation check can be shown before and after", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("group", { name: "Show the draft" });
    await toggle.getByRole("button", { name: "As written" }).click();
    await expect(toggle.getByRole("button", { name: "As written" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/^Showing the draft as the model wrote it/)).toBeAttached();
    await toggle.getByRole("button", { name: "After the check" }).click();
    await expect(page.getByText(/^Showing the draft after the check/)).toBeAttached();
    await expect(
      page.getByText("The AI cited sources that don't exist. Those numbers were removed."),
    ).toBeVisible();
  });

  test("the command palette accepts typing and the keyboard", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox", { name: /^Try the command palette/ });
    await box.fill("team");
    const list = page.getByRole("listbox", { name: "Results" });
    await expect(list.getByRole("option", { name: "Members" })).toHaveAttribute("aria-selected", "true");
    await box.press("ArrowDown");
    await expect(list.getByRole("option", { name: "Search tickets for “team”" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await box.press("ArrowUp");
    await box.press("Enter");
    await expect(page.getByText("In the app, this opens Members.")).toBeVisible();
    await box.fill("#42");
    await expect(list.getByRole("option", { name: "Open ticket #42" })).toBeVisible();
  });

  test("the support form sends a sample request into the inbox", async ({ page }) => {
    await page.goto("/");
    const form = page.getByRole("form", { name: "Demo support form" });
    await form.getByLabel("Your name").fill("");
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(form.getByRole("alert")).toHaveText("Fill in every field, with a valid email.");
    await expect(form.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");

    await form.getByLabel("Your name").fill("Ana Lima");
    await form.getByLabel("Subject").fill("Export my invoices");
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request received")).toBeVisible();
    await expect(page.getByText("Your private tracking link")).toBeVisible();
    const inbox = page.getByRole("group", { name: "The support team's inbox" });
    await expect(inbox).toContainText("Export my invoices");
    await expect(inbox).toContainText("#131 · Ana Lima");

    await page.getByRole("button", { name: "Send another" }).click();
    await expect(page.getByRole("form", { name: "Demo support form" }).getByLabel("Your name")).toBeFocused();
  });

  test("the API sample switches between JSON, curl and TypeScript", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tablist", { name: "Code sample" });
    // The sample sits in a scroll-focus block: after a jump scroll it settles 16 px up one frame
    // later, so tap only once it has (a tap at the old spot would miss a 32 px tab).
    await tabs.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await tabs.getByRole("tab", { name: "curl" }).click();
    await expect(page.locator("pre", { hasText: '-H "Content-Type: application/json"' })).toBeVisible();
    await tabs.getByRole("tab", { name: "TypeScript" }).click();
    await expect(page.locator("pre", { hasText: "await res.json()" })).toBeVisible();
  });
});
