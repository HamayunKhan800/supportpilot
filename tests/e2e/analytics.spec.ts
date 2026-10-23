import pg from "pg";
import { audit, email, expect, signIn, signUp, test, waitForTriage } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The analytics dashboard (FR-AN1, M6 step 5) through the real stack, on desktop and on a phone:
 * a request sent through the portal and triaged by the worker shows up in the usage numbers,
 * the period switch works without JavaScript-only controls, charts have a table alternative,
 * evaluation runs display with their uncertainty and targets, and both pages pass axe and the
 * strict CSP (the fixture fails any test with a CSP violation).
 *
 * Evaluation runs are shared by the whole database, so this spec adds two of its own, newer
 * than any other, and removes them afterwards.
 */

let db: pg.Client;
const runIds: string[] = [];

const rate = (successes: number, n: number, low: number, high: number) => ({
  successes,
  n,
  rate: successes / n,
  low,
  high,
});

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const insert = async (
    category: ReturnType<typeof rate>,
    minutesAgo: number,
    status: "completed" | "stopped",
  ) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO eval_run (provider, status, dataset_hash, config_hash, config, summary, started_at, finished_at, stop_reason)
       VALUES ('mock', $1, $2, $2, $3, $4, now() + make_interval(mins => $5), $6, $7) RETURNING id`,
      [
        status,
        "e".repeat(64),
        JSON.stringify({ promptVersions: { triage: "triage.v1" }, models: { triage: "mock-llm" } }),
        JSON.stringify({
          items: { triage: 150, retrieval: 110 },
          triage: { category, errors: rate(0, 150, 0, 0.025) },
          retrieval: { recallAt5: rate(99, 110, 0.83, 0.94), mrrAt5: 0.71 },
          injection: { resisted: rate(19, 20, 0.76, 0.99), obeyed: ["D09"] },
        }),
        // In the future, so these are the newest runs whatever else the database holds.
        60 - minutesAgo,
        status === "completed" ? new Date() : null,
        status === "stopped" ? "call budget of 60 reached" : null,
      ],
    );
    runIds.push(rows[0]!.id);
  };
  await insert(rate(120, 150, 0.73, 0.86), 10, "completed");
  await insert(rate(132, 150, 0.82, 0.92), 5, "stopped");
});

test.afterAll(async () => {
  await db.query(`DELETE FROM eval_run WHERE id = ANY($1::uuid[])`, [runIds]);
  await db.end();
});

async function ownerWithOneTriagedRequest(page: Page, project: string) {
  const slug = `analytics-${project}-${Date.now().toString(36)}`;
  const address = email(`analytics-${project}`);
  await signUp(page, "Avery Analyst", address);
  await signIn(page, address);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Analytics Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Analytics Co" })).toBeVisible();

  const customer = await page.context().browser()!.newPage();
  await customer.goto(`/p/${slug}`);
  await customer.getByLabel("Your name").fill("Casey Customer");
  await customer.getByLabel("Email").fill("casey@example.test");
  await customer.getByLabel("Subject").fill("I was charged twice this month");
  await customer.getByLabel("How can we help?").fill("My card shows two charges for the Family plan.");
  await customer.getByRole("button", { name: "Send request" }).click();
  await expect(customer.getByRole("heading", { name: "Request received" })).toBeFocused();
  await customer.close();
  await waitForTriage(page, 1);
}

test("usage: a triaged request appears, periods switch, charts have a table", async ({ page }, info) => {
  await ownerWithOneTriagedRequest(page, info.project.name);

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Analytics" }).getByRole("link", { name: "Usage" }),
  ).toHaveAttribute("aria-current", "page");

  const tickets = page
    .getByRole("heading", { level: 2, name: "Tickets" })
    .locator("xpath=ancestor::*[@data-slot='card']");
  await expect(tickets.getByRole("definition").first()).toHaveText("1"); // Created
  const triage = page
    .getByRole("heading", { level: 2, name: "AI triage" })
    .locator("xpath=ancestor::*[@data-slot='card']");
  await expect(triage.getByRole("definition").first()).toHaveText("1"); // one suggestion
  await expect(page.getByRole("row", { name: /^Triage 1 100%/ })).toBeVisible(); // one call, succeeded

  // The chart is an image with a sentence for screen readers, and its data is a real table.
  await expect(page.getByRole("img", { name: /^Tickets created per day, .*: 1 in total/ })).toBeVisible();
  await audit(page, "analytics usage");

  const period = page.getByRole("navigation", { name: "Period" });
  await expect(period.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "true");
  await period.getByRole("link", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/\/app\/analytics\?days=7$/);
  await expect(period.getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "true");
  await page.getByText("Show as a table").first().click();
  const table = page.getByRole("table", { name: "Tickets created per day" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(8); // header + 7 days
  await audit(page, "analytics usage, 7 days, table open");

  // A made-up period falls back to the default instead of failing.
  await page.goto("/app/analytics?days=365");
  await expect(period.getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "true");
});

test("evaluation: latest run with its range and target, partial-run notice, trend", async ({
  page,
}, info) => {
  await ownerWithOneTriagedRequest(page, `${info.project.name}-eval`);
  await page.goto("/app/analytics/evaluation?provider=mock");
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Latest Mock run/ })).toContainText("Partial");
  await expect(page.getByText("Stopped because: call budget of 60 reached.")).toBeVisible();
  await expect(page.getByText(/scripted stand-in plays the AI/)).toBeVisible();

  const category = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: "Category accuracy" }) });
  await expect(category).toContainText("88%");
  await expect(category).toContainText("95% range 82%–92% · 132 of 150 · target ≥ 85% · met");
  const recall = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: "Recall@5" }) });
  await expect(recall).toContainText("target ≥ 90% · met");
  const injection = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: "Prompt-injection resistance" }) });
  await expect(injection).toContainText("target ≥ 100% · not met");
  await expect(page.getByText("Attacks the model followed: D09.")).toBeVisible();
  // A metric this run didn't measure says so instead of showing 0%.
  const groundedness = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 4, name: "Groundedness" }) });
  await expect(groundedness).toContainText("no data");
  await expect(groundedness).toContainText("AI-graded, not checked against a human");

  await expect(page.getByRole("heading", { level: 2, name: "Trend across runs" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /^Category accuracy by run, oldest first\. .*80%.*88%/ }),
  ).toBeVisible();
  await audit(page, "analytics evaluation");
});
