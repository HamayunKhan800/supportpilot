import { email, expect, PASSWORD, signIn, signUp, test } from "./fixtures";

test("unknown pages get a styled 404 without CSP violations", async ({ page }) => {
  const res = await page.goto("/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("protected pages redirect to sign-in", async ({ page }) => {
  await page.goto("/app/members");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fmembers/);
});

test("a forged session cookie does not grant access", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "better-auth.session_token", value: "forged.value", url: baseURL! }]);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("?next= cannot redirect to another site after sign-in", async ({ page }) => {
  const who = email("redirect");
  await signUp(page, "Redirect Tester", who);
  await page.goto("/sign-in?next=https://evil.example.com/");
  await signIn(page, who);
  await expect(page).toHaveURL(/localhost:\d+\/app/);
});

test("every page is served with a per-request nonce CSP", async ({ request }) => {
  const a = (await request.get("/sign-in")).headers()["content-security-policy"];
  const b = (await request.get("/sign-in")).headers()["content-security-policy"];
  expect(a).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(a).not.toContain("unsafe-inline");
  expect(a).not.toContain("unsafe-eval");
  expect(a).not.toBe(b);
});

test("credential forms post, so a script failure can never put a password in the URL", async ({ page }) => {
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.locator("form")).toHaveAttribute("method", "post");
  }
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@e2e.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Incorrect email or password");
  expect(page.url()).not.toContain("password");
});
