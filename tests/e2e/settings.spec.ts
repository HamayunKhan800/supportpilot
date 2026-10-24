import {
  audit,
  email,
  expect,
  signIn,
  signUp,
  test,
  waitForTriage,
  workspaceNav,
  property,
} from "./fixtures";

/**
 * M5 step 5 through the real stack (production build, worker, mock AI): an owner sees this
 * month's usage, uses up the budget by lowering it to 0, sees drafts stop with a clear message,
 * raises it again and drafts work; categories are edited; every change is in the audit log.
 * Runs on desktop and mobile.
 */

const REFUNDS = `# Billing

## Refunds

Annual plans can be refunded within 30 days of purchase. Refunds reach the original card within 5 business days.
`;

test("an owner manages the AI budget, and drafts stop and resume with it", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const slug = `settings-${info.project.name}-${Date.now().toString(36)}`;
  const who = email(`settings-${info.project.name}`);
  await signUp(page, "Sam Settings", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Settings Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings Co" })).toBeVisible();

  await page.goto("/app/knowledge");
  const main = page.getByRole("main");
  await main
    .getByLabel("File")
    .setInputFiles({ name: "billing-refunds.md", mimeType: "text/markdown", buffer: Buffer.from(REFUNDS) });
  await main.getByRole("button", { name: "Upload" }).click();
  await expect(
    main.getByRole("listitem").filter({ hasText: "billing refunds" }).getByText("Ready"),
  ).toBeVisible({
    timeout: 30_000,
  });

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
  await customer.dispose();
  await waitForTriage(page, 1);

  // 1. Usage: the triage run is counted.
  await page.goto("/app");
  await (await workspaceNav(page)).getByRole("link", { name: "AI settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI settings" })).toBeVisible();
  const usage = page.getByRole("table", { name: "AI calls this month by feature" });
  await expect(
    usage
      .getByRole("row", { name: /Triage/ })
      .getByRole("cell")
      .first(),
  ).toHaveText("1");
  await expect(page.getByTestId("budget-used")).toContainText("of 1,000,000 tokens used");
  await expect(page.getByLabel("Minimum match score")).toHaveAccessibleDescription(/offline demo embedder/);
  await audit(page, "/app/settings");

  // 2. Budget 0: the page says it's used up, and drafts stop with a clear message.
  await expect(page.getByRole("switch", { name: "Use AI for triage and reply drafts" })).toBeChecked();
  const threshold = page.getByLabel("Auto-apply threshold");
  const saved = await threshold.inputValue();
  await threshold.fill(saved === "0.9" ? "0.8" : "0.9");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(threshold).toHaveValue(saved);
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  await page.getByLabel("Monthly token budget").fill("0");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  await expect(page.getByText("The monthly budget is used up")).toBeVisible();
  await expect(page.getByTestId("budget-used")).toContainText("of 0 tokens used");
  await audit(page, "/app/settings (budget used up)");

  await page.goto("/app/tickets/1");
  const panel = page.getByTestId("draft-panel");
  await panel.getByRole("button", { name: "Generate draft" }).click();
  await expect(panel.getByTestId("draft-outcome")).toContainText(
    "This workspace has used its AI budget for this month. An admin can raise it in AI settings.",
  );
  await expect(panel.getByTestId("draft-text")).toHaveCount(0);

  // 3. Raise it again: drafts work.
  await page.goto("/app/settings");
  await page.getByLabel("Monthly token budget").fill("500000");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  await expect(page.getByText("The monthly budget is used up")).toHaveCount(0);

  await page.goto("/app/tickets/1");
  await panel.getByRole("button", { name: /Generate draft|Try again/ }).click();
  await expect(panel.getByTestId("draft-text")).toContainText("Annual plans can be refunded within 30 days", {
    timeout: 15_000,
  });

  // 4. Categories: add one (typed loosely, saved normalised), remove one; agents can use it.
  await page.goto("/app/settings");
  await page.getByLabel("New category").fill("Refund Requests");
  await expect(page.getByText("Will be added as “refund-requests”.")).toBeVisible();
  await page.getByLabel("New category").press("Enter");
  await page.getByRole("button", { name: "Remove feature-request" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  const current = page.getByRole("list", { name: "Current categories" });
  await expect(current.getByRole("listitem").filter({ hasText: "refund-requests" })).toBeVisible();
  await expect(current.getByRole("listitem").filter({ hasText: "feature-request" })).toHaveCount(0);

  await page.goto("/app/tickets/1");
  await property(page, "Category").click();
  await expect(page.getByRole("menuitemradio", { name: "refund-requests", exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // 5. Each change is in the audit log, readably.
  await page.goto("/app/audit");
  const table = page.getByRole("table", { name: "Audit events" });
  await expect(table.getByText("Monthly token budget: 1,000,000 → 0")).toBeVisible();
  await expect(table.getByText("Monthly token budget: 0 → 500,000")).toBeVisible();
  await expect(table.getByText(/^Categories: .*feature-request.* → .*refund-requests/)).toBeVisible();
});
