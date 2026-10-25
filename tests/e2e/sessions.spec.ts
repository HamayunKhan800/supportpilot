import { email, expect, signIn, signUp, test } from "./fixtures";

const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

test("the account page lists signed-in devices and signs one out (M7-05)", async ({ page, browser }) => {
  const who = email("sessions");
  await signUp(page, "Sam Sessions", who);
  await signIn(page, who);
  await page.getByLabel("Workspace name").fill("Session Co");
  await page.getByLabel("Workspace address").fill(`sessions-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Session Co" })).toBeVisible();

  // The same person signs in on a phone too.
  const phoneContext = await browser.newContext({ userAgent: PHONE_UA });
  const phone = await phoneContext.newPage();
  await phone.goto("/sign-in");
  await signIn(phone, who);
  await expect(phone).toHaveURL(/\/app$/);

  await page.goto("/app/account");
  const devices = page.getByRole("list", { name: "Signed-in devices" }).getByRole("listitem");
  await expect(devices).toHaveCount(2);
  await expect(devices.first()).toContainText("This device");
  await expect(devices.nth(1)).toContainText("Chrome on Android");

  await page.getByRole("button", { name: "Sign out Chrome on Android" }).click();
  await page.getByRole("button", { name: "Sign out device" }).click();
  await expect(devices).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Sign out all other devices" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Where you're signed in" })).toBeFocused();

  // The phone's session is gone on the server: its next page load goes to sign-in.
  await phone.goto("/app");
  await expect(phone).toHaveURL(/\/sign-in/);
  await phoneContext.close();
});
