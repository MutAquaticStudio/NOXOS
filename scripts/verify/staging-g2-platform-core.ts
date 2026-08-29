import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createRuntimeDatabase, createStagingFixtureMaintenanceDatabase } from "@nox-os/database";
import { createPlatformCoreApi } from "@nox-os/platform";

type FixtureUserKey = "P" | "A" | "B" | "C" | "D" | "E" | "F";
type FixtureUser = { id: string; email: string; password: string };
type ApiResult = { status: number; body: any };

const raw = process.env;
const stagingUrl = required("NOX_STAGING_URL");
const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const stagingProjectRef = required("SUPABASE_STAGING_PROJECT_REF");
const productionProjectRef = required("SUPABASE_PRODUCTION_PROJECT_REF");
const databasePassword = required("SUPABASE_DB_PASSWORD");
const runtimeDatabaseUrl = required("NOX_RUNTIME_DATABASE_URL");
const protectionBypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");

if (raw.NOX_EXPECTED_ENV !== "staging" || stagingProjectRef === productionProjectRef) {
  throw new Error("G2 fixture acceptance may target only the isolated Staging project.");
}
if (new URL(supabaseUrl).hostname !== `${stagingProjectRef}.supabase.co`) {
  throw new Error("G2 fixture acceptance requires the declared Staging Supabase project.");
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
const password = `Nox-G2-${suffix}!`;
const fixtures = new Map<FixtureUserKey, FixtureUser>();
const tokens = new Map<FixtureUserKey, string>();
const tenantIds: string[] = [];
const runtime = createRuntimeDatabase({
  connectionUrl: runtimeDatabaseUrl,
  applicationName: "nox-os-g2-staging-fixture",
  expectedRole: "nox_app_runtime"
});
const maintenance = createStagingFixtureMaintenanceDatabase({
  runtimeConnectionUrl: runtimeDatabaseUrl,
  projectRef: stagingProjectRef,
  databasePassword
});

try {
  for (const key of ["P", "A", "B", "C", "D", "E", "F"] as const) {
    fixtures.set(key, await createAuthFixture(key));
  }

  const platformOwner = fixture("P");
  const core = createPlatformCoreApi({
    store: (await import("@nox-os/database")).createPostgresPlatformStore(runtime),
    accessTokenVerifier: {
      async verifyAccessToken() {
        return { kind: "AUTH_INVALID" as const };
      }
    }
  });
  await core.bootstrapPlatformOwner({
    userId: platformOwner.id,
    requestId: `g2-bootstrap-${suffix}`,
    correlationId: `g2-bootstrap-${suffix}`
  });

  for (const key of ["P", "A", "B", "C", "D", "E", "F"] as const) {
    tokens.set(key, await signIn(fixture(key)));
  }
  const p = token("P");

  for (const key of ["A", "B", "C", "D", "E", "F"] as const) {
    expectStatus(
      await api(p, "/platform/users", {
        method: "POST",
        body: { userId: fixture(key).id, displayName: `G2 fixture ${key}` }
      }),
      201,
      "PlatformUser provision"
    );
  }

  const tenantA = await createTenant(p, "A", "tenant-a");
  const tenantB = await createTenant(p, "B", "tenant-b");
  await addMembership(p, tenantA, "C", "TENANT_MEMBER");
  await addMembership(p, tenantA, "D", "TENANT_ADMIN");
  await addMembership(p, tenantB, "D", "TENANT_MEMBER");
  await addMembership(p, tenantA, "E", "TENANT_MEMBER");
  expectStatus(
    await api(p, `/platform/tenants/${tenantA}/members/${fixture("E").id}`, {
      method: "PATCH",
      body: { status: "DISABLED" }
    }),
    200,
    "Disabled membership fixture"
  );

  expectStatus(await api(p, "/platform/users"), 200, "PlatformOwner users list");
  expectStatus(await api(p, "/platform/tenants"), 200, "PlatformOwner tenant list");
  expectStatus(await api(p, "/platform/audit"), 200, "PlatformOwner audit list");
  expectError(
    await api(p, "/tenant", { tenantId: tenantA }),
    403,
    "TENANT_ACCESS_DENIED",
    "PlatformOwner must not bypass tenant membership"
  );
  expectError(
    await api(token("A"), "/platform/tenants"),
    403,
    "PLATFORM_ACCESS_DENIED",
    "Tenant Owner must not access platform console"
  );
  expectError(
    await api(token("F"), "/platform/tenants", {
      headers: {
        "x-role": "PLATFORM_OWNER",
        "x-permission": "platform.tenant.read",
        "x-permissions": "platform.tenant.read",
        "x-is-admin": "true",
        "x-is-owner": "true",
        "x-platform-role": "PLATFORM_OWNER",
        "x-user-id": platformOwner.id
      }
    }),
    403,
    "PLATFORM_ACCESS_DENIED",
    "Forged authority headers"
  );

  expectStatus(await api(token("A"), "/tenant", { tenantId: tenantA }), 200, "A to Tenant A");
  expectError(
    await api(token("A"), "/tenant", { tenantId: tenantB }),
    403,
    "TENANT_ACCESS_DENIED",
    "A to Tenant B"
  );
  expectStatus(await api(token("B"), "/tenant", { tenantId: tenantB }), 200, "B to Tenant B");
  expectError(
    await api(token("B"), "/tenant", { tenantId: tenantA }),
    403,
    "TENANT_ACCESS_DENIED",
    "B to Tenant A"
  );
  expectContextRole(token("D"), tenantA, "TENANT_ADMIN");
  expectContextRole(token("D"), tenantB, "TENANT_MEMBER");
  expectError(
    await api(token("D"), "/tenant", {
      method: "PATCH",
      tenantId: tenantA,
      body: { name: "Denied" }
    }),
    403,
    "PERMISSION_DENIED",
    "TenantAdmin profile mutation"
  );
  expectError(
    await api(token("C"), `/tenant/members/${fixture("D").id}`, {
      method: "PATCH",
      tenantId: tenantA,
      body: { roleKey: "TENANT_MEMBER" }
    }),
    403,
    "PERMISSION_DENIED",
    "TenantMember mutation"
  );

  expectError(
    await api(p, `/platform/users/${platformOwner.id}`, {
      method: "PATCH",
      body: { platformRoleKey: null }
    }),
    409,
    "LAST_ACTIVE_PLATFORM_OWNER_REQUIRED",
    "Last PlatformOwner removal"
  );
  expectError(
    await api(p, `/platform/users/${platformOwner.id}`, {
      method: "PATCH",
      body: { status: "DISABLED" }
    }),
    409,
    "LAST_ACTIVE_PLATFORM_OWNER_REQUIRED",
    "Last PlatformOwner disable"
  );
  expectError(
    await api(p, `/platform/users/${fixture("A").id}`, {
      method: "PATCH",
      body: { status: "DISABLED" }
    }),
    409,
    "TENANT_OWNER_DEPENDENCY_EXISTS",
    "PlatformUser owner dependency"
  );
  expectError(
    await api(token("A"), `/tenant/members/${fixture("A").id}`, {
      method: "PATCH",
      tenantId: tenantA,
      body: { roleKey: "TENANT_MEMBER" }
    }),
    409,
    "LAST_ACTIVE_TENANT_OWNER_REQUIRED",
    "Last TenantOwner demotion"
  );
  expectError(
    await api(token("A"), `/tenant/members/${fixture("A").id}`, {
      method: "PATCH",
      tenantId: tenantA,
      body: { status: "DISABLED" }
    }),
    409,
    "LAST_ACTIVE_TENANT_OWNER_REQUIRED",
    "Last TenantOwner disable"
  );

  await browserAcceptanceBeforeTenantC();

  expectStatus(
    await api(p, "/platform/tenants", {
      method: "POST",
      body: {
        name: "Tenant C",
        slug: `tenant-c-${suffix.slice(0, 8)}`,
        initialOwnerUserId: fixture("F").id
      }
    }),
    201,
    "Atomic Tenant C creation"
  );
  const tenants = await api<{ tenants: Array<{ id: string; slug: string }> }>(
    p,
    "/platform/tenants"
  );
  const tenantC = tenants.body.tenants.find((entry: { id: string; slug: string }) =>
    entry.slug.startsWith("tenant-c-")
  )?.id;
  if (!tenantC) throw new Error("Tenant C atomic creation did not return a durable tenant.");
  tenantIds.push(tenantC);
  expectStatus(
    await api(p, `/platform/tenants/${tenantC}/entitlements/module.foundation-test`, {
      method: "PUT",
      body: { enabled: true }
    }),
    200,
    "Foundation entitlement enable"
  );
  const enabledContext = await api<any>(token("F"), "/context", { tenantId: tenantC });
  expectStatus(enabledContext, 200, "Foundation module context");
  if (moduleAvailabilityState(enabledContext.body, "foundation-test") !== "AVAILABLE") {
    throw new Error(
      "Module availability did not become AVAILABLE for an entitled permitted owner."
    );
  }
  expectStatus(
    await api(p, `/platform/tenants/${tenantC}/entitlements/module.foundation-test`, {
      method: "PUT",
      body: { enabled: false }
    }),
    200,
    "Foundation entitlement disable"
  );
  const disabledContext = await api<any>(token("F"), "/context", { tenantId: tenantC });
  if (moduleAvailabilityState(disabledContext.body, "foundation-test") !== "NOT_ENTITLED") {
    throw new Error("Module availability did not become NOT_ENTITLED after entitlement removal.");
  }

  await addMembership(p, tenantA, "P", "TENANT_OWNER");
  expectStatus(
    await api(token("A"), "/tenant", {
      method: "PATCH",
      tenantId: tenantA,
      body: { name: "Tenant A G2" }
    }),
    200,
    "Tenant profile update"
  );
  expectStatus(
    await api(token("A"), `/tenant/members/${fixture("C").id}`, {
      method: "PATCH",
      tenantId: tenantA,
      body: { roleKey: "TENANT_ADMIN" }
    }),
    200,
    "Tenant membership role update"
  );
  expectStatus(
    await api(token("A"), `/tenant/members/${fixture("C").id}`, {
      method: "PATCH",
      tenantId: tenantA,
      body: { status: "DISABLED" }
    }),
    200,
    "Tenant membership status update"
  );
  expectStatus(
    await api(p, `/platform/tenants/${tenantB}`, {
      method: "PATCH",
      body: { status: "SUSPENDED" }
    }),
    200,
    "Platform tenant status update"
  );
  expectStatus(
    await api(p, `/platform/tenants/${tenantB}`, { method: "PATCH", body: { status: "ACTIVE" } }),
    200,
    "Platform tenant status restore"
  );
  expectStatus(
    await api(p, `/platform/users/${fixture("F").id}`, {
      method: "PATCH",
      body: { status: "DISABLED" }
    }),
    200,
    "Platform user status update"
  );
  expectStatus(
    await api(p, `/platform/users/${fixture("F").id}`, {
      method: "PATCH",
      body: { status: "ACTIVE" }
    }),
    200,
    "Platform user restore"
  );
  expectStatus(
    await api(p, `/platform/tenants/${tenantA}/members/${fixture("D").id}`, {
      method: "PATCH",
      body: { roleKey: "TENANT_MEMBER" }
    }),
    200,
    "Platform membership role update"
  );
  expectStatus(
    await api(p, `/platform/users/${fixture("F").id}`, {
      method: "PATCH",
      body: { platformRoleKey: "PLATFORM_OWNER" }
    }),
    200,
    "Platform role update"
  );

  const audit = await api<{ events: Array<{ action: string; metadata?: unknown }> }>(
    p,
    "/platform/audit?limit=100&offset=0"
  );
  expectStatus(audit, 200, "Platform audit read");
  for (const action of [
    "platform.user.provision",
    "platform.user.status.update",
    "platform.user.role.update",
    "platform.tenant.create",
    "platform.tenant.status.update",
    "platform.membership.create",
    "platform.membership.status.update",
    "platform.entitlement.update",
    "tenant.profile.update",
    "tenant.membership.role.update",
    "tenant.membership.status.update"
  ]) {
    if (!audit.body.events.some((event: { action: string }) => event.action === action)) {
      throw new Error("Required audit action was not recorded: " + action);
    }
  }
  if (
    audit.body.events.some((event: { action: string; metadata?: unknown }) => "metadata" in event)
  ) {
    throw new Error("Audit API exposed raw metadata.");
  }

  await verifyOwnerConcurrency(tenantC);
  console.log("G2_STAGING_PLATFORM_ACCEPTANCE=PASS");
} finally {
  await cleanupFixtures();
  await runtime.end({ timeout: 5 });
  await maintenance.end({ timeout: 5 });
}

function required(name: string): string {
  const value = raw[name];
  if (!value) throw new Error(name + " is required for G2 Staging acceptance.");
  return value;
}

function fixture(key: FixtureUserKey): FixtureUser {
  const value = fixtures.get(key);
  if (!value) throw new Error("Required fixture was not created.");
  return value;
}

function token(key: FixtureUserKey): string {
  const value = tokens.get(key);
  if (!value) throw new Error("Fixture token was not issued.");
  return value;
}

async function createAuthFixture(key: FixtureUserKey): Promise<FixtureUser> {
  const email = `nox-g2-${suffix}-${key.toLowerCase()}@example.test`;
  const response = await fetch(new URL("/auth/v1/admin/users", supabaseUrl), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const body = await response.json().catch(() => undefined);
  const id = body?.id ?? body?.user?.id;
  if (!response.ok || typeof id !== "string") {
    throw new Error("Staging Auth fixture provisioning failed.");
  }
  return { id, email, password };
}

async function signIn(user: FixtureUser): Promise<string> {
  const response = await fetch(new URL("/auth/v1/token?grant_type=password", supabaseUrl), {
    method: "POST",
    headers: { ...adminHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password })
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || typeof body?.access_token !== "string") {
    throw new Error("Staging Auth fixture sign-in failed.");
  }
  return body.access_token;
}

function adminHeaders(): Record<string, string> {
  return { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
}

async function api<T = unknown>(
  accessToken: string,
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT";
    body?: unknown;
    tenantId?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<ApiResult & { body: T }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "x-vercel-protection-bypass": protectionBypass,
    "x-correlation-id": `g2-${suffix}`,
    ...options.headers
  };
  if (options.tenantId) headers["x-nox-tenant-id"] = options.tenantId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL("/api/v1" + path, stagingUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return {
    status: response.status,
    body: await response.json().catch(() => undefined)
  } as ApiResult & {
    body: T;
  };
}

function expectStatus(result: ApiResult, expected: number, label: string): void {
  if (result.status !== expected) {
    throw new Error(label + " returned unexpected status " + result.status + ".");
  }
}

function expectError(result: ApiResult, status: number, code: string, label: string): void {
  if (result.status !== status || result.body?.error?.code !== code) {
    throw new Error(label + " did not fail closed with " + status + " " + code + ".");
  }
}

async function createTenant(
  accessToken: string,
  owner: FixtureUserKey,
  slug: string
): Promise<string> {
  const result = await api<{ tenant: { id: string } }>(accessToken, "/platform/tenants", {
    method: "POST",
    body: {
      name: `Tenant ${owner}`,
      slug: `${slug}-${suffix.slice(0, 8)}`,
      initialOwnerUserId: fixture(owner).id
    }
  });
  expectStatus(result, 201, "Tenant creation");
  const id = result.body.tenant?.id;
  if (typeof id !== "string") throw new Error("Tenant creation did not return an identifier.");
  tenantIds.push(id);
  return id;
}

async function addMembership(
  accessToken: string,
  tenantId: string,
  user: FixtureUserKey,
  roleKey: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_MEMBER"
): Promise<void> {
  expectStatus(
    await api(accessToken, `/platform/tenants/${tenantId}/members`, {
      method: "POST",
      body: { userId: fixture(user).id, roleKey }
    }),
    201,
    "Platform membership creation"
  );
}

async function expectContextRole(
  accessToken: string,
  tenantId: string,
  role: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_MEMBER"
): Promise<void> {
  const result = await api<{ tenant: { roleKey: string } }>(accessToken, "/context", { tenantId });
  expectStatus(result, 200, "Tenant context");
  if (result.body.tenant?.roleKey !== role) {
    throw new Error("Tenant switch retained incorrect role state.");
  }
}

function moduleAvailabilityState(payload: any, moduleId: string): string | undefined {
  return payload.moduleAvailability?.find(
    (entry: { moduleId?: string }) => entry.moduleId === moduleId
  )?.state;
}

async function browserAcceptanceBeforeTenantC(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const headers = {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true"
    };
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      extraHTTPHeaders: headers
    });
    await signInInBrowser(page, fixture("F"));
    await expectVisible(page, "NO ACTIVE WORKSPACE AVAILABLE");
    await signOutInBrowser(page, fixture("F"));

    await signInInBrowser(page, fixture("P"));
    const platformConsole = page.getByRole("button", { name: "Platform Console" });
    await platformConsole.waitFor({ state: "visible" });
    await platformConsole.click();
    await expectVisible(page, "Platform tenants");
    await page.goto(new URL("/platform/users", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await expectVisible(page, "Platform users");
    await page.goto(new URL("/platform/audit", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await expectVisible(page, "Platform audit");
    await signOutInBrowser(page, fixture("P"));

    await signInInBrowser(page, fixture("A"));
    await expectVisible(page, "Tenant settings");
    await expectVisible(page, "Members");
    if (await page.getByRole("button", { name: "Platform Console" }).count()) {
      throw new Error("Platform Console was visible to a non-PlatformOwner.");
    }
    await page.goto(new URL("/platform/tenants", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await expectVisible(page, "Platform Console access denied");
    await signOutInBrowser(page, fixture("A"));

    await signInInBrowser(page, fixture("D"));
    const selector = page.getByLabel("Current tenant");
    if ((await selector.locator("option").count()) < 3) {
      throw new Error("Multi-tenant selector did not expose both memberships.");
    }
    await selector.selectOption({ index: 1 });
    await page.waitForTimeout(150);
    await selector.selectOption({ index: 2 });
    await page.waitForTimeout(150);
    await expectVisible(page, "Tenant settings");
    await signOutInBrowser(page, fixture("D"));
  } finally {
    await browser.close();
  }
}

async function signInInBrowser(page: any, user: FixtureUser): Promise<void> {
  await page.goto(new URL("/sign-in", stagingUrl).toString(), { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "User menu" }).waitFor({ state: "visible" });
}

async function signOutInBrowser(page: any, _user: FixtureUser): Promise<void> {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.waitForURL(/\/sign-in$/);
}

async function expectVisible(page: any, name: string): Promise<void> {
  if (!(await page.getByText(name, { exact: true }).isVisible())) {
    throw new Error("Staging browser acceptance did not render " + name + ".");
  }
}

async function verifyOwnerConcurrency(tenantC: string): Promise<void> {
  const p = token("P");
  const f = token("F");
  expectStatus(
    await api(p, `/platform/users/${fixture("F").id}`, {
      method: "PATCH",
      body: { platformRoleKey: "PLATFORM_OWNER" }
    }),
    200,
    "Second PlatformOwner grant"
  );
  const platformResults = await Promise.all([
    api(p, `/platform/users/${fixture("P").id}`, {
      method: "PATCH",
      body: { platformRoleKey: null }
    }),
    api(f, `/platform/users/${fixture("F").id}`, {
      method: "PATCH",
      body: { platformRoleKey: null }
    })
  ]);
  const statuses = platformResults.map((result) => result.status).sort();
  if (statuses.join(",") !== "200,409") {
    throw new Error("Concurrent PlatformOwner mutation could not prove owner preservation.");
  }

  await addMembership(token("P"), tenantC, "P", "TENANT_OWNER");
  const tenantResults = await Promise.all([
    api(token("P"), `/tenant/members/${fixture("P").id}`, {
      method: "PATCH",
      tenantId: tenantC,
      body: { roleKey: "TENANT_MEMBER" }
    }),
    api(token("F"), `/tenant/members/${fixture("F").id}`, {
      method: "PATCH",
      tenantId: tenantC,
      body: { roleKey: "TENANT_MEMBER" }
    })
  ]);
  const tenantStatuses = tenantResults.map((result) => result.status).sort();
  if (tenantStatuses.join(",") !== "200,409") {
    throw new Error("Concurrent TenantOwner mutation could not prove owner preservation.");
  }
}

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtures.values()].map((user) => user.id);
  try {
    if (userIds.length > 0 || tenantIds.length > 0) {
      await maintenance.begin(async (transaction) => {
        for (const userId of userIds) {
          await transaction`delete from platform.audit_events where actor_user_id = ${userId}`;
        }
        for (const tenantId of tenantIds) {
          await transaction`delete from platform.audit_events where tenant_id = ${tenantId}`;
        }
        await transaction`
          delete from platform.audit_events
          where actor_user_id is null
            and tenant_id is null
            and request_id = ${`g2-bootstrap-${suffix}`}
        `;
        for (const tenantId of tenantIds) {
          await transaction`delete from platform.tenant_entitlements where tenant_id = ${tenantId}`;
          await transaction`delete from platform.tenant_memberships where tenant_id = ${tenantId}`;
          await transaction`delete from platform.tenants where id = ${tenantId}`;
        }
        for (const userId of userIds) {
          await transaction`delete from platform.platform_users where id = ${userId}`;
        }
      });
    }
  } catch {
    throw new Error("G2 Staging database fixture cleanup failed.");
  }
  try {
    for (const user of fixtures.values()) {
      const response = await fetch(new URL(`/auth/v1/admin/users/${user.id}`, supabaseUrl), {
        method: "DELETE",
        headers: adminHeaders()
      });
      if (!response.ok) throw new Error("Staging Auth fixture cleanup failed.");
    }
  } catch {
    throw new Error("G2 Staging Auth fixture cleanup failed.");
  }
}
