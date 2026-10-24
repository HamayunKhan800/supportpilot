import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery staple";
export const runId = Date.now().toString(36);
export const email = (who: string) => `${who}.${runId}@e2e.test`;

/**
 * Fails any test whose page reports a Content-Security-Policy violation, proving the
 * strict nonce-based CSP does not break the app (and that nothing inline slips through).
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && /Content Security Policy/i.test(msg.text()))
          violations.push(msg.text());
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
        });
      });
      await use(violations);
      expect(violations, "CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function signUp(page: Page, name: string, address: string, next?: string) {
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/sign-in\?registered=1/);
}

export async function signIn(page: Page, address: string) {
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * The sidebar navigation. On narrow screens it lives in a drawer behind the menu button,
 * which this opens first, so the same test steps run on desktop and mobile.
 */
export async function workspaceNav(page: Page) {
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(menuButton.or(nav).first()).toBeVisible();
  if (!(await nav.isVisible())) await menuButton.click();
  await expect(nav).toBeVisible();
  return nav;
}

/** Opens the account menu at the foot of the sidebar and returns it. */
export async function accountMenu(page: Page) {
  await workspaceNav(page);
  await page.getByRole("button", { name: /^Account menu/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Closes the mobile navigation drawer if it is open (no-op on wide screens). */
export async function closeDrawer(page: Page) {
  const close = page.getByRole("button", { name: "Close navigation" });
  if (await close.isVisible()) {
    await close.click();
    await expect(close).toBeHidden();
  }
}

/** Present on every workspace page once the app shell has rendered (desktop and mobile). */
export const appShell = (page: Page) => page.getByRole("button", { name: /^Search or jump to/ });

/**
 * Brings a page to the state a reader sees: scrolls through it once, so scroll reveals have run
 * (the landing page hides not-yet-seen sections until they enter the viewport), returns to the
 * top, and waits for one-shot animations to end. Endless ones (a blinking caret) are ignored.
 * Pages without scroll reveals (the app) are not scrolled, but still wait for opening transitions:
 * on a slow CI runner axe once scanned the command palette mid-fade and measured the half-faded
 * text as low contrast.
 */
export async function settle(page: Page) {
  const reveals = (await page.locator("[data-reveal]").count()) > 0;
  if (reveals) await scrollThrough(page);
  // The landing page's one-shot animations end within about 1.5 s, app transitions within 0.3 s;
  // the caps only bound the wait.
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
      null,
      { timeout: reveals ? 3000 : 1000 },
    )
    .catch(() => {});
}

async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await frame();
    }
    window.scrollTo(0, 0);
    await frame();
  });
}

/** WCAG 2.2 A/AA rules. Done-when for M2: zero serious or critical violations. */
export async function audit(page: Page, label: string) {
  await settle(page);
  // Scan a settled page: once (finding #111) axe ran right after a save and found no <title>,
  // which never reproduced (6 repeats, and a probe watching the title through 5 saves). A page
  // with no title at all still fails here, with a clearer message.
  await expect(page, `${label}: the page has a title`).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map(
      (v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

/**
 * Waits until the background worker has triaged every ticket in the signed-in workspace (M5).
 * Triage can apply labels, which bumps a ticket's version, so tests that edit tickets wait for
 * it first; otherwise their save could meet a (correct) 409 at a random moment.
 */
export async function waitForTriage(page: Page, expectedTickets: number) {
  await expect
    .poll(
      async () => {
        const list = await page.request.get("/api/v1/tickets?status=open,pending,resolved,closed&limit=100");
        if (!list.ok()) throw new Error(`ticket list returned ${list.status()}: ${await list.text()}`);
        const items = ((await list.json()) as { items: { id: string }[] }).items;
        if (items.length < expectedTickets) return false;
        const details = await Promise.all(
          items.map(
            async (t) =>
              (await (await page.request.get(`/api/v1/tickets/${t.id}`)).json()) as { triage: unknown },
          ),
        );
        return details.every((d) => d.triage !== null);
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
}
