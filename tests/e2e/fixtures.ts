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

/** WCAG 2.2 A/AA rules. Done-when for M2: zero serious or critical violations. */
export async function audit(page: Page, label: string) {
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
