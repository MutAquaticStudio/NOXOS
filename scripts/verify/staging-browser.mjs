import { chromium } from "@playwright/test";
import { resolvePreviewBrowserContract } from "./preview-browser-contract.mjs";

const stagingUrl = process.env.NOX_STAGING_URL;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const expectedEnvironment = process.env.NOX_EXPECTED_ENV ?? "staging";
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!stagingUrl || !expectedSha) {
  throw new Error("NOX_STAGING_URL and EXPECTED_SOURCE_SHA are required for browser verification.");
}

const requiredVisible = async (locator, description) => {
  try {
    await locator.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    throw new Error("Staging browser acceptance failed: " + description);
  }
  if (!(await locator.isVisible())) {
    throw new Error("Browser acceptance failed: " + description);
  }
};

const readJson = async (page, path) =>
  page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath);
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, body };
  }, path);

const browser = await chromium.launch({ headless: true });
try {
  const browserHeaders = protectionBypass
    ? {
        "x-vercel-protection-bypass": protectionBypass,
        "x-vercel-set-bypass-cookie": "true"
      }
    : undefined;
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: browserHeaders
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(stagingUrl, { waitUntil: "networkidle" });
  const protectedResponse = await readJson(page, "/api/v1/me");
  const browserContract = resolvePreviewBrowserContract(protectedResponse);

  if (browserContract === "AUTHENTICATED_PLATFORM") {
    if (
      protectedResponse.status !== 401 ||
      protectedResponse.body?.error?.code !== "AUTH_REQUIRED"
    ) {
      throw new Error("Unauthenticated protected API did not fail closed.");
    }

    await page.goto(new URL("/sign-in", stagingUrl).toString(), { waitUntil: "networkidle" });
    await requiredVisible(page.getByRole("heading", { name: "Sign in" }), "Sign In is missing");
    if (await page.getByRole("navigation", { name: "Application modules" }).count()) {
      throw new Error("Unauthenticated browser rendered protected shell content.");
    }
    if ((await page.locator(".nox-os").getAttribute("data-density")) !== "DEFAULT") {
      throw new Error("Authentication foundation did not preserve the OS density authority.");
    }

    await page.goto(new URL("/settings/tenant", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await requiredVisible(
      page.getByRole("heading", { name: "Sign in" }),
      "Protected SPA deep link"
    );
  } else {
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

    const commandTrigger = page.getByRole("button", {
      name: "Search NØX-OS or run a command…"
    });
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
  }

  const health = await readJson(page, "/api/v1/health");
  if (
    !health.ok ||
    health.body.environment !== expectedEnvironment ||
    health.body.sourceSha !== expectedSha
  ) {
    throw new Error("Browser-visible API health identity is incorrect.");
  }

  const documentText = await page.locator("html").innerText();
  if (
    /SUPABASE_SERVICE_ROLE_KEY|NOX_RUNTIME_DATABASE_URL|NOX_WORKFLOW_DATABASE_URL/i.test(
      documentText
    )
  ) {
    throw new Error("Browser-visible content exposed a server-only configuration name.");
  }

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: browserHeaders
  });
  try {
    if (browserContract === "AUTHENTICATED_PLATFORM") {
      await mobile.goto(new URL("/sign-in", stagingUrl).toString(), { waitUntil: "networkidle" });
      await requiredVisible(mobile.getByRole("heading", { name: "Sign in" }), "mobile Sign In");
      const geometry = await mobile.locator(".nox-auth-card").evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, viewport: window.innerWidth };
      });
      if (geometry.left < 0 || geometry.right > geometry.viewport) {
        throw new Error("Authentication foundation overflows the mobile viewport.");
      }
    } else {
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
    }
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}

console.log("DEPLOYMENT_BROWSER_CONTRACT=PASS");
