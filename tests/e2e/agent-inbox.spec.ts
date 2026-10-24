import type { APIRequestContext, Page } from "@playwright/test";
import { email, expect, signIn, signUp, test, waitForTriage, property, setProperty } from "./fixtures";

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
  await waitForTriage(page, 2); // the AI may label the refund request in the background

  // Inbox: both requests, counts on the tabs, search and filters narrow the list.
  await page.getByRole("link", { name: "Tickets", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/tickets$/);
  const results = page.getByRole("region", { name: "Results" }).getByRole("listitem");
  await expect(results).toHaveCount(2);
  await expect(page.getByRole("link", { name: /^Active\s*2$/ })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Search").fill("refund");
  await page.getByLabel("Search").press("Enter"); // filters apply at once; search on Enter (step 9.5)
  await expect(page).toHaveURL(/q=refund/);
  await expect(results).toHaveCount(1);
  await page.getByLabel("Search").fill("#2");
  await page.getByLabel("Search").press("Enter");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("Sync paused on Windows");
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(results).toHaveCount(2);

  // Filter chips apply the moment a value is picked and clear with one click (design step 9.5).
  await page.getByRole("button", { name: /^Sort/ }).click();
  await page.getByRole("menuitemradio", { name: "Oldest first", exact: true }).click();
  await expect(page).toHaveURL(/sort=oldest/);
  await expect(results.first()).not.toContainText("Sync paused on Windows");
  await page.getByRole("button", { name: /^Assignee/ }).click();
  await page.getByRole("menuitemradio", { name: "Unassigned", exact: true }).click();
  await expect(page).toHaveURL(/assignee=unassigned/);
  await page.getByRole("button", { name: "Clear assignee filter" }).click();
  await expect(page).not.toHaveURL(/assignee=/);
  await expect(page).toHaveURL(/sort=oldest/);
  await page.goto("/app/tickets");

  // Keyboard: j/k move through the list and Enter opens; on a ticket, j/k step through the same list.
  await page.getByRole("heading", { level: 1, name: "Tickets" }).click();
  await page.keyboard.press("j");
  await expect(results.nth(0).getByRole("link")).toBeFocused();
  await page.keyboard.press("j");
  await expect(results.nth(1).getByRole("link")).toBeFocused();
  await page.keyboard.press("k");
  await expect(results.nth(0).getByRole("link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/tickets\/2$/); // newest first
  await expect(page.getByText("1 of 2")).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/app\/tickets\/1$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Refund for duplicate charge");
  await page.getByRole("link", { name: "Previous ticket" }).click();
  await expect(page).toHaveURL(/\/app\/tickets\/2$/);
  await page.getByRole("link", { name: "All tickets" }).click();
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

  // Details save as they change (design step 8.3): three quick changes, saved in order.
  await setProperty(page, "Status", "Pending");
  await setProperty(page, "Priority", "High");
  await setProperty(page, "Assignee", "Olivia Owner (you)");
  await expect(page.getByText("Assignee changed to Olivia Owner")).toBeVisible();
  await expect(page.getByRole("main").getByText("Status: Pending")).toBeAttached();

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
  await waitForTriage(page, 1);

  // Two tabs open the same version of the ticket.
  await page.goto("/app/tickets/1");
  const other = await context.newPage();
  await other.goto("/app/tickets/1");

  await setProperty(page, "Priority", "Urgent");
  await expect(page.getByText("Priority changed to Urgent")).toBeVisible();

  await setProperty(other, "Priority", "Low");
  const alert = other.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("changed by someone else");
  await other.getByRole("button", { name: "Load latest version" }).click();
  await expect(property(other, "Priority")).toHaveAccessibleName("Priority Urgent"); // the first save was not overwritten

  // Closed: final status, public replies off, internal notes still allowed.
  await page.reload();
  await setProperty(page, "Status", "Closed");
  // Closing is final, so it asks first (and offers no Undo).
  const confirmClose = page.getByRole("alertdialog", { name: "Close this request?" });
  await confirmClose.getByRole("button", { name: "Close request" }).click();
  await expect(confirmClose).toBeHidden();
  await expect(page.getByText("Closed requests are final.")).toBeVisible();
  await expect(page.getByLabel("Public reply to Casey Customer")).toBeDisabled();
  await expect(page.getByLabel("Internal note (team only)")).toBeChecked();
  await property(page, "Status").click();
  await expect(page.getByRole("menuitemradio", { name: "Open", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
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

test("a customer reply reopens a resolved ticket, and the overview counts it", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const slug = `reopen-${Date.now().toString(36)}`;
  await ownerWithWorkspace(page, "reopen-owner", "Reopen Co", slug);
  const customer = await playwright.request.newContext({ baseURL });
  const link = await customerSubmits(
    customer,
    slug,
    "Folder sharing broken",
    "My shared folder link stopped working.",
  );
  await waitForTriage(page, 1);

  const overviewCount = (label: string) =>
    page
      .getByRole("main")
      .getByRole("definition")
      .filter({ has: page.getByRole("link", { name: new RegExp(label, "i") }) });
  await page.goto("/app");
  await expect(overviewCount("open tickets")).toHaveText(/^1/);

  // The agent replies and resolves.
  await page.goto("/app/tickets/1");
  await page
    .getByLabel("Reply to Casey Customer", { exact: true })
    .fill("Fixed on our side. Please try the link again.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Reply sent to Casey Customer.")).toBeVisible();
  await setProperty(page, "Status", "Resolved");
  await expect(page.getByText("Status changed to Resolved")).toBeVisible();
  await page.goto("/app");
  await expect(overviewCount("open tickets")).toHaveText(/^0/);

  // The customer says it's still broken: the ticket is open again for the team.
  const tracking = await (await browser.newContext()).newPage();
  await tracking.goto(link);
  await expect(tracking.getByText("Status: Resolved")).toBeVisible();
  await tracking.getByLabel("Your reply").fill("Still broken for me, sorry!");
  await tracking.getByRole("button", { name: "Send reply" }).click();
  await expect(tracking.getByText("Reply sent.")).toBeVisible();

  await page.reload();
  await expect(overviewCount("open tickets")).toHaveText(/^1/);
  await page.goto("/app/tickets/1");
  await expect(property(page, "Status")).toHaveAccessibleName("Status Open");
  await expect(page.getByRole("listitem").filter({ hasText: "Still broken for me" })).toContainText(
    "customer",
  );
  await customer.dispose();
});

test("the tracking token never leaks to referrers, agents or the audit log", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const slug = `leak-${Date.now().toString(36)}`;
  await ownerWithWorkspace(page, "leak-owner", "Leak Check Co", slug);
  const customer = await playwright.request.newContext({ baseURL });
  const link = await customerSubmits(
    customer,
    slug,
    "Token leak check",
    "Checking where my private link appears.",
  );
  const token = link.split("/t/")[1]!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Customer side: no request from the tracking page carries the link as a Referer,
  // including the page's own scripts and the reply sent from it.
  const trackingContext = await browser.newContext();
  const tracking = await trackingContext.newPage();
  const referers: string[] = [];
  tracking.on("request", (req) => {
    const referer = req.headers()["referer"];
    if (referer) referers.push(referer);
  });
  await tracking.goto(link);
  await tracking.getByLabel("Your reply").fill("One more detail.");
  await tracking.getByRole("button", { name: "Send reply" }).click();
  await expect(tracking.getByText("Reply sent.")).toBeVisible();
  expect(referers.filter((r) => r.includes(token))).toEqual([]);

  // Agent side: only a hash is stored, so the token appears nowhere agents can look.
  for (const path of ["/app/tickets", "/app/tickets/1", "/app/audit"]) {
    const res = await page.goto(path);
    expect(await res!.text(), path).not.toContain(token);
  }
  const list = await page.request.get("/api/v1/tickets");
  expect(await list.text()).not.toContain(token);
  const id = ((await list.json()) as { items: { id: string }[] }).items[0]!.id;
  expect(await (await page.request.get(`/api/v1/tickets/${id}`)).text()).not.toContain(token);
  await trackingContext.close();
  await customer.dispose();
});
