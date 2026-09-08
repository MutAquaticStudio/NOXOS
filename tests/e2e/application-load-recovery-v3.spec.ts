import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";

for (const boundary of ["auth", "shell", "module"] as const) {
  test(`${boundary} chunk failure has safe explicit recovery without auth bypass`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    const assets = "apps/nox-os/dist/assets";
    const chunk = readdirSync(assets).find(
      (file) =>
        file.endsWith(".js.map") &&
        (JSON.parse(readFileSync(`${assets}/${file}`, "utf8")).sources as string[]).some(
          (source) =>
            boundary === "auth"
              ? source.endsWith("@supabase/supabase-js/dist/index.mjs")
              : boundary === "shell"
                ? source.endsWith("packages/ui/dist/index.js")
                : source.endsWith("src/platform-control.tsx")
        )
    );
    expect(chunk, "Match the actual built chunk using its source map").toBeDefined();
    let unavailable = true;
    let attempts = 0;
    await page.route(`**/assets/${chunk!.slice(0, -4)}`, (route) => {
      attempts++;
      return unavailable ? route.abort("failed") : route.continue();
    });
    const id = "11111111-1111-4111-8111-111111111111";
    const jwt = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        "base64url"
      ),
      "fixture"
    ].join(".");
    let signIns = 0;
    await page.route("**/auth/v1/token**", (route) => {
      signIns++;
      return route.fulfill({
        json: {
          access_token: jwt,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "fixture-refresh",
          user: {
            id,
            email: "fixture@example.test",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z"
          }
        }
      });
    });
    const apiWrites: string[] = [];
    const apiReads: string[] = [];
    const tenant = {
      id,
      name: "Fixture tenant",
      slug: "fixture",
      status: "ACTIVE",
      revision: "1788600000.123456"
    };
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      (route.request().method() === "GET" ? apiReads : apiWrites).push(path);
      const data: Record<string, unknown> = {
        "/me": {
          user: {
            id,
            displayName: "Fixture owner",
            status: "ACTIVE",
            platformRoleKey: "PLATFORM_OWNER",
            platformPermissions: []
          }
        },
        "/me/tenants": { tenants: [{ roleKey: "TENANT_OWNER", tenant }] },
        "/context": {
          tenant: { tenantId: id, roleKey: "TENANT_OWNER" },
          authorization: { tenantPermissions: [], modulePermissions: [] },
          moduleAvailability: []
        },
        "/platform/users": { users: [] },
        "/platform/tenants": { tenants: [] },
        "/tenant": { tenant },
        "/tenant/members": { members: [] },
        "/tenant/entitlements": { entitlements: [] }
      };
      return route.fulfill({ json: data[path] ?? {} });
    });
    await page.goto("/sign-in");
    const signIn = async () => {
      await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
      await page.getByLabel("Password", { exact: true }).fill("fixture-only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    };
    if (boundary !== "auth") await signIn();
    await expect(
      page.getByRole("heading", {
        name: boundary === "auth" ? "Authentication unavailable" : "Workspace unavailable",
        exact: true
      })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: boundary === "auth" ? "Authentication unavailable" : "Workspace unavailable",
        exact: true
      })
    ).toBeFocused();
    expect(attempts).toBe(1);
    if (boundary === "auth") {
      expect(signIns).toBe(0);
      expect(apiReads).toEqual([]);
    }
    if (boundary === "module") {
      await expect(page.getByLabel("Current tenant")).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();
    } else await expect(page.getByLabel("Current tenant")).toHaveCount(0);
    await expect(
      page.getByText("Authentication is not configured for this environment.", { exact: true })
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Unexpected Application Error");
    await expect(page.locator("body")).not.toContainText(chunk!.slice(0, -4));
    await expect(page.locator("pre")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/${boundary}-load-failure.png` });
    unavailable = false;
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", {
        name: boundary === "auth" ? "Reload sign-in" : "Reload workspace",
        exact: true
      })
    ).toBeFocused();
    await page.keyboard.press("Enter");
    if (boundary === "auth") {
      await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
      await signIn();
    }
    await expect(page.getByLabel("Current tenant")).toBeVisible();
    await page.goto("/platform/users");
    await expect(page.getByRole("heading", { name: "Platform users", exact: true })).toBeVisible();
    expect(signIns).toBe(1);
    expect(apiWrites).toEqual([]);
    expect(runtimeErrors).toEqual([]);
    await expect(page).toHaveTitle(/NØX/);
  });
}
