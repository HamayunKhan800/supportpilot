import { audit, email, expect, signIn, signUp, test } from "./fixtures";

test("public pages have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/", "/sign-in", "/sign-up", "/invite/example-invitation-id", "/no-such-page"]) {
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

  for (const path of ["/app", "/app/members", "/app/settings", "/app/audit", "/app/account"]) {
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

test("customer portal and tracking pages have no serious accessibility violations", async ({
  page,
  baseURL,
}) => {
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

  // The customer-facing pages in the dark theme too (design system step 5).
  const trackingUrl = page.url();
  await page.context().addCookies([{ name: "sp_theme", value: "dark", url: baseURL! }]);
  for (const [path, label] of [
    [trackingUrl, "/t/{token} (dark)"],
    [`/p/${slug}`, "/p/{slug} (dark)"],
    ["/invite/example-invitation-id", "/invite/{id} (dark)"],
    ["/no-such-page", "404 (dark)"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await audit(page, label);
  }
  await page.context().clearCookies({ name: "sp_theme" });

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
  // Finding #91: the refresh after posting removes the <title> for a moment and streams it back
  // (Next.js streaming metadata). Audit the settled page: wait for the refreshed thread, then
  // the title. A title that never came back would still fail here.
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText("Checked with axe.");
  await expect(page).toHaveTitle(/^#1 /);
  await audit(page, "/app/tickets/{number}");
});

test("knowledge pages have no serious accessibility violations", async ({ page, baseURL }) => {
  const project = test.info().project.name;
  const who = email(`a11y-kb-${project}`);
  await signUp(page, "Ada Access", who);
  await signIn(page, who);
  await page.getByLabel("Workspace name").fill("Accessible Knowledge Co");
  await page.getByLabel("Workspace address").fill(`a11y-kb-${Date.now().toString(36)}-${project}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Accessible Knowledge Co" })).toBeVisible();

  const main = page.getByRole("main");
  await page.goto("/app/knowledge");
  await audit(page, "/app/knowledge (empty)");
  await main.getByRole("button", { name: "Upload" }).click();
  await audit(page, "/app/knowledge (field error)");

  await main.getByLabel("File").setInputFiles({
    name: "getting-started.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Getting started\n\nInvite your team from the Members page.\n"),
  });
  await main.getByRole("button", { name: "Upload" }).click();
  const row = main.getByRole("listitem").filter({ hasText: "getting started" });
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  await audit(page, "/app/knowledge (with a document)");

  await main
    .getByLabel("File")
    .setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.from("") });
  await main.getByRole("button", { name: "Upload" }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await audit(page, "/app/knowledge (upload error)");

  await row.getByRole("link", { name: "getting started" }).click();
  await expect(main.getByRole("heading", { name: /Passages/ })).toBeVisible();
  await audit(page, "/app/knowledge/{id}");
  await main.getByRole("button", { name: "Delete document" }).click();
  await audit(page, "/app/knowledge/{id} (confirm delete)");

  await page.goto("/app/knowledge/search");
  await audit(page, "/app/knowledge/search");
  await main.getByRole("button", { name: "Search" }).click();
  await audit(page, "/app/knowledge/search (field error)");
  await main.getByLabel("Question").fill("How do I invite my team?");
  await main.getByRole("button", { name: "Search" }).click();
  await expect(main.getByRole("heading", { name: /for “How do I invite my team\?”/ })).toBeVisible();
  await audit(page, "/app/knowledge/search (results)");

  // The same pages in the dark theme, with content (design step 4).
  await page.context().addCookies([{ name: "sp_theme", value: "dark", url: baseURL! }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await main.getByLabel("Question").fill("How do I invite my team?");
  await main.getByRole("button", { name: "Search" }).click();
  await expect(main.getByText(/^Best similarity/)).toBeVisible();
  await audit(page, "/app/knowledge/search (dark, results)");
  await page.goto("/app/knowledge");
  await expect(row.getByText("Ready")).toBeVisible();
  await audit(page, "/app/knowledge (dark, with a document)");
  await row.getByRole("link", { name: "getting started" }).click();
  await expect(main.getByRole("heading", { name: /Passages/ })).toBeVisible();
  await audit(page, "/app/knowledge/{id} (dark)");
  await page.goto("/app");
  await expect(main.getByRole("heading", { name: "Latest active tickets" })).toBeVisible();
  await audit(page, "/app (dark, no tickets)");
});
