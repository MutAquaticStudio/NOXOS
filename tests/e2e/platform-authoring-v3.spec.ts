import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const createdId = "44444444-4444-4444-8444-444444444444";
const tenant = {
  id: tenantId,
  name: "Tenant A",
  slug: "tenant-a",
  status: "ACTIVE",
  revision: "1788600000.123456"
};

async function authenticate(page: Page) {
  const jwt = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64url"),
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
          id: userId,
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
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Current tenant")).toBeVisible();
}

for (const kind of ["user", "tenant", "member"] as const) {
  test(`${kind} authoring retains rejected drafts and distinguishes saved-but-refresh-failed`, async ({
    page
  }) => {
    // Real App/Auth SDK, deterministic HTTP fixtures; never hosted acceptance.
    await page.setViewportSize({ width: 390, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const target =
      kind === "user"
        ? "/platform/users"
        : kind === "tenant"
          ? "/platform/tenants"
          : `/platform/tenants/${tenantId}/members`;
    const writes: unknown[] = [];
    let reject = true;
    let failedRead = false;
    let saved = false;
    let release: (() => void) | undefined;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      if (route.request().method() !== "GET") {
        expect(path).toBe(target);
        expect(route.request().method()).toBe("POST");
        writes.push(route.request().postDataJSON());
        if (reject)
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: "CONFLICT",
                message: "Fixture conflict: no change saved.",
                requestId: "fixture"
              }
            }
          });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        failedRead = true;
        saved = true;
        return route.fulfill({
          json: {
            tenant: { ...tenant, id: createdId, name: "Draft tenant", slug: "draft-tenant" },
            user: { id: otherId },
            membership: { userId, tenantId }
          }
        });
      }
      if (failedRead && path === target)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "UNAVAILABLE",
              message: "Fixture read unavailable.",
              requestId: "fixture"
            }
          }
        });
      const payloads: Record<string, unknown> = {
        "/me": {
          user: {
            id: userId,
            displayName: "Fixture owner",
            status: "ACTIVE",
            platformRoleKey: "PLATFORM_OWNER",
            platformPermissions: []
          }
        },
        "/me/tenants": {
          tenants: [
            { roleKey: "TENANT_OWNER", tenant },
            { roleKey: "TENANT_OWNER", tenant: { ...tenant, id: otherId, name: "Tenant B" } }
          ]
        },
        "/context": {
          tenant: { tenantId, roleKey: "TENANT_OWNER" },
          authorization: { tenantPermissions: [], modulePermissions: [] },
          moduleAvailability: []
        },
        "/platform/users": {
          users: [
            {
              id: userId,
              displayName: "Fixture owner",
              status: "ACTIVE",
              platformRoleKey: "PLATFORM_OWNER",
              revision: tenant.revision
            },
            ...(saved && kind === "user"
              ? [
                  {
                    id: otherId,
                    displayName: "Draft user",
                    status: "ACTIVE",
                    platformRoleKey: null,
                    revision: tenant.revision
                  }
                ]
              : [])
          ]
        },
        "/platform/tenants": {
          tenants: [
            tenant,
            { ...tenant, id: otherId, name: "Tenant B" },
            ...(saved && kind === "tenant"
              ? [{ ...tenant, id: createdId, name: "Draft tenant", slug: "draft-tenant" }]
              : [])
          ]
        },
        [`/platform/tenants/${tenantId}/members`]: {
          members:
            saved && kind === "member"
              ? [
                  {
                    tenantId,
                    userId,
                    roleKey: "TENANT_ADMIN",
                    status: "ACTIVE",
                    revision: tenant.revision
                  }
                ]
              : []
        },
        [`/platform/tenants/${tenantId}/entitlements`]: { entitlements: [] },
        [`/platform/tenants/${otherId}/members`]: { members: [] },
        [`/platform/tenants/${otherId}/entitlements`]: { entitlements: [] },
        [`/platform/tenants/${createdId}/members`]: { members: [] },
        [`/platform/tenants/${createdId}/entitlements`]: { entitlements: [] }
      };
      return route.fulfill({ json: payloads[path] ?? {} });
    });
    await authenticate(page);
    await page.goto(kind === "user" ? "/platform/users" : "/platform/tenants");
    await page.getByLabel("Current tenant").selectOption(tenantId);
    await expect(page).toHaveTitle(/NØX/);
    const field =
      kind === "user"
        ? page.getByLabel("Existing Auth user ID", { exact: true })
        : kind === "tenant"
          ? page.getByLabel("Name", { exact: true })
          : page.getByRole("combobox", { name: "Existing PlatformUser", exact: true });
    const submit = page.getByRole("button", {
      name:
        kind === "user"
          ? "Provision PlatformUser"
          : kind === "tenant"
            ? "Create tenant"
            : "Add existing user",
      exact: true
    });
    if (kind === "user") {
      await field.fill(otherId);
      await page.getByLabel("Display name", { exact: true }).fill("Draft user");
    } else {
      await page.getByLabel("Name", { exact: true }).fill("Draft tenant");
      await page.getByLabel("Slug", { exact: true }).fill("draft-tenant");
      await page.getByRole("combobox", { name: "Initial owner", exact: true }).selectOption(userId);
      if (kind === "member") {
        // Mounting a clean detail must not clear the parent's draft warning.
        await page.getByRole("button", { name: "Open detail", exact: true }).first().click();
        await expect(field).toBeEnabled();
        await field.selectOption(userId);
        await page
          .getByRole("combobox", { name: "Role", exact: true })
          .selectOption("TENANT_ADMIN");
        await expect(
          page.getByRole("button", { name: "Create tenant", exact: true })
        ).toBeDisabled();
        for (const open of await page
          .getByRole("button", { name: "Open detail", exact: true })
          .all())
          await expect(open).toBeDisabled();
      }
    }
    await page.getByLabel("Current tenant").selectOption(otherId);
    await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    const value = kind === "user" ? otherId : kind === "tenant" ? "Draft tenant" : userId;
    await expect(field).toHaveValue(value);
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("no change saved");
    await expect(field).toHaveValue(value);
    await expect(field).toBeEnabled();
    expect(writes).toHaveLength(1);
    reject = false;
    await submit.click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(field).toBeDisabled();
    const pending = page.getByRole("button", {
      name:
        kind === "user"
          ? "Provisioning…"
          : kind === "tenant"
            ? "Creating tenant…"
            : "Adding membership…",
      exact: true
    });
    await expect(pending).toBeDisabled();
    // Even another form submit event during the unresolved request issues no POST.
    await pending.evaluate((button) =>
      button
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(writes).toHaveLength(2);
    await expect(
      page.getByRole("button", {
        name: `Refresh ${kind === "user" ? "Platform users" : kind === "tenant" ? "Platform tenants" : "Tenant detail"}`,
        exact: true
      })
    ).toBeDisabled();
    release!();
    await expect(page.getByRole("alert")).toContainText(
      kind === "user"
        ? "PlatformUser provisioned, but"
        : kind === "tenant"
          ? "Tenant created, but"
          : "Membership added, but"
    );
    await expect(field).toHaveValue("");
    await expect(submit).toBeDisabled();
    expect(writes).toHaveLength(2);
    if (kind === "member") {
      await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Draft tenant");
      await page.getByLabel("Current tenant").selectOption(otherId);
      await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    }
    failedRead = false;
    await page
      .getByRole("button", {
        name: `Retry ${kind === "user" ? "Platform users" : kind === "tenant" ? "Platform tenants" : "Tenant detail"}`,
        exact: true
      })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const expectedBody =
      kind === "user"
        ? { userId: otherId, displayName: "Draft user" }
        : kind === "tenant"
          ? { name: "Draft tenant", slug: "draft-tenant", initialOwnerUserId: userId }
          : { userId, roleKey: "TENANT_ADMIN" };
    expect(writes).toEqual([expectedBody, expectedBody]);
    if (kind === "user")
      await expect(page.getByRole("cell", { name: "Draft user", exact: true })).toBeVisible();
    else if (kind === "tenant")
      await expect(page.getByRole("heading", { name: "Draft tenant", exact: true })).toBeVisible();
    else {
      await expect(
        page.getByRole("row").filter({ hasText: userId }).filter({ hasText: "TENANT_ADMIN" })
      ).toBeVisible();
      await page.getByRole("button", { name: "Discard tenant draft", exact: true }).click();
      await expect(page.getByRole("tab", { name: /Unsaved/ })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Open detail", exact: true }).last()
      ).toBeEnabled();
    }
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/platform-${kind}-authoring-recovery.png` });
  });
}
