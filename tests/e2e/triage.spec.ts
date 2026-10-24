import { audit, email, expect, signIn, signUp, test, waitForTriage } from "./fixtures";

/**
 * M5 step 2 through the real stack: the portal queues triage, the worker (mock model) labels
 * the ticket, and the agent sees the result, filters "Needs review" and accepts a suggestion.
 * Mock model: two keyword hits → 97% (applied at the default 0.95), none → 40% (needs review).
 */
test("AI triage labels new requests and agents review its suggestions", async ({
  page,
  playwright,
  baseURL,
}) => {
  const slug = `triage-${Date.now().toString(36)}`;
  const address = email("triage-owner");
  await signUp(page, "Olivia Owner", address);
  await signIn(page, address);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Triage Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Triage Co" })).toBeVisible();

  const customer = await playwright.request.newContext({ baseURL });
  for (const [subject, message] of [
    ["Charged twice", "I was charged twice this month, please refund the extra payment."],
    ["A quick question", "Hello there, I have a question about your company."],
  ]) {
    const res = await customer.post(`/api/v1/portal/${slug}/tickets`, {
      data: { name: "Casey Customer", email: "casey@example.test", subject, message },
    });
    expect(res.status()).toBe(201);
  }
  await customer.dispose();
  await waitForTriage(page, 2);

  // Inbox: the unsure one is marked, and the filter finds only it.
  await page.goto("/app/tickets");
  const results = page.getByRole("region", { name: "Results" }).getByRole("listitem");
  await expect(results).toHaveCount(2);
  await expect(results.filter({ hasText: "A quick question" })).toContainText("Needs review");
  await expect(results.filter({ hasText: "Charged twice" })).not.toContainText("Needs review");
  await expect(results.filter({ hasText: "Charged twice" })).toContainText("billing");
  const quick = page.getByRole("navigation", { name: "Quick filters" });
  await quick.getByRole("link", { name: "Needs review" }).click();
  await expect(page).toHaveURL(/needsReview=true/);
  await expect(quick.getByRole("link", { name: "Needs review" })).toHaveAttribute("aria-current", "true");
  await expect(results).toHaveCount(1);
  await audit(page, "/app/tickets (needs review)");

  // The confident ticket was labelled automatically.
  await page.goto("/app/tickets/1");
  const card = page.getByTestId("triage-card");
  await expect(card.getByRole("heading", { name: "AI triage" })).toBeVisible();
  await expect(card).toContainText("Applied automatically: category and priority.");
  await expect(card).toContainText("97%");
  await expect(page.getByLabel("Category")).toHaveValue("billing");
  await expect(page.getByLabel("Priority")).toHaveValue("high");

  // The unsure one waits for a person; accepting applies it as this agent.
  await page.goto("/app/tickets/2");
  await expect(card).toContainText("Needs review");
  await expect(card).toContainText("40%");
  await expect(card).toContainText("confidence is below 95%");
  await expect(page.getByLabel("Category")).toHaveValue("");
  await audit(page, "/app/tickets/{number} (triage card)");
  await card.getByRole("button", { name: "Accept suggestion" }).click();
  await expect(card).toContainText("Reviewed");
  await expect(card.getByRole("button", { name: "Accept suggestion" })).toHaveCount(0);
  await expect(page.getByLabel("Category")).toHaveValue("other");

  // Nothing left to review; the audit log tells AI changes and the agent's apart.
  await page.goto("/app/tickets?needsReview=true");
  await expect(page.getByText("No tickets match these filters.")).toBeVisible();
  await page.goto("/app/audit");
  await expect(page.getByRole("cell", { name: "AI triage" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /accepted AI suggestion/ }).first()).toBeVisible();
});
