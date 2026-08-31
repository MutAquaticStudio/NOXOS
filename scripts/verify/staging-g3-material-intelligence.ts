import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import {
  createPostgresPlatformStore,
  createRuntimeDatabase,
  createStagingFixtureMaintenanceDatabase
} from "@nox-os/database";
import { createPlatformCoreApi } from "@nox-os/platform";

type FixtureKey = "A" | "B" | "C" | "D" | "E";
type FixtureUser = { id: string; email: string; password: string };
type ApiResult<T = unknown> = { status: number; body: T };
type MaterialSummary = {
  id: string;
  displayName: string;
  approvalStatus: "PENDING_REVIEW" | "APPROVED";
  contributor?: { tenantName?: string; userId?: string };
};
type ChangeSummary = { id: string; status: string };

const raw = process.env;
const stagingUrl = required("NOX_STAGING_URL");
const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const stagingProjectRef = required("SUPABASE_STAGING_PROJECT_REF");
const productionProjectRef = required("SUPABASE_PRODUCTION_PROJECT_REF");
const databasePassword = required("SUPABASE_DB_PASSWORD");
const runtimeDatabaseUrl = required("NOX_RUNTIME_DATABASE_URL");
const protectionBypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");
const expectedSourceSha = required("EXPECTED_SOURCE_SHA");
const visualCaptureDirectory = process.env.G3_VISUAL_CAPTURE_DIR;

if (raw.NOX_EXPECTED_ENV !== "staging" || stagingProjectRef === productionProjectRef) {
  throw new Error("G3 fixture acceptance may target only the isolated Staging project.");
}
if (new URL(supabaseUrl).hostname !== `${stagingProjectRef}.supabase.co`) {
  throw new Error("G3 fixture acceptance requires the declared Staging Supabase project.");
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
const password = `Nox-G3-${suffix}!`;
const fixtures = new Map<FixtureKey, FixtureUser>();
const tokens = new Map<FixtureKey, string>();
const tenantIds: string[] = [];
const materialIds: string[] = [];
const runtime = createRuntimeDatabase({
  connectionUrl: runtimeDatabaseUrl,
  applicationName: "nox-os-g3-staging-fixture",
  expectedRole: "nox_app_runtime"
});
const maintenance = createStagingFixtureMaintenanceDatabase({
  runtimeConnectionUrl: runtimeDatabaseUrl,
  projectRef: stagingProjectRef,
  databasePassword
});

try {
  for (const key of ["A", "B", "C", "D", "E"] as const) {
    fixtures.set(key, await createAuthFixture(key));
  }

  const platform = createPlatformCoreApi({
    store: createPostgresPlatformStore(runtime),
    accessTokenVerifier: {
      async verifyAccessToken() {
        return { kind: "AUTH_INVALID" as const };
      }
    }
  });
  await platform.bootstrapPlatformOwner({
    userId: fixture("D").id,
    requestId: `g3-bootstrap-${suffix}`,
    correlationId: `g3-bootstrap-${suffix}`
  });
  for (const key of ["A", "B", "C", "D", "E"] as const) tokens.set(key, await signIn(fixture(key)));

  const platformOwnerToken = token("D");
  for (const key of ["A", "B", "C", "E"] as const) {
    expectStatus(
      await api(platformOwnerToken, "/platform/users", {
        method: "POST",
        body: { userId: fixture(key).id, displayName: `G3 ${key}` }
      }),
      201,
      "PlatformUser provisioning"
    );
  }

  const tenantA = await createTenant(platformOwnerToken, "Tenant A", "B");
  const tenantB = await createTenant(platformOwnerToken, "Tenant B", "E");
  await addMembership(platformOwnerToken, tenantA, "A", "TENANT_MEMBER");
  await addMembership(platformOwnerToken, tenantB, "C", "TENANT_MEMBER");
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.material-intelligence`,
        {
          method: "PUT",
          body: { enabled: true }
        }
      ),
      200,
      "Material Intelligence entitlement"
    );
  }
  const materialContext = await api<{
    moduleAvailability: Array<{ moduleId: string; state: string }>;
  }>(token("A"), "/context", { tenantId: tenantA });
  expectStatus(materialContext, 200, "Material tenant context");
  if (
    materialContext.body.moduleAvailability.find(
      (entry) => entry.moduleId === "material-intelligence"
    )?.state !== "AVAILABLE"
  ) {
    throw new Error("Material Intelligence was not AVAILABLE for an entitled tenant actor.");
  }

  const referenceMaterial = await seedPlatformReferenceMaterial();
  const privateTenantB = await createPrivateTenantBMaterial(tenantB);
  materialIds.push(referenceMaterial.id, privateTenantB.id);
  expectStatus(
    await api(
      token("E"),
      `/material-change-requests/${await latestPendingRequest(token("E"), tenantB, privateTenantB.id)}/approve`,
      { method: "POST", tenantId: tenantB, body: {} }
    ),
    200,
    "Tenant B private Material approval"
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      extraHTTPHeaders: bypassHeaders()
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

    const mixtureName = `G3 Mixture ${suffix.slice(0, 8)}`;
    await signInInBrowser(page, fixture("A"));
    await page.goto(new URL("/materials", stagingUrl).toString(), { waitUntil: "networkidle" });
    await expectVisible(page, "Material registry");
    await capture(page, "materials-registry-desktop", "/materials");
    await page.goto(new URL("/materials/new", stagingUrl).toString(), { waitUntil: "networkidle" });
    await expectVisible(page, "Add Material");
    await capture(page, "material-create-desktop", "/materials/new");
    await page.getByLabel("Material name").fill(mixtureName);
    await page.getByLabel("Material type").selectOption("MIXTURE");
    await page.getByLabel("Grand family").selectOption("Floral");
    await page.getByLabel("Subfamily").selectOption("Floral Others");
    await page.getByLabel("Descriptor").selectOption("Jasminy");
    await page.getByLabel("Texture").selectOption("Delicate");
    await page.getByLabel("Sensation").selectOption("Clean");
    await page.getByLabel("Intensity (1–10)").fill("6");
    await page.getByLabel("Note classification").selectOption("MID");
    await page.getByRole("button", { name: "Add known component" }).click();
    await page.getByLabel("Search Component 1").fill(referenceMaterial.displayName);
    await page.getByRole("button", { name: new RegExp(referenceMaterial.displayName) }).click();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.getByRole("heading", { name: mixtureName }).waitFor({ state: "visible" });
    await capture(
      page,
      "material-detail-desktop",
      `/materials/${createdMaterialIdFromUrl(page.url())}`
    );
    await signOutInBrowser(page);
    await refreshToken("A");

    const created = await findMaterial(token("A"), tenantA, mixtureName);
    materialIds.push(created.id);
    if (created.approvalStatus !== "PENDING_REVIEW") {
      throw new Error("Tenant Material creation did not remain PENDING_REVIEW.");
    }
    expectError(
      await api(
        token("A"),
        `/material-change-requests/${await latestPendingRequest(token("A"), tenantA, created.id)}/approve`,
        {
          method: "POST",
          tenantId: tenantA,
          body: {}
        }
      ),
      403,
      "PERMISSION_DENIED",
      "Normal tenant user approval"
    );
    expectError(
      await api(token("A"), `/materials/${privateTenantB.id}`, { tenantId: tenantA }),
      404,
      "NOT_FOUND",
      "Cross-tenant private Material access"
    );

    await signInInBrowser(page, fixture("B"));
    await page.goto(new URL("/materials/review", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await expectVisible(page, "Material review");
    await capture(page, "tenant-review-desktop", "/materials/review");
    await page.getByRole("link", { name: "Open review" }).click();
    await page.getByRole("heading", { name: mixtureName }).waitFor({ state: "visible" });
    await capture(page, "tenant-review-detail-desktop", page.url().replace(stagingUrl, ""));
    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL(/\/materials\/review$/);
    await signOutInBrowser(page);
    await refreshToken("B");

    const approved = await api<{ material: MaterialSummary }>(
      token("A"),
      `/materials/${created.id}`,
      {
        tenantId: tenantA
      }
    );
    expectStatus(approved, 200, "Approved Material read");
    if (approved.body.material.approvalStatus !== "APPROVED") {
      throw new Error("Tenant approver did not resolve Material approval.");
    }

    const dilution = await api<{ material: MaterialSummary }>(token("A"), "/materials", {
      method: "POST",
      tenantId: tenantA,
      body: {
        displayName: `Ambroxan 10% TEC ${suffix.slice(0, 8)}`,
        materialType: "DILUTION",
        odorAssignments: [],
        concentrate: {
          sourceMaterialId: referenceMaterial.id,
          concentrationPct: 10,
          solventMaterialId: null,
          solventCustomName: "TEC"
        }
      }
    });
    expectStatus(dilution, 201, "Dilution Material creation");
    materialIds.push(dilution.body.material.id);
    expectStatus(
      await api(
        token("B"),
        `/material-change-requests/${await latestPendingRequest(token("B"), tenantA, dilution.body.material.id)}/approve`,
        { method: "POST", tenantId: tenantA, body: {} }
      ),
      200,
      "Dilution Material approval"
    );
    const approvedDilution = await api<{
      material: MaterialSummary & {
        concentrate?: {
          sourceMaterialId: string;
          concentrationPct: number;
          solventCustomName: string | null;
        };
        components?: unknown[];
      };
    }>(token("A"), `/materials/${dilution.body.material.id}`, { tenantId: tenantA });
    expectStatus(approvedDilution, 200, "Approved Dilution read");
    if (
      approvedDilution.body.material.concentrate?.sourceMaterialId !== referenceMaterial.id ||
      approvedDilution.body.material.concentrate?.concentrationPct !== 10 ||
      approvedDilution.body.material.concentrate?.solventCustomName !== "TEC" ||
      approvedDilution.body.material.components?.length !== 0
    ) {
      throw new Error(
        "Dilution acceptance requires structured source, 10% concentration, TEC, and no components."
      );
    }
    await signInInBrowser(page, fixture("A"));
    await page.goto(new URL(`/materials/${dilution.body.material.id}`, stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await expectHeading(page, "Concentration");
    await expectVisible(page, referenceMaterial.displayName);
    await expectVisible(page, "10%");
    await expectVisible(page, "TEC");
    await capture(page, "dilution-detail-desktop", `/materials/${dilution.body.material.id}`);
    await signOutInBrowser(page);
    await refreshToken("A");

    const history = await api<{ history: Array<{ action: string }> }>(
      token("A"),
      `/materials/${created.id}/history`,
      { tenantId: tenantA }
    );
    expectStatus(history, 200, "Material audit history");
    if (
      !history.body.history.some(
        (event) => event.action === "module.material-intelligence.change.approve"
      )
    ) {
      throw new Error("Material approval did not project to G2 AuditEvent history.");
    }

    const shareRequest = await api<{ changeRequest: ChangeSummary }>(
      token("A"),
      `/materials/${created.id}/change-requests`,
      { method: "POST", tenantId: tenantA, body: { requestType: "GENERAL", visibility: "SHARED" } }
    );
    expectStatus(shareRequest, 201, "Material sharing request");
    expectStatus(
      await api(
        token("B"),
        `/material-change-requests/${shareRequest.body.changeRequest.id}/approve`,
        {
          method: "POST",
          tenantId: tenantA,
          body: {}
        }
      ),
      200,
      "Material sharing approval"
    );

    await signInInBrowser(page, fixture("C"));
    await page.goto(new URL(`/materials/${created.id}`, stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await page.getByRole("heading", { name: mixtureName }).waitFor({ state: "visible" });
    await expectVisible(page, "Tenant A");
    const crossTenantText = await page.locator("main").innerText();
    if (crossTenantText.includes(fixture("A").id) || crossTenantText.includes("G3 A")) {
      throw new Error("Cross-tenant contributor identity was exposed in the browser.");
    }
    await signOutInBrowser(page);
    await refreshToken("C");

    const correction = await api<{ changeRequest: ChangeSummary }>(
      token("A"),
      `/materials/${referenceMaterial.id}/change-requests`,
      {
        method: "POST",
        tenantId: tenantA,
        body: { requestType: "GENERAL", displayName: `${referenceMaterial.displayName} corrected` }
      }
    );
    expectStatus(correction, 201, "Platform correction submission");
    expectError(
      await api(
        token("B"),
        `/material-change-requests/${correction.body.changeRequest.id}/approve`,
        {
          method: "POST",
          tenantId: tenantA,
          body: {}
        }
      ),
      403,
      "FORBIDDEN",
      "Tenant approver Platform correction"
    );

    await signInInBrowser(page, fixture("D"));
    await page.goto(new URL("/platform/material-intelligence/review", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await expectVisible(page, "Global Material review");
    await capture(page, "platform-review-desktop", "/platform/material-intelligence/review");
    await page.getByRole("link", { name: "Open review" }).click();
    await page
      .getByRole("heading", { name: referenceMaterial.displayName })
      .waitFor({ state: "visible" });
    await capture(page, "platform-review-detail-desktop", page.url().replace(stagingUrl, ""));
    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL(/\/platform\/material-intelligence\/review$/);
    await signOutInBrowser(page);
    await refreshToken("D");

    const corrected = await api<{ material: MaterialSummary }>(
      token("A"),
      `/materials/${referenceMaterial.id}`,
      { tenantId: tenantA }
    );
    expectStatus(corrected, 200, "Platform corrected Material read");
    if (corrected.body.material.displayName !== `${referenceMaterial.displayName} corrected`) {
      throw new Error("Platform Owner did not resolve the global Material correction.");
    }

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: bypassHeaders()
    });
    const mobile = await mobileContext.newPage();
    try {
      await signInInBrowser(mobile, fixture("A"));
      await mobile.goto(new URL(`/materials/${created.id}`, stagingUrl).toString(), {
        waitUntil: "networkidle"
      });
      await mobile.getByRole("heading", { name: mixtureName }).waitFor({ state: "visible" });
      if (await mobile.locator(".nox-inspector").isVisible()) {
        throw new Error("Material mobile acceptance requires the global Inspector to collapse.");
      }
      await capture(mobile, "material-detail-mobile", `/materials/${created.id}`);
      await mobile.goto(new URL("/materials/new", stagingUrl).toString(), {
        waitUntil: "networkidle"
      });
      await expectVisible(mobile, "Add Material");
      await capture(mobile, "material-create-mobile", "/materials/new");
    } finally {
      await mobileContext.close();
    }
  } finally {
    await browser.close();
  }

  console.log("G3_STAGING_MATERIAL_INTELLIGENCE_ACCEPTANCE=PASS");
} finally {
  await cleanupFixtures();
  await runtime.end({ timeout: 5 });
  await maintenance.end({ timeout: 5 });
}

function required(name: string): string {
  const value = raw[name];
  if (!value) throw new Error(`${name} is required for G3 Staging acceptance.`);
  return value;
}

function fixture(key: FixtureKey): FixtureUser {
  const value = fixtures.get(key);
  if (!value) throw new Error("G3 fixture was not provisioned.");
  return value;
}

function token(key: FixtureKey): string {
  const value = tokens.get(key);
  if (!value) throw new Error("G3 fixture token was not issued.");
  return value;
}

async function refreshToken(key: FixtureKey): Promise<void> {
  tokens.set(key, await signIn(fixture(key)));
}

function bypassHeaders(): Record<string, string> {
  return {
    "x-vercel-protection-bypass": protectionBypass,
    "x-vercel-set-bypass-cookie": "true"
  };
}

function apiBypassHeaders(): Record<string, string> {
  return { "x-vercel-protection-bypass": protectionBypass };
}

function adminHeaders(): Record<string, string> {
  return { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
}

async function createAuthFixture(key: FixtureKey): Promise<FixtureUser> {
  const email = `nox-g3-${suffix}-${key.toLowerCase()}@example.test`;
  const response = await fetch(new URL("/auth/v1/admin/users", supabaseUrl), {
    method: "POST",
    headers: { ...adminHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const body = (await response.json().catch(() => undefined)) as
    { id?: string; user?: { id?: string } } | undefined;
  const id = body?.id ?? body?.user?.id;
  if (!response.ok || !id) throw new Error("G3 Staging Auth fixture provisioning failed.");
  return { id, email, password };
}

async function signIn(user: FixtureUser): Promise<string> {
  const response = await fetch(new URL("/auth/v1/token?grant_type=password", supabaseUrl), {
    method: "POST",
    headers: { ...adminHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password })
  });
  const body = (await response.json().catch(() => undefined)) as
    { access_token?: string } | undefined;
  if (!response.ok || !body?.access_token) throw new Error("G3 fixture sign-in failed.");
  return body.access_token;
}

async function api<T = unknown>(
  accessToken: string,
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; tenantId?: string } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "x-correlation-id": `g3-${suffix}`,
    ...apiBypassHeaders()
  };
  if (options.tenantId) headers["x-nox-tenant-id"] = options.tenantId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL("/api/v1" + path, stagingUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return { status: response.status, body: (await response.json().catch(() => undefined)) as T };
}

function expectStatus(result: ApiResult, expected: number, label: string): void {
  if (result.status !== expected)
    throw new Error(`${label} returned ${result.status}, expected ${expected}.`);
}

function expectError(
  result: ApiResult<{ error?: { code?: string } }>,
  status: number,
  code: string,
  label: string
): void {
  if (result.status !== status || result.body.error?.code !== code) {
    throw new Error(`${label} did not fail closed with ${status} ${code}.`);
  }
}

async function createTenant(accessToken: string, name: string, owner: FixtureKey): Promise<string> {
  const result = await api<{ tenant: { id?: string } }>(accessToken, "/platform/tenants", {
    method: "POST",
    body: {
      name,
      slug: `${name.toLowerCase().replaceAll(" ", "-")}-${suffix.slice(0, 8)}`,
      initialOwnerUserId: fixture(owner).id
    }
  });
  expectStatus(result, 201, "Tenant creation");
  if (!result.body.tenant.id) throw new Error("Tenant creation did not return an identifier.");
  tenantIds.push(result.body.tenant.id);
  return result.body.tenant.id;
}

async function addMembership(
  accessToken: string,
  tenantId: string,
  key: FixtureKey,
  roleKey: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_MEMBER"
): Promise<void> {
  expectStatus(
    await api(accessToken, `/platform/tenants/${tenantId}/members`, {
      method: "POST",
      body: { userId: fixture(key).id, roleKey }
    }),
    201,
    "Tenant membership creation"
  );
}

async function seedPlatformReferenceMaterial(): Promise<MaterialSummary> {
  const id = randomUUID();
  const displayName = `Ambroxan G3 ${suffix.slice(0, 8)}`;
  await maintenance`
    insert into material_intelligence.materials (
      id, tenant_id, scope, visibility, display_name, normalized_display_name,
      material_type, approval_status, note_classification, chemical_entity_id,
      contributor_user_id, approved_by_user_id, approved_by_authority
    ) values (
      ${id}, null, 'PLATFORM', 'SHARED', ${displayName}, ${displayName.toLowerCase()},
      'NATURAL', 'APPROVED', 'MID', null, ${fixture("D").id}, ${fixture("D").id}, 'PLATFORM'
    )
  `;
  return { id, displayName, approvalStatus: "APPROVED" };
}

async function createPrivateTenantBMaterial(tenantId: string): Promise<MaterialSummary> {
  const name = `G3 Private ${suffix.slice(0, 8)}`;
  const result = await api<{ material: MaterialSummary }>(token("E"), "/materials", {
    method: "POST",
    tenantId,
    body: { displayName: name, materialType: "NATURAL", odorAssignments: [] }
  });
  expectStatus(result, 201, "Tenant B private Material creation");
  return result.body.material;
}

async function findMaterial(
  accessToken: string,
  tenantId: string,
  query: string
): Promise<MaterialSummary> {
  const result = await api<{ materials: MaterialSummary[] }>(
    accessToken,
    "/materials?" + new URLSearchParams({ query }),
    { tenantId }
  );
  expectStatus(result, 200, "Material Registry search");
  const material = result.body.materials.find((entry) => entry.displayName === query);
  if (!material) throw new Error("Created Material did not appear in its tenant Registry.");
  return material;
}

async function latestPendingRequest(
  accessToken: string,
  tenantId: string,
  materialId: string
): Promise<string> {
  const result = await api<{ changeRequests: Array<{ id: string; materialId: string }> }>(
    accessToken,
    "/material-change-requests?status=PENDING_REVIEW",
    { tenantId }
  );
  expectStatus(result, 200, "Tenant review queue");
  const request = result.body.changeRequests.find((entry) => entry.materialId === materialId);
  if (!request) throw new Error("Created Material did not produce a pending review request.");
  return request.id;
}

async function signInInBrowser(page: Page, user: FixtureUser): Promise<void> {
  await page.goto(new URL("/sign-in", stagingUrl).toString(), { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Application modules" }).waitFor({ state: "visible" });
}

async function signOutInBrowser(page: Page): Promise<void> {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.waitForURL(/\/sign-in$/);
}

async function expectVisible(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: true }).waitFor({ state: "visible" });
}

async function expectHeading(page: Page, text: string): Promise<void> {
  await page.getByRole("heading", { name: text, exact: true }).waitFor({ state: "visible" });
}

function createdMaterialIdFromUrl(value: string): string {
  const path = new URL(value).pathname;
  const materialId = path.match(/^\/materials\/([^/]+)$/)?.[1];
  if (!materialId)
    throw new Error("Material creation did not navigate to the canonical detail route.");
  return materialId;
}

async function capture(page: Page, name: string, route: string): Promise<void> {
  if (!visualCaptureDirectory) return;
  await mkdir(visualCaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(visualCaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(visualCaptureDirectory, `${name}.json`),
    JSON.stringify(
      {
        route,
        viewport: page.viewportSize(),
        sha: expectedSourceSha,
        environment: "staging",
        capturedAt: new Date().toISOString()
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtures.values()].map((user) => user.id);
  try {
    await maintenance.begin(async (transaction) => {
      for (const materialId of materialIds) {
        await transaction`delete from material_intelligence.material_change_requests where material_id = ${materialId}`;
        await transaction`delete from material_intelligence.material_odor_assignments where material_id = ${materialId}`;
        await transaction`delete from material_intelligence.material_properties where material_id = ${materialId}`;
        await transaction`delete from material_intelligence.material_identifiers where material_id = ${materialId}`;
        await transaction`delete from material_intelligence.material_components where material_id = ${materialId} or component_material_id = ${materialId}`;
        await transaction`delete from material_intelligence.material_concentrates where material_id = ${materialId} or source_material_id = ${materialId} or solvent_material_id = ${materialId}`;
        await transaction`delete from material_intelligence.materials where id = ${materialId}`;
      }
      for (const userId of userIds)
        await transaction`delete from platform.audit_events where actor_user_id = ${userId}`;
      for (const tenantId of tenantIds)
        await transaction`delete from platform.audit_events where tenant_id = ${tenantId}`;
      await transaction`delete from platform.audit_events where request_id = ${`g3-bootstrap-${suffix}`}`;
      for (const tenantId of tenantIds) {
        await transaction`
          delete from material_intelligence.material_change_requests
          where tenant_id = ${tenantId}
             or material_id in (
               select id from material_intelligence.materials where tenant_id = ${tenantId}
             )
        `;
        await transaction`
          delete from material_intelligence.material_components
          where material_id in (
                  select id from material_intelligence.materials where tenant_id = ${tenantId}
                )
             or component_material_id in (
                  select id from material_intelligence.materials where tenant_id = ${tenantId}
                )
        `;
        await transaction`
          delete from material_intelligence.material_concentrates
          where material_id in (
                  select id from material_intelligence.materials where tenant_id = ${tenantId}
                )
             or source_material_id in (
                  select id from material_intelligence.materials where tenant_id = ${tenantId}
                )
             or solvent_material_id in (
                  select id from material_intelligence.materials where tenant_id = ${tenantId}
                )
        `;
        await transaction`
          delete from material_intelligence.material_odor_assignments
          where material_id in (
            select id from material_intelligence.materials where tenant_id = ${tenantId}
          )
        `;
        await transaction`
          delete from material_intelligence.material_properties
          where material_id in (
            select id from material_intelligence.materials where tenant_id = ${tenantId}
          )
        `;
        await transaction`
          delete from material_intelligence.material_identifiers
          where material_id in (
            select id from material_intelligence.materials where tenant_id = ${tenantId}
          )
        `;
        await transaction`delete from material_intelligence.materials where tenant_id = ${tenantId}`;
        await transaction`delete from platform.tenant_entitlements where tenant_id = ${tenantId}`;
        await transaction`delete from platform.tenant_memberships where tenant_id = ${tenantId}`;
        await transaction`delete from platform.tenants where id = ${tenantId}`;
      }
      for (const userId of userIds)
        await transaction`delete from platform.platform_users where id = ${userId}`;
    });
    for (const user of fixtures.values()) {
      const response = await fetch(new URL(`/auth/v1/admin/users/${user.id}`, supabaseUrl), {
        method: "DELETE",
        headers: adminHeaders()
      });
      if (!response.ok) throw new Error("G3 Staging Auth fixture cleanup failed.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`G3 Staging fixture cleanup failed: ${reason}`);
  }
}
