import type { APIRequestContext, Page } from "@playwright/test";
import { email, expect, signIn, signUp, test } from "./fixtures";

/**
 * FR-T3–T6 through the agent UI: inbox filters and search, the ticket page, public
 * replies vs internal notes, status/priority/assignee changes, concurrent edits and the
 * audit trail. The customer's side is checked through their tracking page.
 */
async function ownerWithWorkspace(page: Page, who: string, name: string, slug: string) {
  const address = email(who);
  await signUp(page, "Olivia Owner", address);
  await signIn(page, address);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill(name);
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** A customer (no cookies) submitting through the public API; returns the tracking URL. */
async function customerSubmits(customer: APIRequestContext, slug: string, subject: string, message: string) {
  const res = await customer.post(`/api/v1/portal/${slug}/tickets`, {
    data: { name: "Casey Customer", email: "casey@example.test", subject, message },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { trackingUrl: string }).trackingUrl;
}

test("agent works a ticket end to end", async ({ page, browser, playwright, baseURL }) => {
  const slug = `inbox-${Date.now().toString(36)}`;
  await ownerWithWorkspace(page, "inbox-owner", "Inbox Co", slug);
  const customer = await playwright.request.newContext({ baseURL });
  const link = await customerSubmits(
    customer,
    slug,
    "Refund for duplicate charge",
    "I was charged twice in October.",
  );
  await customerSubmits(
    customer,
    slug,
    "Sync paused on Windows",
    "The desktop app stopped syncing after 4.2.",
  );

  // Inbox: both requests, counts on the tabs, search and filters narrow the list.
  await page.getByRole("link", { name: "Tickets", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/tickets$/);
  const results = page.getByRole("region", { name: "Results" }).getByRole("listitem");
  await expect(results).toHaveCount(2);
  await expect(page.getByRole("link", { name: /^Active\s*2$/ })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Search").fill("refund");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=refund/);
  await expect(results).toHaveCount(1);
  await page.getByLabel("Search").fill("#2");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("Sync paused on Windows");
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(results).toHaveCount(2);

  // Ticket page: public reply, then an internal note.
  await page.getByRole("link", { name: /Refund for duplicate charge/ }).click();
  await expect(page).toHaveURL(/\/app\/tickets\/1$/);
  await expect(page.getByRole("link", { name: "Tickets", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByLabel("Reply to Casey Customer", { exact: true })).toBeFocused();
  await page
    .getByLabel("Reply to Casey Customer", { exact: true })
    .fill("Sorry about that! The duplicate charge is refunded.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Reply sent to Casey Customer.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "duplicate charge is refunded" })).toContainText(
    "public reply",
  );

  await page.getByLabel("Internal note (team only)").check();
  await page.getByLabel("Internal note", { exact: true }).fill("Refund ID R-1029 issued via Stripe.");
  await page.getByRole("button", { name: "Add internal note" }).click();
  await expect(page.getByText("Internal note added.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "R-1029" })).toContainText(
    "Internal note, not visible to the customer",
  );

  // Details: status, priority and assignee in one save.
  await page.getByLabel("Status").selectOption("pending");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByLabel("Assignee").selectOption({ label: "Olivia Owner (you)" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("main").getByText("Status: Pending")).toBeAttached();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  // The customer sees the public reply, never the note, and the waiting status.
  const tracking = await (await browser.newContext()).newPage();
  await tracking.goto(link);
  await expect(tracking.getByText("duplicate charge is refunded")).toBeVisible();
  await expect(tracking.getByText("Olivia Owner (support team)")).toBeVisible();
  await expect(tracking.getByText("R-1029")).toHaveCount(0);
  await expect(tracking.getByText("Waiting for your reply")).toBeVisible();

  // Filters: "me" finds the assigned ticket; the Pending tab counts it.
  await page.goto("/app/tickets?assignee=me");
  await expect(results).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Pending\s*1$/ })).toBeVisible();

  // Every change is in the audit log.
  await page.goto("/app/audit");
  for (const action of ["Changed status", "Changed priority", "Changed assignee", "Submitted a request"]) {
    await expect(page.getByRole("cell", { name: new RegExp(action) }).first()).toBeVisible();
  }
  await customer.dispose();
});

test("concurrent edits are detected, and closed tickets accept notes only", async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const slug = `conflict-${Date.now().toString(36)}`;
  await ownerWithWorkspace(page, "conflict-owner", "Conflict Co", slug);
  const customer = await playwright.request.newContext({ baseURL });
  await customerSubmits(customer, slug, "Two agents, one ticket", "Who gets there first?");

  // Two tabs open the same version of the ticket.
  await page.goto("/app/tickets/1");
  const other = await context.newPage();
  await other.goto("/app/tickets/1");

  await page.getByLabel("Priority").selectOption("urgent");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await other.getByLabel("Priority").selectOption("low");
  await other.getByRole("button", { name: "Save changes" }).click();
  const alert = other.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("changed by someone else");
  await other.getByRole("button", { name: "Load latest version" }).click();
  await expect(other.getByLabel("Priority")).toHaveValue("urgent"); // the first save was not overwritten

  // Closed: final status, public replies off, internal notes still allowed.
  await page.reload();
  await page.getByLabel("Status").selectOption("closed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Closed requests are final.")).toBeVisible();
  await expect(page.getByLabel("Public reply to Casey Customer")).toBeDisabled();
  await expect(page.getByLabel("Internal note (team only)")).toBeChecked();
  await expect(page.getByLabel("Status").locator('option[value="open"]')).toBeDisabled();
  await page.getByLabel("Internal note", { exact: true }).fill("Closed after duplicate check.");
  await page.getByRole("button", { name: "Add internal note" }).click();
  await expect(page.getByText("Internal note added.")).toBeVisible();
  await customer.dispose();
});

test("tickets from another workspace are not found, and bad filter URLs are explained", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const slug = `iso-a-${Date.now().toString(36)}`;
  await ownerWithWorkspace(page, "iso-owner-a", "Isolation A", slug);
  const customer = await playwright.request.newContext({ baseURL });
  await customerSubmits(customer, slug, "Private to workspace A", "Only A may see this.");

  const intruder = await (await browser.newContext()).newPage();
  await ownerWithWorkspace(intruder, "iso-owner-b", "Isolation B", `iso-b-${Date.now().toString(36)}`);
  const res = await intruder.goto("/app/tickets/1");
  expect(res!.status()).toBe(404);
  await expect(intruder.getByText("Private to workspace A")).toHaveCount(0);
  await intruder.goto("/app/tickets");
  await expect(intruder.getByText("No requests yet.")).toBeVisible();

  await page.goto("/app/tickets?priority=extreme");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Some filters in the address are not valid.",
  );
  await customer.dispose();
});
