import { chromium } from "@playwright/test";

const stagingUrl = process.env.NOX_STAGING_URL;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const expectedEnvironment = process.env.NOX_EXPECTED_ENV ?? "staging";

if (!stagingUrl || !expectedSha) {
  throw new Error("NOX_STAGING_URL and EXPECTED_SOURCE_SHA are required for browser verification.");
}

const requiredVisible = async (locator, description) => {
  if (!(await locator.isVisible())) {
    throw new Error("Staging browser acceptance failed: " + description);
  }
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(stagingUrl, { waitUntil: "networkidle" });

  await requiredVisible(page.locator(".nox-system-bar"), "System Bar is missing");
  await requiredVisible(
    page.getByRole("navigation", { name: "Application modules" }),
    "App Rail is missing"
  );
  await requiredVisible(page.locator(".nox-workspace-tabs"), "Workspace Tabs are missing");
  await requiredVisible(page.locator(".nox-inspector"), "Inspector is missing");
  await requiredVisible(
    page.getByRole("button", { name: "Peek current context" }),
    "Peek trigger is missing"
  );
  await requiredVisible(
    page.getByRole("button", { name: /NØX Assist/ }),
    "NØX Assist trigger is missing"
  );

  const identity = await page.locator(".nox-ai-context").last().textContent();
  if (
    !identity?.includes("Environment: " + expectedEnvironment) ||
    !identity.includes("Source: " + expectedSha)
  ) {
    throw new Error("Browser-visible environment or source identity is incorrect.");
  }
  if ((await page.locator(".nox-os").getAttribute("data-density")) !== "COMPACT") {
    throw new Error("Module-derived compact density is not active on the staging shell.");
  }

  const commandTrigger = page.getByRole("button", { name: "Search NØX-OS or run a command…" });
  await commandTrigger.click();
  await requiredVisible(page.getByRole("dialog", { name: "Command Center" }), "Command Center");
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog", { name: "Command Center" }).count()) {
    throw new Error("Command Center did not close on Escape.");
  }

  await page.goto(new URL("/material-intelligence", stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await requiredVisible(
    page.getByRole("heading", { name: "Material Intelligence" }),
    "SPA deep link did not load"
  );

  const health = await page.evaluate(async () => {
    const response = await fetch("/api/v1/health");
    return { ok: response.ok, body: await response.json() };
  });
  if (
    !health.ok ||
    health.body.environment !== expectedEnvironment ||
    health.body.sourceSha !== expectedSha
  ) {
    throw new Error("Staging API health identity is incorrect in the browser.");
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await mobile.goto(new URL("/material-intelligence", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    if (await mobile.locator(".nox-inspector").isVisible()) {
      throw new Error("Inspector must collapse at the mobile foundation breakpoint.");
    }
    if (
      (await mobile
        .locator(".nox-app-rail")
        .evaluate((node) => getComputedStyle(node).position)) !== "fixed"
    ) {
      throw new Error("Mobile App Rail is not fixed at the foundation breakpoint.");
    }
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}

console.log("DEPLOYMENT_BROWSER_SHELL=PASS");
