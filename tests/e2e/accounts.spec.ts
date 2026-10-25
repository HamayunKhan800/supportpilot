import type { APIRequestContext, Page } from "@playwright/test";
import { OUTBOX_TOKEN } from "../../playwright.accounts.config";
import { audit, email, expect, PASSWORD, test } from "./fixtures";

/**
 * Account emails in a real browser (docs/plans/accounts-and-email.md), against a server with
 * email on: messages land in the in-memory outbox, read back through /api/dev/email-outbox.
 */

const NEW_PASSWORD = "a brand new passphrase for the e2e run";

async function lastEmail(request: APIRequestContext, to: string, subject: RegExp) {
  let found: { subject: string; text: string } | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/dev/email-outbox?to=${encodeURIComponent(to)}`, {
          headers: { "x-outbox-token": OUTBOX_TOKEN },
        });
        const { messages } = (await res.json()) as { messages: { subject: string; text: string }[] };
        found = messages.find((m) => subject.test(m.subject));
        return Boolean(found);
      },
      { message: `an email to ${to} matching ${subject}` },
    )
    .toBe(true);
  return found!;
}

const codeIn = (text: string) => text.match(/\b(\d{6})\b/)![1]!;

async function signUpWithCode(page: Page, request: APIRequestContext, address: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Accounts Tester");
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const mail = await lastEmail(request, address, /verification code$/);
  await page.getByLabel("Verification code").fill(codeIn(mail.text));
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=email-verified/);
  await expect(page.getByRole("main").getByRole("status")).toContainText("Email confirmed");
}

async function signIn(page: Page, address: string, password: string) {
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("the outbox route is hidden without its token", async ({ request }) => {
  expect((await request.get("/api/dev/email-outbox")).status()).toBe(404);
  const wrong = await request.get("/api/dev/email-outbox", { headers: { "x-outbox-token": "wrong" } });
  expect(wrong.status()).toBe(404);
});

test("sign up, confirm the email with a code, then sign in", async ({ page, request }, info) => {
  const address = email(`verify-${info.project.name}`);
  await signUpWithCode(page, request, address);
  await audit(page, "sign-in after verifying");
  await signIn(page, address, PASSWORD);
  await expect(page).toHaveURL(/\/app/);
});

test("an unconfirmed account is sent to the code page when it signs in", async ({ page, request }, info) => {
  const address = email(`unverified-${info.project.name}`);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Not Yet");
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?/);
  await audit(page, "verify email");
  // A wrong code is explained, not silently ignored.
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify email" }).click();
  const signUpCode = codeIn((await lastEmail(request, address, /verification code$/)).text);
  if (signUpCode !== "000000") await expect(page.getByRole("main").getByRole("alert")).toContainText("code");
  // The resend link waits out its cooldown.
  await expect(page.getByText(/send a new code in \d+ s/)).toBeVisible();

  await page.goto("/sign-in");
  await signIn(page, address, PASSWORD);
  await expect(page).toHaveURL(/\/verify-email\?.*from=sign-in/);
  await expect(page.getByText("Confirm your email address to sign in.")).toBeVisible();
});

test("forgot password: email link, new password typed twice, then sign in", async ({
  page,
  request,
}, info) => {
  const address = email(`reset-${info.project.name}`);
  await signUpWithCode(page, request, address);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await audit(page, "forgot password");
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const mail = await lastEmail(request, address, /^Reset your SupportPilot password$/);
  const link = mail.text.match(/http\S+\/api\/auth\/reset-password\/\S+/)![0];
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await audit(page, "reset password");

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(`${NEW_PASSWORD}x`);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("The passwords don't match.")).toBeVisible();
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=password-reset/);
  await expect(page.getByRole("main").getByRole("status")).toContainText("Password changed");
  await lastEmail(request, address, /password was changed$/);

  await signIn(page, address, PASSWORD);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Incorrect email or password");
  await signIn(page, address, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/app/);

  // The same link is spent.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
});

test("Google and GitHub buttons start the provider sign-in", async ({ page }) => {
  // Stop at the provider: answer its address locally instead of leaving the test.
  await page.route(/^https:\/\/(accounts\.google\.com|github\.com)\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "provider page" }),
  );
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  await audit(page, "sign-in with providers");
  await page.emulateMedia({ colorScheme: "dark" });
  await audit(page, "sign-in with providers (dark)");

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL(/accounts\.google\.com/);
  const url = new URL(page.url());
  expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(["email", "openid", "profile"]);
  expect(url.searchParams.get("client_id")).toBe("e2e-google-client-id");
});

test("a provider error comes back as a fixed message", async ({ page }) => {
  await page.goto("/sign-in?error=account_not_linked");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "An account with this email already exists",
  );
  await page.goto("/sign-in?error=%3Cb%3Ecall%20555%3C%2Fb%3E");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("That sign-in didn't work");
  await expect(page.getByText("555")).toHaveCount(0);
});
