import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";

for (const width of [1280, 768, 390, 320]) {
  test(`platform route loading preserves Auth and shell at ${width}px`, async ({ page }) => {
    // Real App + Auth SDK with offline HTTP fixtures, not live provider acceptance.
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const reads: string[] = [];
    const writes: string[] = [];
    let platformOwner = true;
    let tenantManagement = false;
    let profileManagement = false;
    let tenantName = "Fixture Tenant";
    let tenantRevision = "1788600000.123456";
    let membershipRole = "TENANT_OWNER";
    let finishRename: (() => void) | undefined;
    let targetStatus = "ACTIVE";
    let rejectDisable = true;
    let missingRevision = false;
    let failUsersRefresh = false;
    let finishDisable: (() => void) | undefined;
    const id = "11111111-1111-4111-8111-111111111111";
    const memberId = "22222222-2222-4222-8222-222222222222";
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
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      (route.request().method() === "GET" ? reads : writes).push(path);
      if (route.request().method() === "PATCH") {
        expect(route.request().postDataJSON().expectedRevision).toBe(
          path === "/api/v1/tenant" ? tenantRevision : "1788600000.123456"
        );
        if (path === "/api/v1/tenant") {
          await new Promise<void>((resolve) => {
            finishRename = resolve;
          });
          tenantName = route.request().postDataJSON().name;
          tenantRevision = "1788600000.123458";
          return route.fulfill({
            json: {
              tenant: {
                id,
                name: tenantName,
                slug: "fixture",
                status: "ACTIVE",
                revision: tenantRevision
              }
            }
          });
        }
        if (path.includes("/tenant/members/") && profileManagement) {
          membershipRole = route.request().postDataJSON().roleKey;
          // A different actor edited the tenant while this user's name draft was open.
          tenantName = "Remote tenant name";
          tenantRevision = "1788600000.123457";
          return route.fulfill({ json: {} });
        }
        if (path === `/api/v1/platform/users/${memberId}` && !rejectDisable) {
          await new Promise<void>((resolve) => {
            finishDisable = resolve;
          });
          targetStatus = "DISABLED";
          failUsersRefresh = width === 1280;
          return route.fulfill({ json: {} });
        }
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: path.includes("/platform/users/")
                ? "PLATFORM_RESOURCE_STALE"
                : "LAST_ACTIVE_TENANT_OWNER_REQUIRED",
              message: path.includes("/platform/users/")
                ? "This object changed. Reload its current state before saving."
                : "An effective owner must remain.",
              requestId: "fixture"
            }
          }
        });
      }
      if (path === "/api/v1/platform/users" && failUsersRefresh) {
        failUsersRefresh = false;
        return route.fulfill({
          status: 503,
          json: {
            error: {
              message: "Current users unavailable.",
              code: "UNAVAILABLE",
              requestId: "fixture"
            }
          }
        });
      }
      const bodies: Record<string, unknown> = {
        "/api/v1/me": {
          user: {
            id,
            displayName: "Fixture",
            status: "ACTIVE",
            platformRoleKey: platformOwner ? "PLATFORM_OWNER" : null,
            platformPermissions: []
          }
        },
        "/api/v1/me/tenants": {
          tenants: [
            { roleKey: "TENANT_OWNER", tenant: { id, name: "Fixture Tenant", slug: "fixture" } },
            ...(profileManagement
              ? [
                  {
                    roleKey: "TENANT_MEMBER",
                    tenant: {
                      id: "33333333-3333-4333-8333-333333333333",
                      name: "Other Tenant",
                      slug: "other"
                    }
                  }
                ]
              : [])
          ]
        },
        "/api/v1/context": {
          tenant: { tenantId: id, roleKey: "TENANT_OWNER" },
          authorization: {
            tenantPermissions: tenantManagement
              ? [
                  "tenant.profile.read",
                  ...(profileManagement ? ["tenant.profile.manage"] : []),
                  "tenant.membership.manage",
                  "tenant.membership.owner.manage"
                ]
              : ["tenant.profile.read"],
            modulePermissions: []
          },
          entitlements: [],
          moduleAvailability: []
        },
        "/api/v1/platform/tenants": { tenants: [] },
        "/api/v1/platform/users": {
          users: [
            {
              id: memberId,
              displayName: "Control User",
              status: targetStatus,
              revision: missingRevision ? undefined : "1788600000.123456",
              platformRoleKey: "PLATFORM_OWNER"
            }
          ]
        },
        "/api/v1/platform/audit": { events: [] },
        "/api/v1/tenant": {
          tenant: {
            id,
            name: tenantName,
            slug: "fixture",
            status: "ACTIVE",
            revision: tenantRevision
          }
        },
        "/api/v1/tenant/members": {
          members: [
            {
              tenantId: id,
              userId: memberId,
              status: "ACTIVE",
              roleKey: membershipRole,
              revision: "1788600000.123456"
            }
          ]
        },
        "/api/v1/tenant/entitlements": { entitlements: [] }
      };
      return route.fulfill({ json: bodies[path] ?? {} });
    });
    let chunkRequests = 0;
    let shellRequests = 0;
    let releaseShell!: () => void;
    const shellReady = new Promise<void>((resolve) => {
      releaseShell = resolve;
    });
    const assets = "apps/nox-os/dist/assets";
    const shellMap = readdirSync(assets).find(
      (file) =>
        file.endsWith(".js.map") &&
        (JSON.parse(readFileSync(`${assets}/${file}`, "utf8")).sources as string[]).some((source) =>
          source.endsWith("packages/ui/dist/index.js")
        )
    );
    expect(shellMap, "Actual built Shell chunk must have source-map identity").toBeDefined();
    await page.route(`**/assets/${shellMap!.slice(0, -4)}`, async (route) => {
      shellRequests++;
      await shellReady;
      await route.continue();
    });
    let releaseChunk!: () => void;
    const chunkReady = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    await page.route("**/assets/platform-control-*.js", async (route) => {
      chunkRequests++;
      await chunkReady;
      await route.continue();
    });
    await page.goto("/sign-in");
    await expect(page).toHaveTitle(/NØX/);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    expect(chunkRequests).toBe(0);
    expect(shellRequests).toBe(0);
    expect(reads.filter((path) => path.startsWith("/api/v1/platform/"))).toEqual([]);
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
    await page.getByLabel("Password", { exact: true }).fill("fixture-only-not-a-credential");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect.poll(() => shellRequests).toBe(1);
    await expect(
      page.getByRole("status", { name: "" }).filter({ hasText: "Loading workspace shell" })
    ).toBeVisible();
    await expect(page.getByLabel("Current tenant")).toHaveCount(0);
    expect(chunkRequests).toBe(0);
    releaseShell();
    await expect.poll(() => chunkRequests).toBe(1);
    await expect(
      page.getByRole("status").filter({ hasText: /Loading (Platform|tenant)/ })
    ).toBeVisible();
    // The shell remains interactive while the route payload is deliberately withheld.
    await expect(page.getByLabel("Current tenant")).toBeVisible();
    releaseChunk();
    await page.goto("/platform/users");
    await expect(page.getByRole("heading", { name: "Platform users", exact: true })).toBeVisible();
    const userRow = page.getByRole("row").filter({ hasText: "Control User" });
    const disable = userRow.getByRole("button", { name: "Disable", exact: true });
    await disable.click();
    const disableDialog = page.getByRole("dialog", { name: "Disable", exact: true });
    await expect(disableDialog).toContainText(memberId);
    await expect(disableDialog).toContainText("platform.user.status.manage");
    await expect(disableDialog).toContainText("1788600000.123456");
    expect(writes).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(disableDialog).toHaveCount(0);
    await expect(disable).toBeFocused();
    await disable.click();
    await disableDialog.getByRole("button", { name: "Confirm Disable", exact: true }).click();
    await expect(disableDialog.getByRole("alert")).toContainText(
      "This object changed. Reload its current state before saving."
    );
    await expect(
      disableDialog.getByRole("button", { name: "Confirm Disable", exact: true })
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
    await disableDialog.getByRole("button", { name: "Back without changes" }).click();
    missingRevision = true;
    await page.reload();
    await disable.click();
    await expect(disableDialog).toContainText("Unavailable — reload current data");
    await expect(
      disableDialog.getByRole("button", { name: "Confirm Disable", exact: true })
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
    await disableDialog.getByRole("button", { name: "Back without changes" }).click();
    missingRevision = false;
    await page.reload();
    rejectDisable = false;
    await disable.click();
    await disableDialog.getByRole("button", { name: "Confirm Disable", exact: true }).click();
    await expect(disableDialog.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    await disableDialog
      .getByRole("button", { name: "Submitting…" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page.keyboard.press("Escape");
    await expect(disableDialog).toBeVisible();
    await expect.poll(() => Boolean(finishDisable)).toBe(true);
    expect(writes).toHaveLength(2);
    finishDisable!();
    if (width === 1280) {
      await expect(disableDialog.getByRole("alert")).toContainText(
        "Change saved, but current users could not be reloaded."
      );
      await expect(
        disableDialog.getByRole("button", { name: "Confirm Disable", exact: true })
      ).toBeDisabled();
      expect(writes).toHaveLength(2);
      await disableDialog.getByRole("button", { name: "Back without changes" }).click();
      await page.reload();
    }
    await expect(disableDialog).toHaveCount(0);
    await expect(userRow.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    await page.goto("/platform/audit");
    await expect(page.getByRole("heading", { name: "Platform audit", exact: true })).toBeVisible();
    await page.goto("/settings/tenant");
    await expect(page.getByRole("heading", { name: "Tenant settings", exact: true })).toBeVisible();
    // Role label alone cannot grant controls absent RequestContext permissions.
    await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);
    await expect(page.getByLabel(`Role for ${memberId}`)).toHaveCount(0);
    tenantManagement = true;
    await page.reload();
    const role = page.getByLabel(`Role for ${memberId}`);
    await expect(role).toBeVisible();
    await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);
    await role.selectOption("TENANT_ADMIN");
    const demote = page.getByRole("dialog", { name: "Demote Tenant Owner" });
    await expect(demote).toContainText(memberId);
    await expect(demote).toContainText("TENANT_ADMIN");
    expect(writes).toHaveLength(2);
    await demote.getByRole("button", { name: "Back without changes" }).click();
    await expect(role).toHaveValue("TENANT_OWNER");
    await role.selectOption("TENANT_ADMIN");
    await demote.getByRole("button", { name: "Confirm Demote Tenant Owner" }).click();
    await expect(demote.getByRole("alert")).toContainText("An effective owner must remain.");
    await expect(role).toHaveValue("TENANT_OWNER");
    expect(writes).toEqual([
      `/api/v1/platform/users/${memberId}`,
      `/api/v1/platform/users/${memberId}`,
      `/api/v1/tenant/members/${memberId}`
    ]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/platform-owner-confirmation-${width}.png` });
    await demote.getByRole("button", { name: "Back without changes" }).click();
    profileManagement = true;
    membershipRole = "TENANT_MEMBER";
    await page.reload();
    await page.getByLabel("Current tenant").selectOption(id);
    const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
    await nameInput.fill("My unsaved tenant name");
    await page.getByLabel("Current tenant").selectOption("33333333-3333-4333-8333-333333333333");
    await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/tenant$/);
    await expect(page.getByLabel("Current tenant")).toHaveValue(id);
    await expect(nameInput).toHaveValue("My unsaved tenant name");
    await role.selectOption("TENANT_ADMIN");
    await expect(role).toHaveValue("TENANT_ADMIN");
    await expect(nameInput).toHaveValue("My unsaved tenant name");
    await expect(page.getByRole("alert")).toContainText("Tenant changed while this draft was open");
    await expect(page.getByRole("button", { name: "Save name", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Discard draft and use loaded name" }).click();
    await expect(nameInput).toHaveValue("Remote tenant name");
    await nameInput.fill("Explicit fresh name");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(nameInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "Saving name…" })).toBeDisabled();
    await page
      .getByRole("button", { name: "Saving name…" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => Boolean(finishRename)).toBe(true);
    expect(writes.filter((path) => path === "/api/v1/tenant")).toHaveLength(1);
    finishRename!();
    await expect(nameInput).toBeEnabled();
    await expect(nameInput).toHaveValue("Explicit fresh name");
    await expect(page.getByRole("status").filter({ hasText: "Tenant name saved" })).toBeVisible();
    if (width === 320) {
      // Increase actual computed text size, including pixel-token text. This is
      // text resize/reflow, not a screenshot scale transform.
      await page.evaluate(() => {
        const elements = [...document.querySelectorAll<HTMLElement>("body *")];
        const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
        elements.forEach((element, index) => {
          element.style.fontSize = `${sizes[index]! * 2}px`;
          element.style.lineHeight = "1.5";
          element.style.letterSpacing = "0.12em";
          element.style.wordSpacing = "0.16em";
          if (element.tagName === "P") element.style.marginBottom = "2em";
        });
      });
    }
    await expect(nameInput).toBeVisible();
    await page.screenshot({ path: `/tmp/nox-ui-v3/tenant-name-recovery-${width}.png` });
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > innerWidth &&
            !element.closest(".nox-table-wrap")
        )
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          text: element.textContent?.slice(0, 50),
          right: element.getBoundingClientRect().right
        }))
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    expect(overflow.elements).toEqual([]);
    if (width === 320) {
      await nameInput.fill("Resized text draft");
      const save = page.getByRole("button", { name: "Save name", exact: true });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await expect(save).toBeEnabled();
      await page.getByRole("button", { name: "Discard draft and use loaded name" }).click();
      await expect(nameInput).toHaveValue("Explicit fresh name");
      expect(writes.filter((path) => path === "/api/v1/tenant")).toHaveLength(1);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `/tmp/nox-ui-v3/tenant-name-recovery-${width}.png` });
    platformOwner = false;
    const platformReads = reads.filter((path) => path.startsWith("/api/v1/platform/")).length;
    await page.goto("/platform/users");
    await expect(
      page.getByRole("heading", { name: "Platform Console access denied" })
    ).toBeVisible();
    expect(reads.filter((path) => path.startsWith("/api/v1/platform/"))).toHaveLength(
      platformReads
    );
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/platform-route-denied-${width}.png` });
  });
}
