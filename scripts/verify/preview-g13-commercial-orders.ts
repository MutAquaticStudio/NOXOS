import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createRuntimeDatabase, createStagingFixtureMaintenanceDatabase } from "@nox-os/database";
import { runG13Acceptance } from "./g13-commercial-acceptance.js";

type ApiResult<T = unknown> = { status: number; body: T };

const previewUrl = required("NOX_PREVIEW_URL");
const expectedSha = required("EXPECTED_SOURCE_SHA");
const email = required("NOX_PREVIEW_MATERIAL_USER_EMAIL");
const password = required("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const captureDirectory = process.env.G13_VISUAL_CAPTURE_DIR;
const projectRef = required("SUPABASE_PREVIEW_PROJECT_REF");
const actorUserId = required("NOX_PREVIEW_MATERIAL_USER_ID");
const runtimeDatabaseUrl = required("NOX_PREVIEW_RUNTIME_DATABASE_URL");
if (
  process.env.NOX_EXPECTED_ENV !== "preview" ||
  projectRef !== "uurkjmkhvtqydeikncaw" ||
  projectRef === required("SUPABASE_PRODUCTION_PROJECT_REF") ||
  decodeURIComponent(new URL(runtimeDatabaseUrl).username) !== `nox_app_runtime.${projectRef}`
)
  throw new Error("G13 Preview journey requires the isolated Preview project and runtime role.");
const runtime = createRuntimeDatabase({
  connectionUrl: runtimeDatabaseUrl,
  applicationName: "nox-os-g13-preview-acceptance",
  expectedRole: "nox_app_runtime"
});
const maintenance = createStagingFixtureMaintenanceDatabase({
  runtimeConnectionUrl: runtimeDatabaseUrl,
  projectRef,
  databasePassword: required("SUPABASE_PREVIEW_DB_PASSWORD")
});
let otherTenantId: string | undefined;

if (!/^[0-9a-f]{40}$/i.test(expectedSha))
  throw new Error("G13 Preview acceptance requires a full immutable source SHA.");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: bypassHeaders()
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await verifyIdentity(page);
  await signIn(page);
  const tenantId = await activeTenant(page);
  await selectTenant(page, tenantId);
  await assertAvailability(page, tenantId);
  const registry = await api<{ orders?: unknown[] }>(page, tenantId, "/commercial-orders");
  if (registry.status !== 200 || !Array.isArray(registry.body.orders))
    throw new Error("Commercial Orders authenticated API registry did not respond.");
  const forgedCreate = await api<{ error?: { code?: string } }>(
    page,
    tenantId,
    "/commercial-orders/orders",
    "POST",
    {
      orderNumber: "FORGED-G13-PREVIEW",
      customerId: "00000000-0000-0000-0000-000000000000",
      currencyCode: "USD",
      lines: [],
      tenantId: "00000000-0000-0000-0000-000000000001",
      actorUserId: "00000000-0000-0000-0000-000000000002"
    }
  );
  if (forgedCreate.status !== 400 || forgedCreate.body.error?.code !== "VALIDATION_FAILED")
    throw new Error("Commercial Orders did not reject forged browser authority.");

  await page.goto(url("/commercial-orders"), { waitUntil: "networkidle" });
  await selectTenant(page, tenantId);
  await visible(page, page.getByRole("heading", { name: "Commercial Orders" }));
  await capture(page, "commercial-orders-registry-desktop", "/commercial-orders");
  await page.goto(url("/commercial-orders/quotes"), { waitUntil: "networkidle" });
  await selectTenant(page, tenantId);
  await visible(page, page.getByRole("heading", { name: "Quotes" }));
  await page.goto(url("/commercial-orders/new"), { waitUntil: "networkidle" });
  await selectTenant(page, tenantId);
  await visible(page, page.getByRole("heading", { name: "Create Draft Commercial Order" }));
  await capture(page, "commercial-orders-authoring-desktop", "/commercial-orders/new");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const other = await api<{ tenant: { id: string } }>(page, tenantId, "/platform/tenants", "POST", {
    name: `G13 Preview Isolation ${suffix}`,
    slug: `g13-preview-${suffix}`,
    initialOwnerUserId: actorUserId
  });
  if (other.status !== 201) throw new Error("G13 Preview isolation tenant fixture failed.");
  otherTenantId = other.body.tenant.id;
  const disabled = await api(
    page,
    otherTenantId,
    `/platform/tenants/${otherTenantId}/members/${actorUserId}`,
    "PATCH",
    { status: "DISABLED" }
  );
  if (disabled.status !== 200)
    throw new Error(
      "G13 Preview isolation fixture could not disable the actor's second membership."
    );
  const enabled = await api(
    page,
    otherTenantId,
    `/platform/tenants/${otherTenantId}/entitlements/module.commercial-orders`,
    "PUT",
    { enabled: true }
  );
  if (enabled.status !== 200) throw new Error("G13 Preview isolation entitlement fixture failed.");
  const lot = (
    await runtime<{ id: string; material_id: string; location_id: string }[]>`
    with stock as (
      select lot_id, location_id, sum(quantity_mg) quantity from (
        select lot_id,to_location_id location_id,quantity_mg from inventory.stock_movements
        where tenant_id=${tenantId} and to_location_id is not null
        union all
        select lot_id,from_location_id,-quantity_mg from inventory.stock_movements
        where tenant_id=${tenantId} and from_location_id is not null
      ) movements group by lot_id,location_id
    )
    select lot.id::text,lot.material_id::text,stock.location_id::text
    from inventory.material_lots lot join stock on stock.lot_id=lot.id
    join inventory.locations location on location.id=stock.location_id and location.tenant_id=lot.tenant_id
    where lot.tenant_id=${tenantId} and lot.lifecycle_status='OPEN'
      and lot.availability_status='AVAILABLE' and location.status='ACTIVE'
      and (lot.expires_at is null or lot.expires_at>now())
      and stock.quantity-coalesce((select sum(quantity_mg) from inventory.stock_reservations r
        where r.tenant_id=lot.tenant_id and r.lot_id=lot.id and r.location_id=stock.location_id
          and r.status='ACTIVE'),0)>1000
    order by lot.created_at desc,lot.id desc limit 1
  `
  )[0];
  if (!lot)
    throw new Error("G13 Preview requires the G7 stock prepared by the existing Preview journey.");
  const actor = await accessToken(page);
  await runG13Acceptance({
    page,
    tenantA: tenantId,
    tenantB: otherTenantId,
    actor,
    otherActor: actor,
    actorUserId,
    suffix,
    runtime,
    maintenance,
    stock: { locationId: lot.location_id, lots: new Map([[lot.material_id, lot.id]]) },
    api: async <T>(
      auth: string,
      path: string,
      options: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; tenantId?: string } = {}
    ) => {
      const response = await fetch(url(`/api/v1${path}`), {
        method: options.method ?? "GET",
        headers: {
          ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {}),
          authorization: `Bearer ${auth}`,
          "x-nox-tenant-id": options.tenantId ?? tenantId,
          "content-type": "application/json"
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      return { status: response.status, body: (await response.json()) as T };
    },
    ensureActorPage: async () => {
      await selectTenant(page, tenantId);
    },
    baseUrl: previewUrl,
    expectedSourceSha: expectedSha,
    environment: "preview",
    g13VisualCaptureDirectory: captureDirectory
  });
} finally {
  await browser.close();
  try {
    const cleanupTenantId = otherTenantId;
    if (cleanupTenantId)
      await maintenance.begin(async (tx) => {
        await tx`delete from platform.tenant_entitlements where tenant_id=${cleanupTenantId}`;
        await tx`delete from platform.tenant_memberships where tenant_id=${cleanupTenantId}`;
        await tx`delete from platform.tenants where id=${cleanupTenantId}`;
      });
  } finally {
    await runtime.end({ timeout: 5 });
    await maintenance.end({ timeout: 5 });
  }
}

console.log("G13_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
console.log("G13_COMMERCIAL_ORDERS_API_AVAILABILITY=PASS");
console.log("G13_COMMERCIAL_ORDERS_UI_ACCEPTANCE=PASS");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for G13 Preview acceptance.`);
  return value;
}
function url(path: string) {
  return new URL(path, previewUrl).toString();
}
function bypassHeaders(): Record<string, string> | undefined {
  return protectionBypass
    ? {
        "x-vercel-protection-bypass": protectionBypass,
        "x-vercel-set-bypass-cookie": "true"
      }
    : undefined;
}
async function visible(page: Page, locator: ReturnType<Page["locator"]>) {
  await locator.first().waitFor({ state: "visible", timeout: 20_000 });
}
async function verifyIdentity(page: Page) {
  for (const path of ["/api/v1/health", "/api/v1/version"]) {
    const response = await page.request.get(url(path), { headers: bypassHeaders() });
    const body = (await response.json()) as { environment?: string; sourceSha?: string };
    if (!response.ok() || body.environment !== "preview" || body.sourceSha !== expectedSha)
      throw new Error(`G13 Preview identity failed for ${path}.`);
  }
}
async function signIn(page: Page) {
  await page.goto(url("/sign-in"), { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await visible(page, page.getByRole("navigation", { name: "Application modules" }));
}
async function accessToken(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    for (const raw of Object.values(localStorage)) {
      if (!raw.includes("access_token")) continue;
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed.access_token) return parsed.access_token;
    }
    return undefined;
  });
  if (!value) throw new Error("Authenticated Preview has no Supabase browser session.");
  return value;
}
async function api<T>(
  page: Page,
  tenantId: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<ApiResult<T>> {
  const token = await accessToken(page);
  return page.evaluate(
    async ({ path, method, body, tenantId, token }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "x-nox-tenant-id": tenantId,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body, tenantId, token }
  );
}
async function activeTenant(page: Page): Promise<string> {
  const result = await api<{ tenants?: Array<{ tenant?: { id?: string } }> }>(
    page,
    "00000000-0000-0000-0000-000000000000",
    "/me/tenants"
  );
  const tenantId = result.body.tenants?.[0]?.tenant?.id;
  if (result.status !== 200 || !tenantId)
    throw new Error("G13 Preview requires one active Tenant.");
  return tenantId;
}
async function selectTenant(page: Page, tenantId: string) {
  const selector = page.getByLabel("Current tenant");
  await visible(page, selector);
  if ((await selector.inputValue()) !== tenantId) await selector.selectOption(tenantId);
}
async function assertAvailability(page: Page, tenantId: string) {
  const context = await api<{
    moduleAvailability?: Array<{ moduleId: string; state: string }>;
    authorization?: { modulePermissions?: string[] };
  }>(page, tenantId, "/context");
  if (
    context.status !== 200 ||
    context.body.moduleAvailability?.find((item) => item.moduleId === "commercial-orders")
      ?.state !== "AVAILABLE" ||
    !context.body.authorization?.modulePermissions?.includes(
      "module.commercial-orders.order.create"
    )
  )
    throw new Error("Commercial Orders is not available with expected server permissions.");
  const denied = await page.request.get(url("/api/v1/commercial-orders"), {
    headers: {
      ...(bypassHeaders() ?? {}),
      "x-nox-tenant-id": tenantId,
      "x-role": "TENANT_OWNER",
      "x-permission": "module.commercial-orders.read"
    }
  });
  if (denied.status() !== 401)
    throw new Error("Forged authority headers affected an unauthenticated G13 request.");
}
async function capture(page: Page, name: string, route: string) {
  if (!captureDirectory) return;
  await mkdir(captureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(captureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(captureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSha, environment: "preview" },
      null,
      2
    ) + "\n"
  );
}
