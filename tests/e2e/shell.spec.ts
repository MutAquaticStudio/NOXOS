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

test("keeps disabled modules out of navigation and rejects their direct routes", async ({
  page
}) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Inventory" })).toHaveCount(0);

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Route not registered" })).toBeVisible();
});

test("derives density from the active module UX profile", async ({ page }) => {
  await page.goto("/material-intelligence");
  await expect(page.locator(".nox-os")).toHaveAttribute("data-density", "COMPACT");

  await page.goto("/settings");
  await expect(page.locator(".nox-os")).toHaveAttribute("data-density", "DEFAULT");
});

test("supports Peek and returns focus to the command trigger after Escape", async ({ page }) => {
  await page.goto("/material-intelligence");
  const peek = page.getByRole("button", { name: "Peek current context" });
  await peek.click();
  await expect(page.getByRole("region", { name: "Peek current context" })).toBeVisible();

  const commandTrigger = page.getByRole("button", {
    name: "Search NØX-OS or run a command…"
  });
  await commandTrigger.click();
  await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command Center" })).toHaveCount(0);
  await expect(commandTrigger).toBeFocused();
});

test("applies system dark and light tokens and keeps the mobile shell responsive", async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/material-intelligence");
  await expect(page.locator(".nox-os")).toHaveCSS("--canvas", "#07080a");

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator(".nox-os")).toHaveCSS("--canvas", "#f5f6f7");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".nox-inspector")).toBeHidden();
  await expect(page.locator(".nox-app-rail")).toHaveCSS("position", "fixed");
  await expect(page.getByRole("navigation", { name: "Application modules" })).toBeVisible();
});
