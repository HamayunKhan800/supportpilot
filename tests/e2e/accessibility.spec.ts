import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { email, expect, signIn, signUp, test } from "./fixtures";

/** WCAG 2.2 A/AA rules. Done-when for M2: zero serious or critical violations. */
async function audit(page: Page, label: string) {
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

test("public pages have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/", "/sign-in", "/sign-up", "/invite/example-invitation-id"]) {
    await page.goto(path);
    await audit(page, path);
  }
});

test("signed-in pages have no serious accessibility violations", async ({ page }) => {
  const who = email(`a11y-${test.info().project.name}`);
  await signUp(page, "Ada Access", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await audit(page, "/app/onboarding");
  await page.getByLabel("Workspace name").fill("Accessible Co");
  await page
    .getByLabel("Workspace address")
    .fill(`a11y-${Date.now().toString(36)}-${test.info().project.name}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Accessible Co" })).toBeVisible();

  for (const path of ["/app", "/app/members", "/app/audit", "/app/account"]) {
    await page.goto(path);
    await audit(page, path);
  }
});

test("forms show errors accessibly", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@e2e.test");
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Scoped to <main>: Next.js adds its own role="alert" route announcer.
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await audit(page, "/sign-in (error)");
});

test("customer portal and tracking pages have no serious accessibility violations", async ({ page }) => {
  const who = email(`a11y-portal-${test.info().project.name}`);
  const slug = `a11y-portal-${Date.now().toString(36)}-${test.info().project.name}`;
  await signUp(page, "Ada Access", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Accessible Portal Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Accessible Portal Co" })).toBeVisible();

  await page.goto(`/p/${slug}`);
  await audit(page, "/p/{slug}");
  await page.getByRole("button", { name: "Send request" }).click();
  await audit(page, "/p/{slug} (errors)");
  await page.getByLabel("Your name").fill("Casey Customer");
  await page.getByLabel("Email").fill("casey@example.test");
  await page.getByLabel("Subject").fill("Accessibility check");
  await page.getByLabel("How can we help?").fill("Checking the customer pages with axe.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
  await audit(page, "/p/{slug} (received)");

  await page.goto(await page.getByLabel("Your private tracking link").inputValue());
  await audit(page, "/t/{token}");
  await page.getByRole("button", { name: "Send reply" }).click();
  await audit(page, "/t/{token} (error)");

  // Agent side, same session (the owner is signed in).
  await page.goto("/app/tickets");
  await audit(page, "/app/tickets");
  await page.goto("/app/tickets?priority=extreme");
  await audit(page, "/app/tickets (invalid filter)");
  await page.goto("/app/tickets/1");
  await page.getByLabel("Internal note (team only)").check();
  await page.getByLabel("Internal note", { exact: true }).fill("Checked with axe.");
  await page.getByRole("button", { name: "Add internal note" }).click();
  await expect(page.getByText("Internal note added.")).toBeVisible();
  await audit(page, "/app/tickets/{number}");
});
