import { execFileSync } from "node:child_process";
import pg from "pg";
import { audit, email, expect, signIn, signUp, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The evaluation Review page (M6 D2) through the real stack, on desktop and on a phone: a
 * listed reviewer finds it in the navigation, answers items with one tap each, and their
 * answers and progress persist; anyone else gets a 404 and no link.
 *
 * Reviewers are named in playwright.config.ts (EVAL_REVIEWER_EMAILS). Verdicts live in one
 * table shared by the whole database, so this spec refuses to run against a database that
 * holds anyone else's real review, and removes its own answers afterwards.
 */

const reviewerEmail = (project: string) => `reviewer-${project}@e2e.test`;
let db: pg.Client;

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM eval_review_item r LEFT JOIN "user" u ON u.id = r.reviewed_by
     WHERE r.verdict IS NOT NULL AND (u.email IS NULL OR u.email NOT LIKE 'reviewer-%@e2e.test')`,
  );
  test.skip(Number(rows[0]!.n) > 0, "this database holds a real review; run E2E against a fresh database");
  execFileSync("pnpm", ["-s", "eval:review", "load"], { stdio: "pipe", env: process.env });
});

test.afterAll(async () => {
  await db.query(
    `UPDATE eval_review_item SET verdict = NULL, note = NULL, reviewed_by = NULL, reviewed_at = NULL
     WHERE reviewed_by IN (SELECT id FROM "user" WHERE email LIKE 'reviewer-%@e2e.test')`,
  );
  await db.end();
});

/** Signs in, creating the account (and a workspace) the first time this reviewer is used. */
async function signInReviewer(page: Page, address: string, project: string) {
  const { rowCount } = await db.query(`SELECT 1 FROM "user" WHERE email = $1`, [address]);
  if (rowCount) await page.goto("/sign-in");
  else await signUp(page, "Riley Reviewer", address);
  await signIn(page, address);
  await expect(page).toHaveURL(/\/app/);
  if (page.url().includes("/app/onboarding")) {
    await page.getByLabel("Workspace name").fill("Review Co");
    await page.getByLabel("Workspace address").fill(`review-${project}-${Date.now().toString(36)}`);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Review Co" })).toBeVisible();
  }
}

test("a listed reviewer checks items with one tap each", async ({ page }, info) => {
  await signInReviewer(page, reviewerEmail(info.project.name), info.project.name);

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Triage labels" })).toBeVisible();
  await audit(page, "review overview");

  await page.getByRole("link", { name: "Start: Help-centre questions" }).click();
  await expect(page).toHaveURL(/\/app\/review\/retrieval-labels$/);
  await expect(page.getByTestId("review-position")).toHaveText("Item 1 of 22 · 0 of 22 checked");
  await expect(
    page.getByRole("heading", { level: 2, name: "How long does a new password have to be?" }),
  ).toBeVisible();
  await expect(page.getByText("At least 12 characters.")).toBeVisible(); // the reference answer
  await audit(page, "review item");

  await page.getByRole("button", { name: "Yes, correct" }).click();
  await expect(page).toHaveURL(/item=q010/);
  await expect(page.getByTestId("review-position")).toHaveText("Item 2 of 22 · 1 of 22 checked");

  await page.getByLabel(/Note/).fill("The passage is fine, but the question sounds made up.");
  await page.getByRole("button", { name: "No, something's wrong" }).click();
  await expect(page).toHaveURL(/item=q015/);
  await expect(page.getByTestId("review-position")).toHaveText("Item 3 of 22 · 2 of 22 checked");

  // Answers persist and can be revisited.
  await page.getByRole("link", { name: "← Previous" }).click();
  await expect(page.getByTestId("current-verdict")).toHaveText("Your answer: ❌ No, something's wrong");
  await expect(page.getByLabel(/Note/)).toHaveValue("The passage is fine, but the question sounds made up.");
  await expect(page.getByRole("button", { name: "No, something's wrong" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("link", { name: "← All reviews" }).click();
  await expect(page.getByText("2 of 22 checked · 1 marked correct")).toBeVisible();
});

test("anyone else gets no link and a 404", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "access rules don't depend on the screen size");
  const who = email("not-a-reviewer");
  await signUp(page, "Nora Notreviewer", who);
  await signIn(page, who);
  await page.getByLabel("Workspace name").fill("Other Co");
  await page.getByLabel("Workspace address").fill(`other-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Other Co" })).toBeVisible();

  await expect(
    page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Review" }),
  ).toHaveCount(0);
  const res = await page.goto("/app/review");
  expect(res?.status()).toBe(404);
  const api = await page.request.post(
    "/api/internal/review/items/00000000-0000-4000-8000-000000000000/verdict",
    {
      headers: { origin: new URL(page.url()).origin },
      data: { contentHash: "a".repeat(64), verdict: "agree" },
    },
  );
  expect(api.status()).toBe(404);
});
