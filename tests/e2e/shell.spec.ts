import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("loads a registry-derived deep link with an accessible foundation shell", async ({ page }) => {
  await page.goto("/material-intelligence");

  await expect(page.getByRole("heading", { name: "Material Intelligence" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Application modules" })).toBeVisible();
  await expect(page.getByRole("button", { name: /NØX Assist/ })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("opens the command center with a keyboard shortcut", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");

  await expect(page.getByRole("dialog", { name: "Command Center" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();
});
