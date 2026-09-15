import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const id = "11111111-1111-4111-8111-111111111111";
const tenant = {
  id,
  name: "Read fixture tenant",
  slug: "read-fixture",
  status: "ACTIVE",
  revision: "1788600000.123456"
};
for (const entry of [
  {
    route: "/platform/users",
    query: "/platform/users",
    subject: "Platform users",
    empty: "No Platform users found.",
    payload: { users: [] }
  },
  {
    route: "/platform/tenants",
    query: "/platform/tenants",
    subject: "Platform tenants",
    empty: "No tenants found.",
    payload: { tenants: [] }
  },
  {
    route: "/platform/audit",
    query: "/platform/audit",
    subject: "Platform audit",
    empty: "No audit events found.",
    payload: { events: [] }
  },
  {
    route: "/settings/tenant",
    query: "/tenant/members",
    subject: "Tenant settings",
    empty: "No memberships found.",
    payload: { members: [] }
  },
  {
    route: "/platform/tenants",
    query: `/platform/tenants/${id}/members`,
    subject: "Tenant detail",
    empty: "No memberships found.",
    payload: { members: [] }
  }
]) {
  test(`${entry.subject}: loading, denied read, explicit retry and confirmed empty`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const errors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const jwt = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        "base64url"
      ),
      "fixture"
    ].join(".");
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
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
      })
    );
    let readMode: "HOLD" | "EMPTY" | "DATA" | "FAIL" | "MALFORMED" = "HOLD";
    let releaseRead: (() => void) | undefined;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      if (route.request().method() !== "GET") writes.push(path);
      if (path === entry.query) {
        if (readMode === "MALFORMED") return route.fulfill({ json: {} });
        if (readMode === "DATA")
          return route.fulfill({
            json: {
              users: [
                {
                  id,
                  displayName: "Retained user",
                  status: "ACTIVE",
                  platformRoleKey: null,
                  revision: "1788600000.123456"
                }
              ]
            }
          });
        if (readMode === "FAIL")
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "UNAVAILABLE",
                message: "Read temporarily unavailable.",
                requestId: "read-fixture"
              }
            }
          });
        if (readMode === "HOLD") {
          await new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
          return route.fulfill({
            status: 403,
            json: {
              error: {
                code: "PERMISSION_DENIED",
                message: "Read permission was removed.",
                requestId: "read-fixture"
              }
            }
          });
        }
        return route.fulfill({ json: entry.payload });
      }
      const payloads: Record<string, unknown> = {
        "/me": {
          user: {
            id,
            displayName: "Fixture",
            status: "ACTIVE",
            platformRoleKey: "PLATFORM_OWNER",
            platformPermissions: []
          }
        },
        "/me/tenants": { tenants: [{ roleKey: "TENANT_OWNER", tenant }] },
        "/context": {
          tenant: { tenantId: id, roleKey: "TENANT_OWNER" },
          authorization: {
            tenantPermissions: [
              "tenant.profile.read",
              "tenant.profile.manage",
              "tenant.membership.manage"
            ],
            modulePermissions: []
          },
          moduleAvailability: []
        },
        "/platform/users": { users: [] },
        "/platform/tenants": { tenants: [tenant] },
        [`/platform/tenants/${id}/entitlements`]: { entitlements: [] },
        "/tenant": { tenant },
        "/tenant/entitlements": { entitlements: [] }
      };
      return route.fulfill({ json: payloads[path] ?? {} });
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
    await page.getByLabel("Password", { exact: true }).fill("fixture-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Current tenant")).toBeVisible();
    await page.goto(entry.route);
    await expect(page).toHaveTitle(/NØX/);
    if (entry.subject === "Tenant detail")
      await page.getByRole("button", { name: "Open detail", exact: true }).click();
    await expect.poll(() => Boolean(releaseRead)).toBe(true);
    await expect(
      page.getByRole("status").filter({ hasText: `Loading ${entry.subject} data` })
    ).toBeVisible();
    await expect(page.getByText(entry.empty, { exact: true })).toHaveCount(0);
    if (entry.subject === "Tenant detail") {
      await expect(
        page.getByRole("button", { name: "Add existing user", exact: true })
      ).toBeDisabled();
      for (const checkbox of await page.getByRole("checkbox").all())
        await expect(checkbox).toBeDisabled();
      await expect(page.getByText("Not verified", { exact: true }).first()).toBeVisible();
    }
    releaseRead!();
    await expect(page.getByRole("alert")).toContainText("Read permission was removed.");
    await expect(page.getByText(entry.empty, { exact: true })).toHaveCount(0);
    if (entry.route === "/platform/users")
      await expect(page.getByRole("button", { name: "Provision PlatformUser" })).toBeDisabled();
    if (entry.subject === "Platform tenants")
      await expect(page.getByRole("button", { name: "Create tenant", exact: true })).toBeDisabled();
    if (entry.route === "/settings/tenant")
      await expect(
        page.getByText("No module entitlement is enabled.", { exact: true })
      ).toHaveCount(0);
    readMode = "EMPTY";
    await page.getByRole("button", { name: `Retry ${entry.subject}`, exact: true }).click();
    await expect(page.getByText(entry.empty, { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (entry.subject === "Platform users") {
      readMode = "DATA";
      await page.getByRole("button", { name: "Refresh Platform users", exact: true }).click();
      await expect(page.getByText("Retained user", { exact: true })).toBeVisible();
      readMode = "FAIL";
      await page.getByRole("button", { name: "Refresh Platform users", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Read temporarily unavailable.");
      await expect(page.getByText("Retained user", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Grant PLATFORM_OWNER", exact: true })
      ).toBeDisabled();
    }
    readMode = "MALFORMED";
    await page
      .getByRole("button", {
        name: `${entry.subject === "Platform users" ? "Retry" : "Refresh"} ${entry.subject}`,
        exact: true
      })
      .click();
    await expect(page.getByRole("alert")).toContainText("Invalid");
    await expect(page.getByText(entry.empty, { exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({
      path: `/tmp/nox-ui-v3/${entry.subject.replaceAll(" ", "-").toLowerCase()}-read-recovery.png`
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
