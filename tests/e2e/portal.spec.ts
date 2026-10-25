import type { APIRequestContext, Page } from "@playwright/test";
import { email, expect, signIn, signUp, test } from "./fixtures";

/**
 * FR-T1/T2/T3 through the browser: a customer with no account submits a request, gets a
 * private link, follows the conversation and replies. Internal notes never reach them.
 */
const TOKEN_URL = /\/t\/[A-Za-z0-9_-]{43}$/;

async function createWorkspace(page: Page, who: string, slug: string) {
  const address = email(who);
  await signUp(page, "Olivia Owner", address);
  await signIn(page, address);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Portal Test Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Portal Test Co" })).toBeVisible();
  // The overview tells the owner where their customers go.
  await expect(page.getByRole("link", { name: /^Open the customer portal/ })).toHaveAttribute(
    "href",
    `/p/${slug}`,
  );
}

/** Agent-side calls through the REST API with the signed-in owner's cookies. */
function agentApi(request: APIRequestContext, baseURL: string) {
  const headers = { origin: baseURL, "content-type": "application/json" };
  return {
    list: async () =>
      (await (await request.get("/api/v1/tickets")).json()).items as {
        id: string;
        subject: string;
        version: number;
      }[],
    message: (id: string, body: string, internal: boolean) =>
      request.post(`/api/v1/tickets/${id}/messages`, { headers, data: { body, internal } }),
    update: (id: string, data: Record<string, unknown>) =>
      request.patch(`/api/v1/tickets/${id}`, { headers, data }),
  };
}

async function submitRequest(page: Page, slug: string, subject: string, opts: { honeypot?: string } = {}) {
  await page.goto(`/p/${slug}`);
  // Bots fill every input; people never see this one (off-screen, skipped by Tab).
  if (opts.honeypot) await page.locator('input[name="website"]').fill(opts.honeypot, { force: true });
  await page.getByLabel("Your name").fill("Casey Customer");
  await page.getByLabel("Email").fill("casey@example.test");
  await page.getByLabel("Subject").fill(subject);
  await page
    .getByLabel("How can we help?")
    .fill("The desktop app says 'Sync paused'.\nRestarting didn't help.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeFocused();
  return page.getByLabel("Your private tracking link").inputValue();
}

test("customer submits, follows and replies; internal notes stay internal", async ({
  page,
  browser,
  baseURL,
}) => {
  const slug = `portal-${Date.now().toString(36)}`;
  await createWorkspace(page, "portal-owner", slug);
  const api = agentApi(page.request, baseURL!);

  // The customer uses a separate browser context: no account, no cookies.
  const customerContext = await browser.newContext();
  await customerContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const customer = await customerContext.newPage();

  // Validation: errors next to each field, focus moves to the first one.
  await customer.goto(`/p/${slug}`);
  await expect(customer).toHaveTitle("Contact Portal Test Co support · SupportPilot");
  // POST, so a script failure can never put personal data in the URL.
  await expect(customer.locator("form")).toHaveAttribute("method", "post");
  await customer.getByRole("button", { name: "Send request" }).click();
  await expect(customer.getByLabel("Your name")).toBeFocused();
  await expect(customer.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
  await expect(customer.getByText("Subject must be at least 3 characters.")).toBeVisible();

  const link = await submitRequest(customer, slug, "Files stopped syncing");
  expect(link).toMatch(TOKEN_URL);
  await customer.getByRole("button", { name: "Copy link" }).click();
  await expect(customer.getByRole("status").filter({ hasText: "Link copied." })).toBeVisible();
  expect(await customer.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // The agent answers publicly and leaves an internal note.
  const [ticket] = await api.list();
  expect(ticket!.subject).toBe("Files stopped syncing");
  expect(
    (await api.message(ticket!.id, "Thanks Casey, which operating system are you on?", false)).status(),
  ).toBe(201);
  expect((await api.message(ticket!.id, "INTERNAL: probably the 4.2 regression", true)).status()).toBe(201);

  // Tracking page: secret-URL protections and the customer's view of the thread.
  const res = await customer.goto(link);
  expect(res!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(res!.headers()["cache-control"]).toContain("no-store");
  await expect(customer.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(customer.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(customer).toHaveTitle("Your support request · SupportPilot");
  await expect(customer.getByRole("heading", { level: 1, name: "Files stopped syncing" })).toBeVisible();
  await expect(customer.getByText("Olivia Owner (support team)")).toBeVisible();
  await expect(customer.getByText("which operating system")).toBeVisible();
  await expect(customer.getByText("INTERNAL")).toHaveCount(0);
  await expect(customer.getByText("casey@example.test")).toHaveCount(0);

  // Reply, then see it in the thread after the refresh.
  await customer.getByRole("button", { name: "Send reply" }).click();
  await expect(customer.getByLabel("Your reply")).toBeFocused();
  await customer.getByLabel("Your reply").fill("Windows 11, version 24H2.");
  await customer.getByRole("button", { name: "Send reply" }).click();
  await expect(customer.getByText("Reply sent.")).toBeVisible();
  await expect(customer.getByRole("listitem").filter({ hasText: "Windows 11, version 24H2." })).toContainText(
    "You",
  );

  // Once closed, replies are turned off.
  const [current] = await api.list();
  expect((await api.update(current!.id, { version: current!.version, status: "closed" })).status()).toBe(200);
  await customer.reload();
  await expect(customer.getByText("This request is closed")).toBeVisible();
  await expect(customer.getByRole("button", { name: "Send reply" })).toHaveCount(0);
  await customerContext.close();
});

test("the honeypot fakes success for bots but saves nothing", async ({ page, browser, baseURL }) => {
  const slug = `honeypot-${Date.now().toString(36)}`;
  await createWorkspace(page, "honeypot-owner", slug);
  const api = agentApi(page.request, baseURL!);

  const bot = await (await browser.newContext()).newPage();
  const link = await submitRequest(bot, slug, "Cheap watches", { honeypot: "https://spam.example" });
  expect(link).toMatch(TOKEN_URL); // indistinguishable from a real success
  expect(await api.list()).toEqual([]);
  expect((await bot.goto(link))!.status()).toBe(404);
});

test("unknown portals and tracking links are 404 without echoing the token", async ({ page }) => {
  expect((await page.goto("/p/no-such-portal-anywhere"))!.status()).toBe(404);
  const token = "B".repeat(43);
  const res = await page.goto(`/t/${token}`);
  expect(res!.status()).toBe(404);
  expect(res!.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  // Not repeated in anything a person sees or a bookmark/history entry stores. (Next.js
  // embeds route params in its page data; that is the same URL the browser already has.)
  expect(await page.locator("body").innerText()).not.toContain(token);
  expect(await page.title()).not.toContain(token);
});
