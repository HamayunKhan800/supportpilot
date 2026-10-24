import type { Locator, Page } from "@playwright/test";
import { email, expect, PASSWORD, signIn, signUp, test, waitForTriage } from "./fixtures";

/**
 * Design system step 6: keyboard-only walkthrough. No clicks and no fills in the journey itself:
 * only Tab, typing and the documented shortcuts. At every Tab stop the focused element must look
 * different from its unfocused state (WCAG 2.4.7 Focus Visible) and must not be covered by
 * anything else, such as the sticky header (WCAG 2.4.11 Focus Not Obscured).
 * Desktop only: the phone project has no hardware keyboard.
 */

const ARTICLE = `# Billing

## Refunds

Annual plans can be refunded within 30 days of purchase. Refunds reach the original card within 5 business days.
`;

interface FocusReport {
  name: string;
  changed: boolean;
  obscuredBy: string | null;
}

/** Describes the focused element, and compares how it looks focused and unfocused. */
async function inspectFocus(page: Page): Promise<FocusReport | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    // Focus styles animate (transition-all); jump each transition to its end before reading.
    const look = () => {
      for (const animation of el.getAnimations()) animation.finish();
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return [
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.boxShadow,
        s.backgroundColor,
        s.color,
        s.borderColor,
        s.textDecorationLine,
        r.width,
        r.height,
      ].join("|");
    };
    const focused = look();
    el.blur();
    const unfocused = look();
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    const ok =
      !hit || hit === el || el.contains(hit) || hit.contains(el) || !!hit.closest("label")?.contains(el);
    const name =
      (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 50) || el.tagName.toLowerCase();
    return {
      name,
      changed: focused !== unfocused,
      obscuredBy: ok ? null : `${hit!.tagName.toLowerCase()}.${hit!.className.toString().slice(0, 60)}`,
    };
  });
}

async function expectVisibleFocus(page: Page, where: string) {
  const report = await inspectFocus(page);
  if (!report) return; // focus left the page content (e.g. to the browser chrome)
  expect(report.changed, `${where}: "${report.name}" shows no focus indicator`).toBe(true);
  expect(report.obscuredBy, `${where}: "${report.name}" is covered when focused`).toBeNull();
}

/** Presses Tab until `target` has focus, checking every stop on the way. */
async function tabTo(page: Page, target: Locator, where: string, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page, where);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`${where}: Tab never reached the target in ${max} presses`);
}

/** Tabs through every stop on the page (until focus wraps or leaves), checking each one. */
async function tabThroughPage(page: Page, where: string, { reverse = false, max = 80 } = {}) {
  const seen = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "";
      const all = Array.from(document.querySelectorAll("*"));
      return String(all.indexOf(el));
    });
    if (!id || seen.has(id)) return seen.size;
    seen.add(id);
    await expectVisibleFocus(page, where);
  }
  return seen.size;
}

test.skip(({ isMobile }) => isMobile, "keyboard walkthrough runs on desktop");

test("every Tab stop on the public pages has a visible, uncovered focus indicator", async ({ page }) => {
  for (const path of ["/", "/sign-in", "/sign-up", "/no-such-page"]) {
    await page.goto(path);
    const stops = await tabThroughPage(page, path);
    expect(stops, `${path} has keyboard stops`).toBeGreaterThan(2);
  }
  // Backwards from the bottom of the landing page: focus moving up must not hide under the
  // sticky header.
  await page.goto("/"); // from a fresh page, Shift+Tab starts at the last stop
  const back = await tabThroughPage(page, "/ (Shift+Tab)", { reverse: true });
  expect(back).toBeGreaterThan(10);
});

test("an agent goes from sign-in to a sent, cited reply with the keyboard alone", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  // Setup (not part of the walkthrough): an account, a workspace, one article and one ticket.
  const who = email("keyboard-journey");
  const slug = `keyboard-${Date.now().toString(36)}`;
  const setup = await (await browser.newContext({ baseURL })).newPage();
  await signUp(setup, "Kim Keyboard", who);
  await signIn(setup, who);
  await expect(setup).toHaveURL(/\/app\/onboarding/);
  await setup.getByLabel("Workspace name").fill("Keyboard Co");
  await setup.getByLabel("Workspace address").fill(slug);
  await setup.getByRole("button", { name: "Create workspace" }).click();
  await expect(setup.getByRole("heading", { level: 1, name: "Keyboard Co" })).toBeVisible();
  await setup.goto("/app/knowledge");
  const kb = setup.getByRole("main");
  await kb
    .getByLabel("File")
    .setInputFiles({ name: "billing-refunds.md", mimeType: "text/markdown", buffer: Buffer.from(ARTICLE) });
  await kb.getByRole("button", { name: "Upload" }).click();
  await expect(
    kb.getByRole("listitem").filter({ hasText: "billing refunds" }).getByText("Ready"),
  ).toBeVisible({
    timeout: 30_000,
  });
  const customer = await playwright.request.newContext({ baseURL });
  const res = await customer.post(`/api/v1/portal/${slug}/tickets`, {
    data: {
      name: "Casey Customer",
      email: "casey@example.test",
      subject: "Refund for annual plan",
      message: "Can I get a refund on my annual plan? I bought it last week.",
    },
  });
  expect(res.status()).toBe(201);
  await customer.dispose();
  await waitForTriage(setup, 1);
  await setup.context().close();

  // 1. Sign in. The first Tab stop is the skip link.
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await tabTo(page, page.getByLabel("Email"), "sign-in");
  await page.keyboard.type(who);
  await tabTo(page, page.getByLabel("Password"), "sign-in");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Keyboard Co" })).toBeVisible();

  // 2. The command palette jumps to the inbox.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByRole("combobox", { name: "Search or jump to" })).toBeFocused();
  await page.keyboard.type("Tickets");
  await expect(palette.getByRole("option").first()).toHaveText("Tickets"); // results have updated
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/tickets$/);
  // The URL changes before the palette's closing transition ends; until then its input keeps
  // focus, so wait for it to go before pressing the next key.
  await expect(palette).toBeHidden();

  // 3. J selects the first ticket, Enter opens it.
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/tickets\/1$/);

  // 4. Tab to "Generate draft" (checking every stop on the way) and press Enter.
  const panel = page.getByTestId("draft-panel");
  await tabTo(page, panel.getByRole("button", { name: "Generate draft" }), "ticket page", 80);
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status").first()).toHaveText("Draft ready. Review it before sending.", {
    timeout: 15_000,
  });
  await expect(panel.getByTestId("draft-text")).toContainText("Annual plans can be refunded");

  // 5. E edits the draft (shortcuts work while focus is on a button); add a sign-off.
  await page.keyboard.press("e");
  const editor = panel.getByLabel("Edit the reply to Casey Customer");
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nBest wishes, Kim");
  await tabTo(page, panel.getByRole("button", { name: "Done editing" }), "draft editor", 10);
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("draft-preview")).toContainText("Best wishes, Kim");

  // 6. A moves focus to Approve & send (never sends by itself); Enter sends.
  await page.keyboard.press("a");
  await expect(panel.getByRole("button", { name: "Approve & send" })).toBeFocused();
  await expectVisibleFocus(page, "approve");
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("draft-outcome")).toContainText("Reply sent to Casey Customer.");
  const reply = page
    .getByRole("region", { name: "Conversation" })
    .getByRole("listitem")
    .filter({ hasText: "public reply" });
  await expect(reply).toContainText("Annual plans can be refunded within 30 days of purchase");
  await expect(reply).toContainText("Best wishes, Kim");
});
