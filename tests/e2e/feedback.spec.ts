import type { APIRequestContext, Page } from "@playwright/test";
import {
  appShell,
  email,
  expect,
  signIn,
  signUp,
  test,
  waitForTriage,
  workspaceNav,
  property,
  propertyValue,
  setProperty,
} from "./fixtures";

/**
 * Design step 8: feedback, loading states and motion (docs/plans/feedback-and-motion.md).
 * 8.1: a page change that takes a while shows the top progress bar, which goes away once the
 * new page lands. The server is slowed on purpose so the wait is long enough to see.
 */

async function ownerWorkspace(page: Page, who: string): Promise<string> {
  await signUp(page, "Fay Feedback", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Feedback Co");
  const slug = `feedback-${Date.now().toString(36)}-${test.info().project.name}`;
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(appShell(page)).toBeVisible();
  return slug;
}

/** A customer request through the public portal API, then wait for the worker's triage. */
async function oneTicket(page: Page, customer: APIRequestContext, slug: string) {
  const res = await customer.post(`/api/v1/portal/${slug}/tickets`, {
    data: {
      name: "Casey Customer",
      email: "casey@example.test",
      subject: "Invoice shows the wrong plan",
      message: "My October invoice says Team, but I'm on Starter.",
    },
  });
  expect(res.status()).toBe(201);
  await waitForTriage(page, 1);
}

/** Delay Next.js page-data requests (they carry the `rsc` header) to simulate a slow network. */
async function slowPageChanges(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

const bar = (page: Page) => page.locator("[data-nav-progress]");
const skeleton = (page: Page) => page.locator(".route-skeleton[data-show]");
const barOpacity = (page: Page) => bar(page).evaluate((el) => Number(getComputedStyle(el).opacity));

test("a slow page change shows the top progress bar until the new page lands", async ({ page }) => {
  await ownerWorkspace(page, email("feedback-nav"));
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
  expect(await barOpacity(page)).toBe(0);

  await slowPageChanges(page, 1500);
  const nav = await workspaceNav(page);
  await nav.getByRole("link", { name: "Knowledge" }).click();

  await expect(bar(page)).toHaveAttribute("data-nav-progress", "loading");
  await expect.poll(() => barOpacity(page)).toBeGreaterThan(0.5);
  // Design step 12: after 300 ms a skeleton of the page being opened covers the old one, and the
  // main area is marked busy.
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
  await expect(skeleton(page)).toBeVisible();
  await expect.poll(() => skeleton(page).evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  await expect(page).toHaveURL(/\/app\/knowledge$/);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge base" })).toBeVisible();
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
  expect(await barOpacity(page)).toBe(0);
  await expect(skeleton(page)).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute("aria-busy");
});

test.describe("design step 12: selection and loading feedback", () => {
  const indicatorOver = async (page: Page, container: string, item: ReturnType<Page["locator"]>) => {
    const ind = page.locator(`${container} > .sliding-indicator`).first();
    await expect(ind).not.toHaveAttribute("data-hidden");
    // Wait out the 220 ms slide, then compare boxes.
    await expect
      .poll(async () => {
        const [a, b] = [await ind.boundingBox(), await item.boundingBox()];
        return a && b ? Math.abs(a.x - b.x) + Math.abs(a.width - b.width) : Infinity;
      })
      .toBeLessThan(2);
  };

  test("the sidebar highlight moves to the tapped page at once", async ({ page, isMobile }) => {
    test.skip(isMobile, "phones use the navigation drawer, which closes on a tap");
    await ownerWorkspace(page, email("feedback-slide"));
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await indicatorOver(
      page,
      'nav[aria-label="Workspace"] > div',
      nav.getByRole("link", { name: "Overview" }),
    );
    await slowPageChanges(page, 1500);
    const knowledge = nav.getByRole("link", { name: "Knowledge" });
    await knowledge.click();
    // Before the page has loaded, the highlight is already on the tapped item.
    await indicatorOver(page, 'nav[aria-label="Workspace"] > div', knowledge);
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("heading", { level: 1, name: "Knowledge base" })).toBeVisible();
    await expect(knowledge).toHaveAttribute("aria-current", "page");
    await indicatorOver(page, 'nav[aria-label="Workspace"] > div', knowledge);
  });

  test("a status tab slides and dims the old results; opening a ticket marks the page busy", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const slug = await ownerWorkspace(page, email("feedback-rows"));
    const customer = await playwright.request.newContext({ baseURL });
    await oneTicket(page, customer, slug);
    await page.goto("/app/tickets");
    const tabs = page.getByRole("navigation", { name: "Ticket status" });
    await indicatorOver(page, 'nav[aria-label="Ticket status"]', tabs.getByRole("link", { name: /^Active/ }));

    await slowPageChanges(page, 1500);
    // Same page, new query: the highlight slides at once, the results dim, the tabs do not.
    const openTab = tabs.getByRole("link", { name: /^Open/ });
    await openTab.click();
    await indicatorOver(page, 'nav[aria-label="Ticket status"]', openTab);
    await expect(page.locator("main")).toHaveAttribute("data-route-busy", "data");
    const results = page.locator('section[aria-labelledby="results-heading"]');
    await expect.poll(() => results.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.7);
    expect(await tabs.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    await expect(page).toHaveURL(/view=open/);
    await expect(openTab).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main")).not.toHaveAttribute("data-route-busy");
    await expect.poll(() => results.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);

    // Opening a ticket: the page is marked busy (no extra line on the row) until the ticket lands.
    const row = results.getByRole("listitem").first();
    await row.getByRole("link").click();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
    await expect(page).toHaveURL(/\/app\/tickets\/1/);
    await expect(page.locator("main")).not.toHaveAttribute("aria-busy");
  });
});

test("page changes from the command palette show the bar too", async ({ page, isMobile }) => {
  test.skip(isMobile, "the palette's keyboard shortcut is a desktop feature");
  await ownerWorkspace(page, email("feedback-palette"));
  await slowPageChanges(page, 1500);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search or jump to" }).fill("Members");
  await page.keyboard.press("Enter");

  await expect(bar(page)).toHaveAttribute("data-nav-progress", "loading");
  await expect(page).toHaveURL(/\/app\/members$/);
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
});

test("a search that stays on the page does not look like a page change", async ({ page }) => {
  await ownerWorkspace(page, email("feedback-search"));
  await page.goto("/app/knowledge/search");
  const main = page.getByRole("main");
  await main.getByLabel("Question", { exact: true }).fill("How do refunds work?");
  await main.getByRole("button", { name: "Search" }).click();
  await page.waitForTimeout(500);
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
  await expect(page.locator("main")).not.toHaveAttribute("data-route-busy");
});

test("tapping a link to the page already open shows nothing", async ({ page }) => {
  await ownerWorkspace(page, email("feedback-same"));
  await slowPageChanges(page, 1500);
  const nav = await workspaceNav(page);
  await nav.getByRole("link", { name: "Overview" }).click();
  await page.waitForTimeout(400);
  await expect(bar(page)).toHaveAttribute("data-nav-progress", "idle");
});

test.describe("8.2 and 8.3: instant ticket details with toasts", () => {
  test("a change saves at once, says so, and can be undone", async ({ page, playwright, baseURL }) => {
    const slug = await ownerWorkspace(page, email("feedback-undo"));
    const customer = await playwright.request.newContext({ baseURL });
    await oneTicket(page, customer, slug);
    await page.goto("/app/tickets/1");

    const priority = property(page, "Priority");
    const before = await propertyValue(page, "Priority");
    const target = before === "Urgent" ? "Low" : "Urgent";
    await setProperty(page, "Priority", target);
    const toast = page.getByText(/^Priority changed to/);
    await expect(toast).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    // The saved value survives a reload: it really reached the server.
    await page.reload();
    await expect(priority).toHaveAccessibleName(`Priority ${target}`);

    await setProperty(page, "Priority", before);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Change undone")).toBeVisible();
    await expect(priority).toHaveAccessibleName(`Priority ${target}`);
    await page.reload();
    await expect(priority).toHaveAccessibleName(`Priority ${target}`);
    await customer.dispose();
  });

  test("a change the server refuses is put back and explained", async ({ page, playwright, baseURL }) => {
    const slug = await ownerWorkspace(page, email("feedback-rollback"));
    const customer = await playwright.request.newContext({ baseURL });
    await oneTicket(page, customer, slug);
    await page.goto("/app/tickets/1");

    const priority = property(page, "Priority");
    const before = await propertyValue(page, "Priority");
    await page.route("**/api/v1/tickets/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 500,
            contentType: "application/problem+json",
            body: JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500 }),
          })
        : route.continue(),
    );
    await setProperty(page, "Priority", before === "Urgent" ? "Low" : "Urgent");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Something went wrong on our side");
    await expect(priority).toHaveAccessibleName(`Priority ${before}`);
    await customer.dispose();
  });
});

test("8.4: a new request appears in an open inbox without reloading", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const slug = await ownerWorkspace(page, email("feedback-live"));
  const customer = await playwright.request.newContext({ baseURL });
  await oneTicket(page, customer, slug);
  await page.goto("/app/tickets");
  const rows = page
    .getByRole("main")
    .getByRole("link", { name: /Invoice shows the wrong plan|Export stuck at 99%/ });
  await expect(rows).toHaveCount(1);

  const res = await customer.post(`/api/v1/portal/${slug}/tickets`, {
    data: {
      name: "Casey Customer",
      email: "casey@example.test",
      subject: "Export stuck at 99%",
      message: "The CSV export never finishes.",
    },
  });
  expect(res.status()).toBe(201);

  // The page checks every 15 s while visible: the row and a quiet notice arrive by themselves.
  await expect(page.getByText("New ticket #2")).toBeVisible({ timeout: 30_000 });
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/tickets\/2$/);
  await customer.dispose();
});

test("8.6: losing the connection is announced, and so is getting it back", async ({ page, context }) => {
  await ownerWorkspace(page, email("feedback-offline"));
  await expect(page.getByText(/You're offline|Back online/)).toHaveCount(0);

  await context.setOffline(true);
  await expect(
    page.getByText("You're offline. Changes can't be saved until the connection is back."),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Back online.")).toBeVisible();
  await expect(page.getByText("Back online.")).toBeHidden({ timeout: 6000 });
});
