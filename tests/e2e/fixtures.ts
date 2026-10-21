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
