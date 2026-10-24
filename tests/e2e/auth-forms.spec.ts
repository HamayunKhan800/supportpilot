import { expect, test } from "./fixtures";

/**
 * Sign-in and sign-up help (design step 9.4): show/hide password, a Caps Lock notice, a length
 * meter against the real minimum, errors shown when leaving a field, and the live demo beside the
 * form on wide screens. The account flows themselves are covered by auth.spec.ts.
 */

test("the password can be shown and hidden", async ({ page }) => {
  await page.goto("/sign-in");
  const password = page.getByLabel("Password");
  await password.fill("correct horse battery");
  await expect(password).toHaveAttribute("type", "password");
  const toggle = page.getByRole("button", { name: /^(Show|Hide)$/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveText("Hide");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "password");
});

test("a Caps Lock notice appears while typing with Caps Lock on", async ({ page }) => {
  await page.goto("/sign-in");
  const password = page.getByLabel("Password");
  await password.focus();
  // Chromium reads the Caps Lock state from the event (modifierCapsLock is its event-init flag).
  await password.dispatchEvent("keydown", { key: "A", modifierCapsLock: true });
  await expect(page.getByText("Caps Lock is on.")).toBeVisible();
  await expect(password).toHaveAccessibleDescription(/Caps Lock is on\./);
  await password.dispatchEvent("keydown", { key: "a", modifierCapsLock: false });
  await expect(page.getByText("Caps Lock is on.")).toBeHidden();
});

test("sign-up checks fields when they are left, and measures the password length", async ({ page }) => {
  await page.goto("/sign-up");
  const email = page.getByLabel("Email");
  await email.fill("not-an-email");
  await email.press("Tab");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await email.fill("ana@example.test");
  await expect(page.getByText("Enter a valid email address.")).toBeHidden();

  const password = page.getByLabel("Password");
  await password.fill("short pass");
  await expect(page.getByText("10 of 15 characters")).toBeVisible();
  await password.press("Tab");
  await expect(page.getByText("Use at least 15 characters.")).toBeVisible();
  await password.fill("a much longer passphrase");
  await expect(page.getByText("Long enough")).toBeVisible();
  await expect(page.getByText("Use at least 15 characters.")).toBeHidden();
});

test("wide screens show the live demo beside the form", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const aside = page.getByRole("complementary", { name: "About SupportPilot" });
  await expect(
    aside.getByRole("group", { name: /^Interactive demo of the SupportPilot inbox/ }),
  ).toBeVisible();
  // The form comes first for the keyboard: the demo is after it.
  await page.getByLabel("Email").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});
