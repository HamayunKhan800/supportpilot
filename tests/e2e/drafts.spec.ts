import { audit, email, expect, signIn, signUp, test } from "./fixtures";

/**
 * M5 step 4 through the real stack (production build, worker, mock AI): an agent generates a
 * cited draft, opens a source, edits it, rates it and approves it; a question the knowledge
 * base can't answer is refused; an unsent draft survives a reload and can be discarded.
 * Runs on desktop and mobile.
 */

const REFUNDS = `# Billing

## Refunds

Annual plans can be refunded within 30 days of purchase. Refunds reach the original card within 5 business days.
`;

test("an agent drafts, checks, edits and approves an AI reply", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const slug = `drafts-${info.project.name}-${Date.now().toString(36)}`;
  const who = email(`drafts-${info.project.name}`);
  await signUp(page, "Dana Drafter", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Drafts Co");
  await page.getByLabel("Workspace address").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Drafts Co" })).toBeVisible();

  // One help article, processed by the worker.
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
  for (const [subject, message] of [
    ["Refund for annual plan", "Can I get a refund on my annual plan? I bought it last week."],
    ["Football sponsorship", "Do you sponsor amateur football tournaments in Lahore?"],
    ["Refund timing", "How long do refunds take to reach my card?"],
  ]) {
    const res = await customer.post(`/api/v1/portal/${slug}/tickets`, {
      data: { name: "Casey Customer", email: "casey@example.test", subject, message },
    });
    expect(res.status()).toBe(201);
  }
  await customer.dispose();

  // 1. A cited draft streams in.
  await page.goto("/app/tickets/1");
  const panel = page.getByTestId("draft-panel");
  await expect(panel.getByRole("heading", { name: "AI draft" })).toBeVisible();
  await panel.getByRole("button", { name: "Generate draft" }).click();
  const text = panel.getByTestId("draft-text");
  await expect(text).toContainText("Annual plans can be refunded within 30 days of purchase", {
    timeout: 15_000,
  });
  await expect(panel.getByRole("status").first()).toHaveText("Draft ready. Review it before sending.");
  // Checkable facts from the server, never a confidence score.
  const checks = panel.getByRole("list", { name: "Automatic checks" });
  await expect(checks).toContainText("Cites 1 source");
  await expect(checks).toContainText("No unfamiliar links");
  await expect(checks).not.toContainText("%");
  await expect(panel).toContainText(/AI draft\s*· (written by )?mock/);

  // 2. Hovering a citation previews the passage; a click opens it; the preview has no markers.
  const citation = text.getByRole("button", { name: "Source 1: billing refunds" });
  await citation.hover();
  await expect(page.getByText("Click to open the full passage.")).toBeVisible();
  await expect(page.getByText("Click to open the full passage.").locator("..")).toContainText(
    "billing refunds",
  );
  await audit(page, "/app/tickets/{number} (citation preview)");
  await citation.click();
  await expect(citation).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Click to open the full passage.")).toBeHidden(); // a click closes the preview
  await expect(panel.getByRole("listitem").filter({ hasText: "billing refunds" })).toContainText(
    "Refunds reach the original card within 5 business days.",
  );
  await expect(panel.getByTestId("draft-preview")).not.toContainText("[1]");
  await audit(page, "/app/tickets/{number} (draft ready, source open)");

  // 3. Edit (E), rate, approve (A moves focus to the button, Enter sends: never one key).
  await page.mouse.move(0, 0);
  await panel.getByRole("heading", { name: "AI draft" }).click();
  await page.keyboard.press("e");
  const editor = panel.getByLabel("Edit the reply to Casey Customer");
  await expect(editor).toBeFocused();
  await page.keyboard.press("a"); // typing in the editor: no shortcut
  await expect(editor).toHaveValue(/a$/);
  await editor.press("Backspace");
  await editor.fill(`${await editor.inputValue()}\n\nBest wishes, Dana`);
  await panel.getByRole("button", { name: "Done editing" }).click();
  await expect(panel.getByTestId("draft-preview")).toContainText("Best wishes, Dana");
  await panel.getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Thanks for the feedback." })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Helpful", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Finding #90: rating once re-rendered the draft twice (duplicate React keys).
  await expect(panel.getByRole("button", { name: "Approve & send" })).toHaveCount(1);
  await expect(panel.getByTestId("draft-text")).toContainText("Best wishes, Dana");
  await panel.getByRole("heading", { name: "AI draft" }).click();
  await page.keyboard.press("a");
  await expect(panel.getByRole("button", { name: "Approve & send" })).toBeFocused();
  await expect(panel.getByText("Press Enter to send the reply to Casey Customer.")).toBeVisible();
  await expect(panel.getByTestId("draft-outcome")).toHaveCount(0); // focus only, nothing sent yet
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId("draft-outcome")).toContainText("Reply sent to Casey Customer.");
  const thread = page.getByRole("region", { name: "Conversation" });
  const reply = thread.getByRole("listitem").filter({ hasText: "public reply" });
  await expect(reply).toContainText("Annual plans can be refunded within 30 days of purchase");
  await expect(reply).toContainText("Best wishes, Dana");
  await expect(reply).not.toContainText("[1]");

  // 4. Nothing relevant in the knowledge base: refused at once, and can be rated down.
  await page.goto("/app/tickets/2");
  await panel.getByRole("button", { name: "Generate draft" }).click();
  const outcome = panel.getByTestId("draft-outcome");
  await expect(outcome).toContainText("Insufficient knowledge: no reliable sources found.");
  await expect(outcome).toContainText("so no AI call was made");
  await expect(outcome.getByRole("link", { name: "Add a help article" })).toHaveAttribute(
    "href",
    "/app/knowledge",
  );
  await panel.getByRole("button", { name: "Not helpful" }).click();
  await panel.getByLabel("What was wrong? (optional)").selectOption("incomplete");
  await panel.getByRole("button", { name: "Send feedback" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Thanks for the feedback." })).toBeVisible();
  await audit(page, "/app/tickets/{number} (draft refused)");

  // 5. An unsent draft survives a reload; discarding it closes it.
  await page.goto("/app/tickets/3");
  await panel.getByRole("button", { name: "Generate draft" }).click();
  await expect(panel.getByTestId("draft-text")).toContainText("refund", { timeout: 15_000 });
  await page.reload();
  await expect(panel.getByTestId("draft-text")).toContainText("refund");
  // Regenerate (R focuses it, Enter confirms) replaces the draft with a new one.
  await panel.getByRole("heading", { name: "AI draft" }).click();
  await page.keyboard.press("r");
  await expect(panel.getByRole("button", { name: "Regenerate" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status").first()).toHaveText("Draft ready. Review it before sending.", {
    timeout: 15_000,
  });
  await expect(panel.getByTestId("draft-text")).toContainText("refund");
  await panel.getByRole("button", { name: "Discard" }).click();
  await expect(panel.getByTestId("draft-outcome")).toHaveText("Draft discarded.");
  await page.reload();
  await expect(panel.getByRole("button", { name: "Generate draft" })).toBeVisible();

  // The audit log shows who approved AI-written text.
  await page.goto("/app/audit");
  await expect(page.getByRole("cell", { name: "Sent an AI-drafted reply" })).toBeVisible();

  // Dark theme: the full inbox, a ticket thread with a ready draft, its citation preview, the shortcuts.
  await page.context().addCookies([{ name: "sp_theme", value: "dark", url: baseURL! }]);
  await page.goto("/app/tickets");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await audit(page, "/app/tickets (dark, with tickets)");
  await page.goto("/app/tickets/3");
  await panel.getByRole("button", { name: "Generate draft" }).click();
  await expect(panel.getByTestId("draft-text")).toContainText("refund", { timeout: 15_000 });
  await expect(panel.getByRole("status").first()).toHaveText("Draft ready. Review it before sending.");
  await audit(page, "/app/tickets/{number} (dark, draft ready)");
  // Keyboard focus opens the preview too: Shift+Tab from the first source lands on the last marker.
  await panel
    .getByRole("button", { name: /billing refunds/ })
    .last()
    .focus();
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByTestId("draft-text").getByRole("button").last()).toBeFocused();
  await expect(page.getByText("Click to open the full passage.")).toBeVisible();
  await audit(page, "/app/tickets/{number} (dark, citation preview)");
  await panel.getByRole("heading", { name: "AI draft" }).click();
  await expect(page.getByText("Click to open the full passage.")).toBeHidden();
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet.getByRole("heading", { name: "On a ticket" })).toBeVisible();
  await audit(page, "shortcut sheet (dark)");
});
