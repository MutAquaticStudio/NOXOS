import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const target of ["tenants", "identity", "context"] as const) {
  test(`${target} query fails closed and retries only its own read`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const id = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const tenant = { id, name: "Tenant A", slug: "tenant-a", status: "ACTIVE" };
    const membership = { roleKey: "TENANT_OWNER", tenant };
    const identity = {
      user: {
        id,
        status: "ACTIVE",
        displayName: "Fixture",
        platformRoleKey: target === "identity" ? "PLATFORM_OWNER" : null,
        platformPermissions: []
      }
    };
    const context = {
      tenant: { tenantId: id, roleKey: "TENANT_OWNER" },
      authorization: { tenantPermissions: [], modulePermissions: [] },
      moduleAvailability: []
    };
    const endpoint =
      target === "tenants" ? "/me/tenants" : target === "identity" ? "/me" : "/context";
    let mode: "FAIL" | "MALFORMED" | "MISMATCH" | "VALID" | "EMPTY" = "FAIL";
    let hold: (() => void) | undefined;
    let waitForRead = false;
    const counts: Record<string, number> = {};
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const jwt = [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
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
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      counts[path] = (counts[path] ?? 0) + 1;
      if (route.request().method() !== "GET") writes.push(path);
      if (path === endpoint) {
        if (mode === "EMPTY") return route.fulfill({ json: { tenants: [] } });
        if (waitForRead)
          await new Promise<void>((resolve) => {
            hold = resolve;
          });
        if (mode === "FAIL")
          return route.fulfill({
            status: 503,
            json: { error: { message: "fixture provider detail must not be rendered" } }
          });
        if (mode === "MALFORMED") return route.fulfill({ json: {} });
        if (mode === "MISMATCH")
          return route.fulfill({
            json:
              target === "tenants"
                ? { tenants: [membership, membership] }
                : target === "identity"
                  ? { user: { ...identity.user, id: other } }
                  : { ...context, tenant: { ...context.tenant, tenantId: other } }
          });
      }
      const payloads: Record<string, unknown> = {
        "/me": identity,
        "/me/tenants": { tenants: [membership] },
        "/context": context,
        "/tenant": { tenant },
        "/tenant/members": { members: [] },
        "/tenant/entitlements": { entitlements: [] },
        "/platform/users": { users: [] },
        "/platform/tenants": { tenants: [] }
      };
      return route.fulfill({ json: payloads[path] ?? {} });
    });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
    await page.getByLabel("Password", { exact: true }).fill("fixture-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const retry = page.getByRole("button", {
      name:
        target === "tenants"
          ? "Retry workspaces"
          : target === "identity"
            ? "Retry identity"
            : "Retry tenant context",
      exact: true
    });
    await expect(retry).toBeVisible();
    if (target === "context")
      await page.screenshot({ path: "/tmp/nox-ui-v3/context-read-failure-390.png" });
    await expect(
      page.getByRole("heading", { name: "NO ACTIVE WORKSPACE AVAILABLE", exact: true })
    ).toHaveCount(0);
    if (target === "identity") expect(counts["/platform/tenants"] ?? 0).toBe(0);
    const unrelated = target === "identity" ? "/me/tenants" : "/me";
    const unrelatedReads = counts[unrelated];
    for (const next of ["MALFORMED", "MISMATCH"] as const) {
      mode = next;
      const before = counts[endpoint];
      await retry.click();
      await expect.poll(() => counts[endpoint]).toBe(before + 1);
      await expect(retry).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "NO ACTIVE WORKSPACE AVAILABLE", exact: true })
      ).toHaveCount(0);
      if (target === "identity") expect(counts["/platform/tenants"] ?? 0).toBe(0);
    }
    mode = "VALID";
    waitForRead = true;
    await retry.click();
    await expect.poll(() => Boolean(hold)).toBe(true);
    await expect(retry).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({
        hasText:
          target === "tenants"
            ? "Loading workspaces"
            : target === "identity"
              ? "Loading identity"
              : "Refreshing tenant context"
      })
    ).toBeVisible();
    hold!();
    await expect(page.getByLabel("Current tenant")).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /Loading identity|Refreshing tenant context/ })
    ).toHaveCount(0);
    if (target === "identity") {
      await page.getByRole("button", { name: "User menu", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Platform Console", exact: true })
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    expect(counts[unrelated]).toBe(unrelatedReads);
    if (target === "tenants") {
      mode = "EMPTY";
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "NO ACTIVE WORKSPACE AVAILABLE", exact: true })
      ).toBeVisible();
      await expect(retry).toHaveCount(0);
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await expect(page.locator("body")).not.toContainText("fixture provider detail");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
