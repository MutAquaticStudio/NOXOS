import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("keeps protected module routes behind the session boundary", async ({ page }) => {
  await page.goto("/materials");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Application modules" })).toHaveCount(0);
  await expect(page.getByText("Material Intelligence")).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("uses the configured email-password flow without revealing protected shell content", async ({
  page
}) => {
  await page.route("**/auth/v1/token**", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "invalid_grant" })
    });
  });
  await page.goto("/sign-in");

  await page.getByLabel("Email").fill("g2-test@example.test");
  await page.getByLabel("Password").fill("not-a-real-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toHaveText("Sign-in could not be completed.");
  await expect(page.getByRole("navigation", { name: "Application modules" })).toHaveCount(0);
});
