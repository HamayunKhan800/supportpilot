import { accountMenu, email, expect, signIn, signUp, test } from "./fixtures";

/**
 * The M2 journey: an owner creates a workspace and invites an agent, the agent joins
 * through the invite link, and the role matrix is visible in the UI.
 */
test.describe.configure({ mode: "serial" });

const owner = email("owner");
const agent = email("agent");
let inviteUrl = "";

test("owner signs up, creates a workspace and invites an agent", async ({ page }) => {
  await signUp(page, "Olivia Owner", owner);
  await expect(page.getByRole("status")).toContainText("Account created");
  await signIn(page, owner);

  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Nimbus Cloud Storage");
  await expect(page.getByLabel("Workspace address")).toHaveValue("nimbus-cloud-storage");
  await page.getByLabel("Workspace address").fill(`nimbus-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Nimbus Cloud Storage" })).toBeVisible();
  await expect(page.getByText("Your role:")).toBeAttached();

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Members" }).click();
  await page.getByLabel("Email").fill(agent);
  await page.getByLabel("Role").selectOption("agent");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = page.getByLabel("Invitation link created");
  await expect(link).toHaveValue(/\/invite\//);
  inviteUrl = new URL(await link.inputValue()).pathname;
  await expect(page.getByRole("region", { name: /Pending invitations/ }).getByText(agent)).toBeVisible();
});

test("the invite link reveals nothing until the invitee signs in, then the agent joins", async ({ page }) => {
  await page.goto(inviteUrl);
  await expect(page.getByRole("heading", { name: "You've been invited" })).toBeVisible();
  await expect(page.getByText("Nimbus Cloud Storage")).toHaveCount(0);

  await page.getByRole("link", { name: "Create an account" }).click();
  await signUp(page, "Aaron Agent", agent, inviteUrl);
  await signIn(page, agent);

  await expect(page).toHaveURL(inviteUrl);
  await expect(page.getByRole("heading", { name: "Join Nimbus Cloud Storage" })).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nimbus Cloud Storage" })).toBeVisible();

  // Agents get no audit log link, and the page itself refuses them (server-side check).
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto("/app/audit");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

  // Members page: agents see the team but no management controls.
  await page.goto("/app/members");
  await expect(page.getByRole("cell", { name: /Olivia Owner/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create invite link" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

  // Knowledge base: agents can read it but not change it or spend quota on test searches.
  await nav.getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge base" })).toBeVisible();
  await expect(page.getByText("Only admins and owners can change them.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a document" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Test search" })).toHaveCount(0);
  await page.goto("/app/knowledge/search");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

  // AI settings: agents see the usage and the values, but can't change them.
  await nav.getByRole("link", { name: "AI settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI settings" })).toBeVisible();
  await expect(page.getByText("Only admins and owners can change these settings.")).toBeVisible();
  await expect(page.getByText("Monthly token budget", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("the same invite link cannot be used again", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, agent);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(inviteUrl);
  await expect(page.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
});

test("owner sees the agent, can change their role, and sees it in the audit log", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/members");
  await page.getByLabel("Role for Aaron Agent").selectOption("admin");
  await expect(page.getByRole("row", { name: /Aaron Agent/ }).locator('[data-slot="badge"]')).toHaveText(
    "admin",
  );

  await page.goto("/app/audit");
  const table = page.getByRole("table", { name: "Audit events" });
  for (const text of [
    "Created the workspace",
    "Invited a member",
    "Accepted an invitation",
    "Changed a member's role",
  ]) {
    await expect(table.getByText(text).first()).toBeVisible();
  }
  await expect(table.getByRole("cell", { name: "Olivia Owner" }).first()).toBeVisible();
});

test("signing out ends the session", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/app$/);
  await (await accountMenu(page)).getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp/);
});
