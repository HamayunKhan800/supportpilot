import { buildPdf } from "../support/pdf";
import { email, expect, signIn, signUp, test } from "./fixtures";

/**
 * FR-K1–K4 through the UI, with the real worker processing uploads (mock AI provider):
 * upload → ready (the page updates by itself) → passages → test search → delete → gone.
 */
const REFUNDS = `# Billing

## Refunds

Refunds are paid back to the original card within 5 business days of approval.
Annual plans can be refunded within 30 days of purchase.
`;

const md = (name: string, text: string) => ({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });

test("an owner adds, checks, searches and deletes a help article", async ({ page }) => {
  const who = email("kb-owner");
  await signUp(page, "Kim Knowledge", who);
  await signIn(page, who);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Knowledge Co");
  await page.getByLabel("Workspace address").fill(`kb-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();

  // Overview → Knowledge base.
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Knowledge base" })).toBeVisible();
  await main.getByRole("link", { name: "Add your first document" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge base" })).toBeVisible();
  await expect(main.getByText("No documents yet.")).toBeVisible();
  // Plan D14: synthetic data only on the public demo.
  await expect(main.getByText("Demo: do not upload confidential or personal documents.")).toBeVisible();

  // Nothing chosen: the field explains, and gets focus.
  await main.getByRole("button", { name: "Upload" }).click();
  await expect(main.getByLabel("File")).toBeFocused();
  await expect(main.getByText("Choose a file to upload.")).toBeVisible();

  // Upload. The list shows it and, without reloading, it becomes Ready.
  await main.getByLabel("File").setInputFiles(md("billing-refunds.md", REFUNDS));
  await main.getByRole("button", { name: "Upload" }).click();
  await expect(main.getByRole("status").filter({ hasText: "Uploaded “billing refunds”" })).toBeVisible();
  const row = main.getByRole("listitem").filter({ hasText: "billing refunds" });
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("1 passage");
  await expect(main.getByText("1 of 100 documents")).toBeVisible();

  // The same file again: refused, with a way to the existing document.
  await main.getByLabel("File").setInputFiles(md("copy.md", REFUNDS));
  await main.getByRole("button", { name: "Upload" }).click();
  const alert = main.getByRole("alert");
  await expect(alert).toContainText("already");
  await expect(alert).toBeFocused();
  await expect(main.getByRole("link", { name: "Open the existing document" })).toBeVisible();

  // A text file renamed .pdf: the server's reason is shown as is.
  await main.getByLabel("File").setInputFiles(md("renamed.pdf", "just text"));
  await main.getByRole("button", { name: "Upload" }).click();
  await expect(main.getByRole("alert")).toContainText("don't match its extension");

  // Document page: details and the passages exactly as indexed.
  await row.getByRole("link", { name: "billing refunds" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "billing refunds" })).toBeVisible();
  await expect(main.getByRole("heading", { name: /Passages/ })).toContainText("(1)");
  await expect(main.getByText("Billing › Refunds")).toBeVisible();
  await expect(main.getByText("within 5 business days of approval")).toBeVisible();

  // Test search finds it by meaning and by keywords.
  await page.goto("/app/knowledge");
  await main.getByRole("link", { name: "Test search" }).click();
  await main.getByLabel("Question").fill("How long do refunds take?");
  await main.getByRole("button", { name: "Search" }).click();
  const results = main.getByRole("heading", { name: /passage.* for “How long do refunds take\?”/ });
  await expect(results).toBeFocused();
  const first = main.getByRole("listitem").first();
  await expect(first.getByRole("link", { name: "billing refunds" })).toBeVisible();
  await expect(first.getByText(/^Meaning #1/)).toBeVisible();
  await expect(first.getByText(/^Keywords #1/)).toBeVisible();
  // The best score is shown against the refusal floor drafts use (the mock embedder's own floor here),
  // and the question's words are highlighted in the passage.
  await expect(main.getByText(/^Best similarity \d\.\d\d is at or above the offline floor/)).toBeVisible();
  await expect(first.getByText(/≥ floor 0\.15$/)).toBeVisible();
  await expect(first.locator("mark").first()).toHaveText(/^refunds?$/i);

  // Delete, keyboard only: the dialog opens on Cancel, Cancel returns focus, then confirm.
  await first.getByRole("link", { name: "billing refunds" }).click();
  const del = main.getByRole("button", { name: "Delete document" });
  await del.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Delete “billing refunds”?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(del).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Delete document" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/app\/knowledge\?deleted=1$/);
  await expect(main.getByRole("status").filter({ hasText: "Document deleted." })).toBeVisible();
  await expect(main.getByText("No documents yet.")).toBeVisible();

  // Gone from search too, and both changes are in the audit log.
  await page.goto("/app/knowledge/search");
  await main.getByLabel("Question").fill("refunds");
  await main.getByRole("button", { name: "Search" }).click();
  await expect(main.getByText("There are no processed documents to search yet.")).toBeVisible();
  await page.goto("/app/audit");
  await expect(main.getByText("Uploaded a knowledge document")).toBeVisible();
  await expect(main.getByText("Deleted a knowledge document")).toBeVisible();
});

test("a document that fails shows why, and can be retried", async ({ page }) => {
  const who = email("kb-failed");
  await signUp(page, "Fay Failure", who);
  await signIn(page, who);
  await page.getByLabel("Workspace name").fill("Failure Co");
  await page.getByLabel("Workspace address").fill(`kb-fail-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  // Wait until the workspace exists and is active: navigating away sooner raced its creation and
  // landed on onboarding (finding #112).
  await expect(page.getByRole("heading", { level: 1, name: "Failure Co" })).toBeVisible();
  await page.goto("/app/knowledge");

  const main = page.getByRole("main");
  await main.getByLabel("File").setInputFiles({
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: buildPdf({ userPassword: "secret" }),
  });
  await main.getByRole("button", { name: "Upload" }).click();
  const row = main.getByRole("listitem").filter({ hasText: "locked" });
  await expect(row.getByText("Failed")).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("password-protected");

  await row.getByRole("link", { name: "locked" }).click();
  await expect(main.getByText("This document could not be processed.")).toBeVisible();
  const retry = main.getByRole("button", { name: "Retry processing" });
  await retry.click();
  await expect(main.getByRole("button", { name: "Retrying…" })).toHaveCount(0);
  await expect(main.getByRole("alert")).toHaveCount(0);
  // Same file, same problem: it fails again, and the page follows along without a reload.
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText("Remove the password and upload it again.")).toBeVisible();
  // The retry really happened (not just the old status still on screen).
  await page.goto("/app/audit");
  await expect(main.getByText("Retried a knowledge document")).toBeVisible();
});
