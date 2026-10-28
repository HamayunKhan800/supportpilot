import type { Page } from "@playwright/test";
import { email, expect, settle, signIn, signUp, test, waitForTriage } from "./fixtures";

/**
 * Design system step 6: visual regression baselines for the key screens (light and dark on
 * desktop, light on mobile). Behaviour is tested elsewhere with role-based selectors; these
 * catch unintended changes to how the screens look.
 *
 * Determinism: the workspace, article and ticket text are fixed; the mock AI provider is
 * deterministic; anything that depends on the clock (every <time> element) gets fixed text and a
 * mask; the pointer is parked so no hover styles show. Baselines live in tests/e2e/__screenshots__.
 * After an intended design change: `pnpm test:visual:update`, then review the new images.
 */

const ARTICLE = `# Billing

## Refunds

Annual plans can be refunded within 30 days of purchase. Refunds reach the original card within 5 business days.
`;

type Theme = "light" | "dark";

async function setTheme(page: Page, baseURL: string, theme: Theme) {
  await page.context().addCookies([{ name: "sp_theme", value: theme, url: baseURL }]);
}

async function snap(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await settle(page);
  await page.mouse.move(0, 0);
  // A time's text width depends on the clock ("1:05 AM" vs "12:05 PM") and can change how a line
  // wraps, so give every time the same text first; the mask then hides it.
  await page.locator("time").evaluateAll((els) => {
    for (const el of els) el.textContent = "Jan 1, 2026, 9:00 AM";
  });
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: opts.fullPage ?? false,
    mask: [page.locator("time")],
  });
}

function themesFor(project: string): Theme[] {
  return project === "mobile" ? ["light"] : ["light", "dark"];
}

test("public pages look as designed", async ({ page, baseURL }, info) => {
  // Reduced motion: the headline and the section headings are still at once, so the picture
  // doesn't depend on timing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of themesFor(info.project.name)) {
    await setTheme(page, baseURL!, theme);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await snap(page, `landing-${theme}`, { fullPage: info.project.name === "desktop" && theme === "light" });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await snap(page, `sign-in-${theme}`);
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await snap(page, `not-found-${theme}`);
  }
});

test("the agent and customer screens look as designed", async ({ page, playwright, baseURL }, info) => {
  test.setTimeout(120_000);
  const slug = `visual-${info.project.name}-${Date.now().toString(36)}`;
  const who = email(`visual-${info.project.name}`);
  await signUp(page, "Vera Visual", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Visual Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visual Co" })).toBeVisible();

  // One help article, processed by the worker.
  await page.goto("/app/knowledge");
  const main = page.getByRole("main");
  await main
    .getByLabel("File")
    .setInputFiles({ name: "billing-refunds.md", mimeType: "text/markdown", buffer: Buffer.from(ARTICLE) });
  await main.getByRole("button", { name: "Upload" }).click();
  await expect(
    main.getByRole("listitem").filter({ hasText: "billing refunds" }).getByText("Ready"),
  ).toBeVisible({
    timeout: 30_000,
  });

  // A customer writes in through the portal (screenshotted before and after sending).
  await setTheme(page, baseURL!, "light");
  await page.goto(`/p/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: "Contact support" })).toBeVisible();
  await snap(page, "portal-light");
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
  const { trackingUrl } = (await res.json()) as { trackingUrl: string };
  await customer.dispose();

  // The worker triages it; wait for the result so the inbox row is complete.
  await waitForTriage(page, 1);
  await page.goto("/app/tickets/1");

  // A cited draft, generated once and shown in each theme.
  const panel = page.getByTestId("draft-panel");
  await panel.getByRole("button", { name: "Generate draft" }).click();
  await expect(panel.getByRole("status").first()).toHaveText("Draft ready. Review it before sending.", {
    timeout: 15_000,
  });

  for (const theme of themesFor(info.project.name)) {
    await setTheme(page, baseURL!, theme);
    await page.goto("/app/tickets/1");
    await expect(page.getByTestId("draft-text")).toContainText("Annual plans can be refunded");
    // State checked as text too: the 1% pixel tolerance let "Applied automatically" → "Needs
    // review" pass unnoticed once (finding #127). One keyword → mock confidence 0.75 < 0.95.
    await expect(page.getByTestId("triage-card")).toContainText("Not applied automatically");
    await snap(page, `ticket-${theme}`);
    await page.goto("/app/tickets");
    await expect(page.getByRole("link", { name: /Refund for annual plan/ }).first()).toBeVisible();
    await snap(page, `inbox-${theme}`);
    await page.goto(trackingUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Refund for annual plan" })).toBeVisible();
    await snap(page, `tracking-${theme}`);
  }
});
