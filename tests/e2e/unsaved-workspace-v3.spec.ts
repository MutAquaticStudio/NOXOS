import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

test("real App navigation preserves unsaved edits on cancellation and isolates tenant switch", async ({
  page
}) => {
  // Offline protocol fixtures exercise the real app + SDK. Not provider acceptance.
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  const userId = "11111111-1111-4111-8111-111111111111";
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
  const mutations: string[] = [];
  const bodies: any[] = [];
  let rejectCreation = true;
  let failMaterialLookup = true;
  let releaseServiceB: (() => void) | undefined;
  const serviceA = "22222222-2222-4222-8222-222222222222";
  const serviceB = "33333333-3333-4333-8333-333333333333";
  const readCounts: Record<string, number> = {};
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") mutations.push(request.url());
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") readCounts[path] = (readCounts[path] ?? 0) + 1;
    const tenantId = request.headers()["x-nox-tenant-id"] ?? "tenant-a";
    let body: unknown = {};
    if (
      request.method() === "POST" &&
      ["/api/v1/commercial-orders/orders", "/api/v1/commercial-orders/quotes"].includes(path)
    ) {
      bodies.push(request.postDataJSON());
      if (rejectCreation)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "COMMERCIAL_SOURCE_INVALID",
              message: "Source changed; review the existing draft.",
              requestId: "fixture"
            }
          }
        });
      return route.fulfill({
        status: 201,
        json: path.endsWith("quotes")
          ? { quote: { quote: { id: userId } } }
          : { order: { order: { id: userId } } }
      });
    }
    if (path === "/api/v1/commercial-orders") body = { orders: [] };
    if (path === "/api/v1/commercial-orders/quotes") body = { quotes: [] };
    if (path === `/api/v1/commercial-orders/orders/${userId}`)
      body = {
        order: {
          id: userId,
          order_number: "DRAFT-01",
          status: "DRAFT",
          currency_code: "USD",
          customer_id: userId
        },
        lines: [],
        allocations: [],
        fulfillments: [],
        shipments: []
      };
    if (path === `/api/v1/commercial-orders/quotes/${userId}`)
      body = {
        quote: {
          id: userId,
          quote_number: "DRAFT-01",
          status: "DRAFT",
          currency_code: "USD",
          customer_id: userId
        },
        lines: []
      };
    if (path === "/api/v1/lab-services/customers")
      body = { customers: [{ id: userId, displayName: "Fixture Customer", status: "ACTIVE" }] };
    if (path === "/api/v1/lab-services/service-orders")
      body = {
        serviceOrders: [serviceA, serviceB].map((id) => ({
          id,
          customerId: userId,
          serviceOrderNumber: id === serviceA ? "SERVICE-A" : "SERVICE-B",
          status: "CONFIRMED"
        }))
      };
    if (path === `/api/v1/lab-services/service-orders/${serviceA}`)
      body = { lines: [{ id: serviceA, title: "Current Service A line" }] };
    if (path === `/api/v1/lab-services/service-orders/${serviceB}`) {
      await new Promise<void>((resolve) => {
        releaseServiceB = resolve;
      });
      body = { lines: [{ id: serviceB, title: "Late Service B line" }] };
    }
    if (path === "/api/v1/project-operations/projects") body = { projects: [] };
    if (path === "/api/v1/materials" && failMaterialLookup) {
      failMaterialLookup = false;
      return route.fulfill({
        status: 503,
        json: {
          error: { code: "SOURCE_UNAVAILABLE", message: "Fixture outage", requestId: "fixture" }
        }
      });
    }
    if (path === "/api/v1/materials")
      body = { materials: [{ id: userId, displayName: "Fixture Material" }] };
    if (path === "/api/v1/me")
      body = {
        user: {
          id: userId,
          displayName: "Fixture",
          status: "ACTIVE",
          platformRoleKey: null,
          platformPermissions: []
        }
      };
    if (path === "/api/v1/me/tenants")
      body = {
        tenants: ["a", "b"].map((id) => ({
          roleKey: "TENANT_OWNER",
          tenant: { id: `tenant-${id}`, name: `Tenant ${id.toUpperCase()}`, slug: `tenant-${id}` }
        }))
      };
    if (path === "/api/v1/context")
      body = {
        tenant: { tenantId, roleKey: "TENANT_OWNER" },
        authorization: {
          tenantPermissions: [],
          modulePermissions: [
            "module.design-studio.studio.read",
            "module.design-studio.brief.manage",
            "module.trial-sensory.trial.read",
            "module.commercial-orders.read",
            "module.commercial-orders.order.create",
            "module.commercial-orders.quote.create"
          ]
        },
        entitlements: [],
        moduleAvailability: [
          { moduleId: "design-studio", state: "AVAILABLE", visible: true, enabled: true },
          { moduleId: "trial-sensory", state: "AVAILABLE", visible: true, enabled: true },
          { moduleId: "commercial-orders", state: "AVAILABLE", visible: true, enabled: true }
        ]
      };
    if (path === "/api/v1/materials/taxonomy")
      body = {
        taxonomy: {
          GRAND_FAMILIES: ["FLORAL"],
          SUBFAMILIES: [],
          DESCRIPTORS: [],
          TEXTURES: [],
          SENSATIONS: []
        }
      };
    if (path === "/api/v1/tenant")
      body = { tenant: { id: tenantId, name: tenantId, slug: tenantId, status: "ACTIVE" } };
    if (path === "/api/v1/tenant/members") body = { members: [] };
    if (path === "/api/v1/tenant/entitlements") body = { entitlements: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-only-not-a-credential");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Current tenant").selectOption("tenant-a");
  await page.getByRole("button", { name: "Design Studio", exact: true }).click();
  await page.getByRole("button", { name: /Complete Formula/ }).click();
  await page
    .getByRole("textbox", { name: "Creative brief", exact: true })
    .fill("Unsaved Tenant A direction");
  await page.getByLabel("Current tenant").selectOption("tenant-b");
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Current tenant")).toHaveValue("tenant-a");
  await expect(page.getByRole("textbox", { name: "Creative brief", exact: true })).toHaveValue(
    "Unsaved Tenant A direction"
  );
  await page.getByRole("button", { name: "Trial & Sensory", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/\/design-studio$/);
  await page.getByLabel("Current tenant").selectOption("tenant-b");
  await page.getByRole("button", { name: "Discard local edits and continue", exact: true }).click();
  await expect(page.getByLabel("Current tenant")).toHaveValue("tenant-b");
  await page.getByRole("button", { name: /Complete Formula/ }).click();
  await expect(page.getByRole("textbox", { name: "Creative brief", exact: true })).toHaveValue("");
  expect(mutations).toEqual([]);
  for (const kind of ["Order", "Quote"]) {
    rejectCreation = true;
    failMaterialLookup = true;
    await page.getByRole("button", { name: "Commercial Orders", exact: true }).click();
    if (kind === "Quote") await page.getByRole("link", { name: "Quotes", exact: true }).click();
    await page
      .getByRole("link", {
        name: kind === "Order" ? "New Commercial Order" : "New Quote",
        exact: true
      })
      .click();
    await page.getByRole("textbox", { name: `${kind} number`, exact: true }).fill("DRAFT-01");
    await page.getByLabel("Current tenant").selectOption("tenant-a");
    await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page.getByRole("textbox", { name: `${kind} number`, exact: true })).toHaveValue(
      "DRAFT-01"
    );
    await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption(userId);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Exact physical line");
    await expect(page.getByRole("alert")).toContainText("Materials lookup is unavailable");
    await expect(
      page.getByRole("combobox", { name: "Approved accessible Material", exact: true })
    ).toBeDisabled();
    await expect(page.getByText("No accessible Projects found.", { exact: true })).toBeVisible();
    const beforeRetry = { ...readCounts };
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("alert").scrollIntoViewIfNeeded();
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({
      path: `/tmp/nox-ui-v3/commercial-${kind.toLowerCase()}-lookup-error-mobile.png`
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Retry Materials", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Approved accessible Material", exact: true })
    ).toBeEnabled();
    expect(readCounts["/api/v1/materials"]).toBe(beforeRetry["/api/v1/materials"]! + 1);
    for (const path of [
      "/api/v1/lab-services/customers",
      "/api/v1/lab-services/service-orders",
      "/api/v1/project-operations/projects"
    ])
      expect(readCounts[path]).toBe(beforeRetry[path]);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Exact physical line"
    );
    await page
      .getByRole("combobox", { name: "Approved accessible Material", exact: true })
      .selectOption(userId);
    await page.getByRole("textbox", { name: "Quantity (mg)", exact: true }).fill("120001");
    await page
      .getByRole("textbox", { name: "Unit price (minor units)", exact: true })
      .fill("900719925474099312345");
    await page
      .getByRole("combobox", { name: "Line type", exact: true })
      .selectOption("SERVICE_SCOPE");
    const servicePicker = page.getByRole("combobox", { name: "Source Service Order", exact: true });
    const linePicker = page.getByRole("combobox", { name: "Service Order Line", exact: true });
    await servicePicker.selectOption(serviceA);
    await expect(linePicker.getByRole("option", { name: "Current Service A line" })).toHaveCount(1);
    await servicePicker.selectOption(serviceB);
    await expect(linePicker).toBeDisabled();
    await expect(linePicker.getByRole("option", { name: "Current Service A line" })).toHaveCount(0);
    await expect.poll(() => typeof releaseServiceB).toBe("function");
    await servicePicker.selectOption(serviceA);
    await expect(linePicker.getByRole("option", { name: "Current Service A line" })).toHaveCount(1);
    const lateResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/lab-services/service-orders/${serviceB}`)
    );
    releaseServiceB!();
    releaseServiceB = undefined;
    await lateResponse;
    await expect(linePicker.getByRole("option", { name: "Late Service B line" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Exact physical line"
    );
    await page.getByRole("combobox", { name: "Line type", exact: true }).selectOption("MATERIAL");
    await expect(page.getByRole("textbox", { name: "Quantity (mg)", exact: true })).toHaveValue(
      "120001"
    );
    await page.getByRole("button", { name: "Add line", exact: true }).click();
    await expect(
      page.getByRole("table", { name: "Draft commercial lines", exact: true })
    ).toContainText("120001 mg");
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
    const submit = page.getByRole("button", { name: `Create Draft ${kind}`, exact: true });
    const previous = bodies.length;
    // A partially authored second line cannot disappear from a successful submit.
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Unadded second line");
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("Finish adding the current line");
    expect(bodies).toHaveLength(previous);
    await page.getByRole("button", { name: "Clear unadded line", exact: true }).click();
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("Source changed");
    await expect(
      page.getByRole("table", { name: "Draft commercial lines", exact: true })
    ).toContainText("Exact physical line");
    expect(bodies.at(-1).lines[0]).toMatchObject({
      quantityValue: "120001",
      unitPriceMinor: "900719925474099312345",
      materialId: userId
    });
    expect(
      (await new AxeBuilder({ page }).include(".nox-commercial-workspace").analyze()).violations
    ).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({
      path: `/tmp/nox-ui-v3/commercial-${kind.toLowerCase()}-draft-error.png`
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator("#nox-workspace-panel").evaluate((element) => (element.scrollTop = 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await expect(page.getByRole("textbox", { name: `${kind} number`, exact: true })).toHaveValue(
      "DRAFT-01"
    );
    expect(
      (await new AxeBuilder({ page }).include(".nox-commercial-workspace").analyze()).violations
    ).toEqual([]);
    await page.screenshot({
      path: `/tmp/nox-ui-v3/commercial-${kind.toLowerCase()}-draft-mobile.png`
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    rejectCreation = false;
    await submit.click();
    await expect(page).toHaveURL(
      kind === "Order"
        ? new RegExp(`/commercial-orders/${userId}$`)
        : new RegExp(`/commercial-orders/quotes/${userId}$`)
    );
    await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toHaveCount(0);
    expect(bodies).toHaveLength(previous + 2);
  }
  expect(runtimeErrors).toEqual([]);
});
