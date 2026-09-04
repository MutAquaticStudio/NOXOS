import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
const storageBucket = required("SUPABASE_STORAGE_BUCKET");
const stagingProjectRef = required("SUPABASE_STAGING_PROJECT_REF");
const productionProjectRef = required("SUPABASE_PRODUCTION_PROJECT_REF");
const databasePassword = required("SUPABASE_DB_PASSWORD");
const runtimeDatabaseUrl = required("NOX_RUNTIME_DATABASE_URL");
const protectionBypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");
const expectedSourceSha = required("EXPECTED_SOURCE_SHA");
const visualCaptureDirectory = process.env.G3_VISUAL_CAPTURE_DIR;
const g5VisualCaptureDirectory = process.env.G5_VISUAL_CAPTURE_DIR;
const g6VisualCaptureDirectory = process.env.G6_VISUAL_CAPTURE_DIR;
const g7VisualCaptureDirectory = process.env.G7_VISUAL_CAPTURE_DIR;
const g8VisualCaptureDirectory = process.env.G8_VISUAL_CAPTURE_DIR;

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
const inventoryStock = new Map<string, { locationId: string; lots: Map<string, string> }>();
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
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.design-studio`,
        { method: "PUT", body: { enabled: true } }
      ),
      200,
      "Design Studio entitlement"
    );
  }
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.trial-sensory`,
        { method: "PUT", body: { enabled: true } }
      ),
      200,
      "Trial & Sensory entitlement"
    );
  }
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.release-readiness`,
        { method: "PUT", body: { enabled: true } }
      ),
      200,
      "Release Readiness entitlement"
    );
  }
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(platformOwnerToken, `/platform/tenants/${tenantId}/entitlements/module.inventory`, {
        method: "PUT",
        body: { enabled: true }
      }),
      200,
      "Inventory entitlement"
    );
  }
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.procurement`,
        {
          method: "PUT",
          body: { enabled: true }
        }
      ),
      200,
      "Procurement entitlement"
    );
  }
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.production`,
        { method: "PUT", body: { enabled: true } }
      ),
      200,
      "Production entitlement"
    );
  }
  for (const tenantId of [tenantA, tenantB]) {
    expectStatus(
      await api(
        platformOwnerToken,
        `/platform/tenants/${tenantId}/entitlements/module.quality-control`,
        { method: "PUT", body: { enabled: true } }
      ),
      200,
      "Quality Control entitlement"
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
      token("B"),
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
    await page.getByText("Tenant A", { exact: true }).first().waitFor({ state: "visible" });
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
    await page
      .locator(
        `a[href="/platform/material-intelligence/review/${correction.body.changeRequest.id}"]`
      )
      .click();
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
    await runG4Acceptance(page, tenantA, tenantB);
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
    throw new Error(
      `${label} returned ${result.status}, expected ${expected}: ${JSON.stringify(result.body)}`
    );
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
  await maintenance`
    insert into material_intelligence.material_odor_assignments (
      material_id, taxonomy_version, assignment_type, taxonomy_term, intensity
    ) values (${id}, '1.2', 'DESCRIPTOR', 'Jasminy', 7)
  `;
  await maintenance`
    insert into material_intelligence.material_formulation_guidance (
      material_id, application_key, min_formula_pct, recommended_formula_pct,
      max_formula_pct, impact_class, confidence, source_reference
    ) values (
      ${id}, 'fine-fragrance', 0.01, 100, 100, 'MEDIUM', 'CURATED',
      'nox-g4-staging-acceptance'
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

async function runG4Acceptance(page: Page, tenantA: string, tenantB: string): Promise<void> {
  type Candidate = {
    generationStrategy: string;
    compositionKind: string;
    referenceFormulaMassMg: string;
    lines: Array<{
      normalizedMassMg: string;
      materialSnapshot: Record<string, unknown>;
    }>;
    validation: { warnings: string[]; releaseReadiness: string };
    scientificContext: { capability: string };
  };
  type Frozen = {
    formulaVersionId: string;
    bundleHash: string;
    approvalState: string;
    candidate: Candidate;
  };

  let actor = token("B");
  const asset = await api<{ asset: { assetId: string; sourceName: string; modality: string } }>(
    actor,
    "/design-studio/assets",
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        sourceName: "g4-staging-reference.txt",
        modality: "REFERENCE",
        mimeType: "text/plain",
        contentsBase64: Buffer.from("G4 private acceptance reference").toString("base64")
      }
    }
  );
  expectStatus(asset, 201, "G4 private source attachment");
  const storagePath = `tenant/${tenantA}/${asset.body.asset.assetId}`;

  const createBrief = async (workflowMode: "FORMULA_GENERATION" | "ACCORD_ARCHITECTURE") => {
    const project = await api<{ project: { id: string; tenantId: string } }>(
      actor,
      "/design-studio/projects",
      {
        method: "POST",
        tenantId: tenantA,
        body: { name: `G4 ${workflowMode} ${suffix.slice(0, 8)}`, description: null }
      }
    );
    expectStatus(project, 201, "G4 Project creation");
    if (project.body.project.tenantId !== tenantA)
      throw new Error("G4 Project did not use trusted tenant context.");
    if (workflowMode === "FORMULA_GENERATION") {
      let crossTenantForeignKeyRejected = false;
      try {
        await maintenance`
          insert into design_studio.design_briefs (
            tenant_id, project_id, workflow_mode, raw_brief, created_by_user_id
          ) values (
            ${tenantB}, ${project.body.project.id}, 'FORMULA_GENERATION',
            'Cross-tenant composite FK probe', ${fixture("C").id}
          )
        `;
      } catch {
        crossTenantForeignKeyRejected = true;
      }
      if (!crossTenantForeignKeyRejected)
        throw new Error("Design Studio composite tenant foreign key accepted cross-tenant data.");
    }
    const brief = await api<{
      brief: { id: string };
      intentDraft: { intent: unknown };
    }>(actor, `/design-studio/projects/${project.body.project.id}/briefs`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        workflowMode,
        rawBrief: "A transparent jasminy fine-fragrance direction.",
        applicationKey: "fine-fragrance",
        targetDosagePct: 20,
        explicitTags: [
          { assignmentType: "DESCRIPTOR", taxonomyTerm: "Jasminy", targetStrength: 1 }
        ],
        explicitExclusions: [],
        signals: [],
        assetReferences: [asset.body.asset]
      }
    });
    expectStatus(brief, 201, "G4 Brief creation");
    expectStatus(
      await api(actor, `/design-studio/briefs/${brief.body.brief.id}/confirm`, {
        method: "POST",
        tenantId: tenantA,
        body: { intent: brief.body.intentDraft.intent }
      }),
      200,
      "G4 human Intent confirmation"
    );
    return brief.body.brief.id;
  };

  try {
    const formulaBriefId = await createBrief("FORMULA_GENERATION");
    const generated = await api<{ candidates: Candidate[] }>(
      actor,
      `/design-studio/briefs/${formulaBriefId}/generate`,
      { method: "POST", tenantId: tenantA, body: { budget: { mode: "STANDARD" } } }
    );
    expectStatus(generated, 200, "G4 deterministic Formula generation");
    if (generated.body.candidates.length !== 3)
      throw new Error("G4 Formula acceptance requires exactly three strategy candidates.");
    for (const candidate of generated.body.candidates) {
      const total = candidate.lines.reduce((sum, line) => sum + BigInt(line.normalizedMassMg), 0n);
      if (
        candidate.referenceFormulaMassMg !== "1000000" ||
        total !== 1_000_000n ||
        candidate.validation.releaseReadiness !== "NOT_ASSESSED" ||
        candidate.scientificContext.capability !== "CURATED_ONLY" ||
        !candidate.validation.warnings.includes("MIXTURE_INTERACTION_NOT_MODELED")
      )
        throw new Error("G4 candidate mass, warning, readiness, or fallback evidence is invalid.");
    }
    expectError(
      await api(token("A"), `/design-studio/briefs/${formulaBriefId}/generate`, {
        method: "POST",
        tenantId: tenantA,
        body: { budget: { mode: "STANDARD" } }
      }),
      403,
      "PERMISSION_DENIED",
      "Unauthorized G4 generation"
    );
    const chosen = generated.body.candidates[0];
    expectError(
      await api(token("A"), `/design-studio/briefs/${formulaBriefId}/freeze`, {
        method: "POST",
        tenantId: tenantA,
        body: {
          budget: { mode: "STANDARD" },
          strategy: chosen.generationStrategy,
          formulaName: "Unauthorized"
        }
      }),
      403,
      "PERMISSION_DENIED",
      "Unauthorized G4 Formula Freeze"
    );
    const frozenResponse = await api<{ formulaVersion: Frozen }>(
      actor,
      `/design-studio/briefs/${formulaBriefId}/freeze`,
      {
        method: "POST",
        tenantId: tenantA,
        body: {
          budget: { mode: "STANDARD" },
          strategy: chosen.generationStrategy,
          formulaName: `G4 Staging Formula ${suffix.slice(0, 8)}`
        }
      }
    );
    expectStatus(frozenResponse, 201, "G4 Formula Freeze");
    const frozen = frozenResponse.body.formulaVersion;
    if (!/^[a-f0-9]{64}$/i.test(frozen.bundleHash))
      throw new Error("G4 frozen Formula did not return a deterministic bundle hash.");
    if (/scientificInternal|canonical_smiles|chemical_entity_id/i.test(JSON.stringify(frozen)))
      throw new Error("G4 tenant Formula DTO leaked internal scientific Material data.");
    expectError(
      await api(token("E"), `/design-studio/formula-versions/${frozen.formulaVersionId}`, {
        tenantId: tenantB
      }),
      404,
      "FORMULA_VERSION_NOT_FOUND",
      "Cross-tenant frozen Formula read"
    );
    expectError(
      await api(token("E"), `/design-studio/briefs/${formulaBriefId}/generate`, {
        method: "POST",
        tenantId: tenantB,
        body: { budget: { mode: "STANDARD" } }
      }),
      404,
      "BRIEF_NOT_FOUND",
      "Cross-tenant Formula generation"
    );
    const reloaded = await api<{ formulaVersion: Frozen }>(
      actor,
      `/design-studio/formula-versions/${frozen.formulaVersionId}`,
      { tenantId: tenantA }
    );
    expectStatus(reloaded, 200, "G4 frozen Formula reload");
    if (
      reloaded.body.formulaVersion.bundleHash !== frozen.bundleHash ||
      !isDeepStrictEqual(reloaded.body.formulaVersion.candidate, frozen.candidate)
    )
      throw new Error("FROZEN FormulaVersion did not reload unchanged.");
    let immutabilityRejected = false;
    try {
      await maintenance`
        update design_studio.formula_lines
        set normalized_mass_mg = normalized_mass_mg + 1
        where formula_version_id = ${frozen.formulaVersionId}
      `;
    } catch {
      immutabilityRejected = true;
    }
    if (!immutabilityRejected) throw new Error("Database did not reject FROZEN line mutation.");
    let snapshotMutationRejected = false;
    try {
      await maintenance`
        update design_studio.formula_frozen_snapshots
        set captured_at = captured_at + interval '1 second'
        where formula_version_id = ${frozen.formulaVersionId}
      `;
    } catch {
      snapshotMutationRejected = true;
    }
    if (!snapshotMutationRejected)
      throw new Error("Database did not reject FROZEN snapshot mutation.");
    let unfreezeRejected = false;
    try {
      await maintenance`
        update design_studio.formula_versions
        set status = 'DRAFT'
        where id = ${frozen.formulaVersionId}
      `;
    } catch {
      unfreezeRejected = true;
    }
    if (!unfreezeRejected) throw new Error("Database allowed a FROZEN version to return to DRAFT.");
    await runG5Acceptance(page, tenantA, tenantB, frozen);
    // Browser sign-out revokes all Supabase sessions for the fixture user, including
    // the password-grant token used by the API acceptance path. Re-authenticate
    // before continuing the enclosing G4 journey instead of reusing a revoked token.
    await refreshToken("B");
    actor = token("B");
    expectStatus(
      await api(actor, `/design-studio/formula-versions/${frozen.formulaVersionId}/trial-context`, {
        method: "POST",
        tenantId: tenantA
      }),
      200,
      "G5 TrialContext handoff"
    );

    const accordBriefId = await createBrief("ACCORD_ARCHITECTURE");
    const planned = await api<{
      plan: { accords: Array<{ accordKey: string }>; [key: string]: unknown };
    }>(actor, `/design-studio/briefs/${accordBriefId}/accord-plan`, {
      method: "POST",
      tenantId: tenantA
    });
    expectStatus(planned, 200, "G4 Accord planning");
    if (!planned.body.plan.accords[0]) throw new Error("Accord plan was empty.");
    const saved = await api<{ plan: unknown }>(
      actor,
      `/design-studio/briefs/${accordBriefId}/accord-plan`,
      { method: "PUT", tenantId: tenantA, body: { plan: planned.body.plan } }
    );
    expectStatus(saved, 200, "G4 Accord plan save");
    const briefReload = await api<{ brief: { accordArchitecturePlan?: unknown } }>(
      actor,
      `/design-studio/briefs/${accordBriefId}`,
      { tenantId: tenantA }
    );
    expectStatus(briefReload, 200, "G4 Accord plan reload");
    if (
      JSON.stringify(briefReload.body.brief.accordArchitecturePlan) !==
      JSON.stringify(planned.body.plan)
    )
      throw new Error("Accord plan did not reload unchanged.");
    const developed = await api<{ candidates: Candidate[] }>(
      actor,
      `/design-studio/briefs/${accordBriefId}/generate`,
      {
        method: "POST",
        tenantId: tenantA,
        body: {
          budget: { mode: "STANDARD" },
          accordKey: planned.body.plan.accords[0].accordKey
        }
      }
    );
    expectStatus(developed, 200, "Develop This Accord");
    if (
      developed.body.candidates.some(
        (candidate) => candidate.compositionKind !== "ACCORD_FORMULATION"
      )
    )
      throw new Error("Develop This Accord did not return ACCORD_FORMULATION candidates.");
    const accordCandidate = developed.body.candidates[0];
    const frozenAccord = await api<{ formulaVersion: Frozen }>(
      actor,
      `/design-studio/briefs/${accordBriefId}/freeze`,
      {
        method: "POST",
        tenantId: tenantA,
        body: {
          budget: { mode: "STANDARD" },
          accordKey: planned.body.plan.accords[0].accordKey,
          strategy: accordCandidate.generationStrategy,
          formulaName: `G4 Staging Accord ${suffix.slice(0, 8)}`
        }
      }
    );
    expectStatus(frozenAccord, 201, "G4 Accord Formulation Freeze");
    if (frozenAccord.body.formulaVersion.candidate.compositionKind !== "ACCORD_FORMULATION")
      throw new Error("Frozen Accord did not preserve ACCORD_FORMULATION identity.");
    expectStatus(
      await api(
        actor,
        `/design-studio/formula-versions/${frozenAccord.body.formulaVersion.formulaVersionId}/trial-context`,
        { method: "POST", tenantId: tenantA }
      ),
      200,
      "G4 Accord G5 TrialContext handoff"
    );
    await runG5AccordAcceptance(page, tenantA, frozenAccord.body.formulaVersion);
    await refreshToken("B");
    actor = token("B");
    const g6CurrentAssessmentId = await runG6Acceptance(
      page,
      tenantA,
      tenantB,
      frozen,
      frozenAccord.body.formulaVersion
    );
    await refreshToken("B");
    actor = token("B");
    await runG9OperationalAcceptance(
      page,
      actor,
      tenantA,
      frozen.formulaVersionId,
      g6CurrentAssessmentId
    );
    console.log("G9_STAGING_PRODUCTION_ACCEPTANCE=PASS");
    console.log("G9_STAGING_RELEASE_RESERVATION=PASS");
    console.log("G9_STAGING_START_CONSUMPTION=PASS");
    console.log("G9_STAGING_READINESS_REVALIDATION=PASS");
    console.log("G9_STAGING_IDEMPOTENCY=PASS");
    console.log("G9_STAGING_PROVENANCE=PASS");
    console.log("G10_STAGING_QC_BATCH_RELEASE_ACCEPTANCE=PASS");
    console.log("G10_STAGING_CURRENT_G6_REVALIDATION=PASS");
    console.log("G10_STAGING_TERMINAL_DECISION_SERIALIZATION=PASS");
    console.log("G10_STAGING_NO_G7_G9_MUTATION=PASS");
    await refreshToken("B");
    actor = token("B");
    expectStatus(
      await api(actor, `/design-studio/briefs/${accordBriefId}/generate`, {
        method: "POST",
        tenantId: tenantA,
        body: { budget: { mode: "STANDARD" }, buildCompleteFromAccords: true }
      }),
      200,
      "Build Complete Formula from Accord Architecture"
    );

    await signInInBrowser(page, fixture("B"));
    await page.goto(new URL("/design-studio", stagingUrl).toString(), {
      waitUntil: "networkidle"
    });
    await page
      .getByRole("heading", { name: "What do you want to create?" })
      .waitFor({ state: "visible" });
    await capture(page, "design-studio-entry-desktop", "/design-studio");
    await page.getByRole("button", { name: /Complete Formula/i }).click();
    await page.getByRole("heading", { name: "Brief Composer" }).waitFor({ state: "visible" });
    await capture(page, "design-studio-formula-desktop", "/design-studio");
    await signOutInBrowser(page);

    const actions = await maintenance<{ action: string }[]>`
      select action from platform.audit_events
      where tenant_id = ${tenantA}
        and action in (
          'project.created', 'brief.updated', 'intent.confirmed', 'accord.plan.saved',
          'formula.generated', 'formula.frozen', 'formula.approved'
        )
    `;
    const observed = new Set(actions.map((event) => event.action));
    for (const action of [
      "project.created",
      "brief.updated",
      "intent.confirmed",
      "accord.plan.saved",
      "formula.generated",
      "formula.frozen",
      "formula.approved"
    ])
      if (!observed.has(action)) throw new Error(`G4 AuditEvent ${action} is missing.`);

    console.log("G4_STAGING_DESIGN_STUDIO_ACCEPTANCE=PASS");
    console.log("G4_STAGING_FORMULA_WORKFLOW=PASS");
    console.log("G4_STAGING_ACCORD_WORKFLOW=PASS");
  } finally {
    const response = await fetch(
      new URL(`/storage/v1/object/${storageBucket}/${storagePath}`, supabaseUrl),
      { method: "DELETE", headers: adminHeaders() }
    );
    if (!response.ok && response.status !== 404)
      throw new Error("G4 private source attachment cleanup failed.");
  }
}

async function runG6Acceptance(
  page: Page,
  tenantA: string,
  tenantB: string,
  formula: { formulaVersionId: string; bundleHash: string },
  accord: { formulaVersionId: string }
): Promise<string> {
  const actor = token("B");
  const formulaLines = await maintenance<
    { material_id: string; active_aromatic_mass_mg: string }[]
  >`
    select material_id::text, active_aromatic_mass_mg::text
    from design_studio.formula_lines
    where tenant_id = ${tenantA} and formula_version_id = ${formula.formulaVersionId}
    order by line_order
  `;
  const restrictedLine = formulaLines.find(
    (candidate) => BigInt(candidate.active_aromatic_mass_mg) > 0n
  );
  if (!restrictedLine) throw new Error("G6 acceptance requires one active Formula line.");
  const regulatoryMaterialId = restrictedLine.material_id;
  for (const formulaLine of formulaLines) {
    const isRestricted = formulaLine.material_id === regulatoryMaterialId;
    await maintenance`
      insert into material_intelligence.material_properties (
        material_id, source_reference, ifra_cat4_max_pct, ifra_amendment,
        ifra_source_reference, ifra_restricted, ifra_limits, eu_allergens
      ) values (
        ${formulaLine.material_id},
        ${isRestricted ? "G6-STAGING-SOURCE" : "G6-STAGING-NONRESTRICTED-SOURCE"},
        ${isRestricted ? 100 : null}, '51',
        ${isRestricted ? "G6-STAGING-IFRA" : "G6-STAGING-NONRESTRICTED-IFRA"},
        ${isRestricted}, '{}'::jsonb, '[]'::jsonb
      ) on conflict (material_id) do update set
        source_reference = excluded.source_reference,
        ifra_cat4_max_pct = excluded.ifra_cat4_max_pct,
        ifra_amendment = excluded.ifra_amendment,
        ifra_source_reference = excluded.ifra_source_reference,
        ifra_restricted = excluded.ifra_restricted,
        ifra_limits = excluded.ifra_limits,
        eu_allergens = excluded.eu_allergens,
        updated_at = now()
    `;
  }

  const availability = await api<{
    moduleAvailability: Array<{ moduleId: string; state: string }>;
    authorization: { modulePermissions: string[] };
  }>(actor, "/context", { tenantId: tenantA });
  expectStatus(availability, 200, "G6 tenant context");
  if (
    availability.body.moduleAvailability.find((item) => item.moduleId === "release-readiness")
      ?.state !== "AVAILABLE" ||
    !availability.body.authorization.modulePermissions.includes(
      "module.release-readiness.assessment.run"
    )
  )
    throw new Error("Release Readiness is not AVAILABLE with server-derived run permission.");

  expectError(
    await api(token("A"), "/release-readiness/assessments", {
      method: "POST",
      tenantId: tenantA,
      body: {
        formulaVersionId: formula.formulaVersionId,
        applicationKey: "fine-fragrance",
        dosagePct: 10,
        policyKey: "g6-known-limit-v1"
      }
    }),
    403,
    "PERMISSION_DENIED",
    "G6 unauthorized assessment"
  );
  expectError(
    await api(token("E"), "/release-readiness/assessments", {
      method: "POST",
      tenantId: tenantB,
      body: {
        formulaVersionId: formula.formulaVersionId,
        applicationKey: "fine-fragrance",
        dosagePct: 10,
        policyKey: "g6-known-limit-v1"
      }
    }),
    404,
    "NOT_FOUND",
    "G6 cross-tenant Formula non-disclosure"
  );
  expectError(
    await api(actor, "/release-readiness/assessments", {
      method: "POST",
      tenantId: tenantA,
      body: {
        formulaVersionId: accord.formulaVersionId,
        applicationKey: "fine-fragrance",
        dosagePct: 10,
        policyKey: "g6-known-limit-v1"
      }
    }),
    409,
    "UNSUPPORTED_COMPOSITION_KIND",
    "G6 Accord rejection"
  );

  type AssessmentResult = {
    assessment: { id: string; decision: string; supersedesAssessmentId: string | null };
  };
  const ready = await api<AssessmentResult>(actor, "/release-readiness/assessments", {
    method: "POST",
    tenantId: tenantA,
    body: {
      formulaVersionId: formula.formulaVersionId,
      applicationKey: "fine-fragrance",
      dosagePct: 10,
      policyKey: "g6-known-limit-v1"
    }
  });
  expectStatus(ready, 201, "G6 READY assessment");
  if (ready.body.assessment.decision !== "READY") throw new Error("G6 READY path failed.");

  await maintenance`
    update material_intelligence.material_properties
    set ifra_amendment = null, updated_at = now()
    where material_id = ${regulatoryMaterialId}
  `;
  const review = await api<AssessmentResult>(
    actor,
    `/release-readiness/assessments/${ready.body.assessment.id}/reassess`,
    { method: "POST", tenantId: tenantA }
  );
  expectStatus(review, 201, "G6 REVIEW_REQUIRED reassessment");
  if (
    review.body.assessment.decision !== "REVIEW_REQUIRED" ||
    review.body.assessment.supersedesAssessmentId !== ready.body.assessment.id
  )
    throw new Error("G6 REVIEW_REQUIRED lineage failed.");

  await maintenance`
    update material_intelligence.material_properties
    set ifra_cat4_max_pct = 0,
        ifra_amendment = '51', updated_at = now()
    where material_id = ${regulatoryMaterialId}
  `;
  const blocked = await api<AssessmentResult>(
    actor,
    `/release-readiness/assessments/${review.body.assessment.id}/reassess`,
    { method: "POST", tenantId: tenantA }
  );
  expectStatus(blocked, 201, "G6 BLOCKED reassessment");
  if (
    blocked.body.assessment.decision !== "BLOCKED" ||
    blocked.body.assessment.supersedesAssessmentId !== review.body.assessment.id
  )
    throw new Error("G6 BLOCKED lineage failed.");

  for (const [id, decision] of [
    [ready.body.assessment.id, "READY"],
    [review.body.assessment.id, "REVIEW_REQUIRED"],
    [blocked.body.assessment.id, "BLOCKED"]
  ] as const) {
    const current = await api<AssessmentResult>(actor, `/release-readiness/assessments/${id}`, {
      tenantId: tenantA
    });
    expectStatus(current, 200, `G6 immutable ${decision} history`);
    if (current.body.assessment.decision !== decision)
      throw new Error(`G6 historical ${decision} assessment changed.`);
  }

  let assessmentMutationRejected = false;
  try {
    await maintenance`
      update release_readiness.assessments set decision = 'READY'
      where tenant_id = ${tenantA} and id = ${blocked.body.assessment.id}
    `;
  } catch {
    assessmentMutationRejected = true;
  }
  if (!assessmentMutationRejected) throw new Error("G6 final assessment was mutable.");
  let checkMutationRejected = false;
  try {
    await maintenance`
      update release_readiness.checks set result = 'PASS'
      where tenant_id = ${tenantA} and assessment_id = ${blocked.body.assessment.id}
    `;
  } catch {
    checkMutationRejected = true;
  }
  if (!checkMutationRejected) throw new Error("G6 final checks were mutable.");

  const audit = await maintenance<{ action: string }[]>`
    select action from platform.audit_events
    where tenant_id = ${tenantA} and resource_type = 'ReleaseAssessment'
      and action in ('release-readiness.assessed', 'release-readiness.reassessed')
  `;
  if (
    !audit.some((item) => item.action === "release-readiness.assessed") ||
    !audit.some((item) => item.action === "release-readiness.reassessed")
  )
    throw new Error("G6 assessment AuditEvent evidence is incomplete.");

  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL("/release-readiness", stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await page.getByRole("heading", { name: "Release Assessments" }).waitFor({ state: "visible" });
  await captureG6(page, "release-readiness-registry", "/release-readiness");
  await page.goto(
    new URL(`/release-readiness/${blocked.body.assessment.id}`, stagingUrl).toString(),
    { waitUntil: "networkidle" }
  );
  await page.getByRole("heading", { name: "BLOCKED" }).waitFor({ state: "visible" });
  await captureG6(
    page,
    "release-readiness-detail",
    `/release-readiness/${blocked.body.assessment.id}`
  );
  await signOutInBrowser(page);

  console.log("G6_STAGING_READY_PATH=PASS");
  console.log("G6_STAGING_REVIEW_REQUIRED_PATH=PASS");
  console.log("G6_STAGING_BLOCKED_PATH=PASS");
  console.log("G6_STAGING_IMMUTABILITY=PASS");
  console.log("G6_STAGING_TENANT_SECURITY=PASS");
  return blocked.body.assessment.id;
}

async function captureG6(page: Page, name: string, route: string): Promise<void> {
  if (!g6VisualCaptureDirectory) return;
  await mkdir(g6VisualCaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(g6VisualCaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(g6VisualCaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSourceSha, environment: "staging" },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function runG5AccordAcceptance(
  page: Page,
  tenantId: string,
  frozen: { formulaVersionId: string; bundleHash: string; candidate: unknown }
): Promise<void> {
  const actor = token("B");
  const created = await api<{
    trial: { id: string; compositionKind: string; formulaBundleHash: string };
  }>(actor, "/trials", {
    method: "POST",
    tenantId,
    body: {
      formulaVersionId: frozen.formulaVersionId,
      preparationMode: "CONCENTRATE",
      applicationKey: "fine-fragrance-accord",
      dosagePct: 20,
      carrierOrBaseReference: null,
      targetMassMg: "20000"
    }
  });
  expectStatus(created, 201, "G5 ACCORD_FORMULATION Trial creation");
  if (
    created.body.trial.compositionKind !== "ACCORD_FORMULATION" ||
    created.body.trial.formulaBundleHash !== frozen.bundleHash
  )
    throw new Error("G5 Accord Trial did not preserve frozen Accord lineage.");
  expectStatus(
    await allocateTrialInventory(actor, tenantId, created.body.trial.id),
    201,
    "G7 Accord exact reservation"
  );
  expectStatus(
    await api(actor, `/trials/${created.body.trial.id}/prepare`, {
      method: "POST",
      tenantId
    }),
    200,
    "G5 Accord exact preparation"
  );
  await assertTrialConsumption(actor, tenantId, created.body.trial.id, 20_000n);
  const evaluation = await api<{ evaluation: { id: string } }>(
    actor,
    `/trials/${created.body.trial.id}/evaluations`,
    {
      method: "POST",
      tenantId,
      body: {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 60,
        temperatureC: 23,
        humidityPct: 55,
        evaluationText: "The accord is coherent and useful as a building block.",
        diagnosticNote: null
      }
    }
  );
  expectStatus(evaluation, 201, "G5 Accord evaluation creation");
  expectStatus(
    await api(
      actor,
      `/trials/${created.body.trial.id}/evaluations/${evaluation.body.evaluation.id}/finalize`,
      { method: "POST", tenantId, body: { decision: "READY_FOR_APPROVAL", deltas: [] } }
    ),
    200,
    "G5 Accord FINAL evidence"
  );
  expectStatus(
    await api(
      actor,
      `/trials/${created.body.trial.id}/evaluations/${evaluation.body.evaluation.id}/recommend-approval`,
      { method: "POST", tenantId }
    ),
    200,
    "G5 Accord approval recommendation"
  );
  expectStatus(
    await api(actor, `/design-studio/formula-versions/${frozen.formulaVersionId}/approve`, {
      method: "POST",
      tenantId,
      body: {
        sourceTrialId: created.body.trial.id,
        sourceEvaluationId: evaluation.body.evaluation.id
      }
    }),
    200,
    "G4 Accord approval with G5 evidence"
  );
  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL(`/trials/${created.body.trial.id}`, stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await page.getByText("WHOLE ACCORD").waitFor({ state: "visible" });
  await captureG5(page, "accord-trial-desktop", `/trials/${created.body.trial.id}`);
  await signOutInBrowser(page);
  console.log("G5_STAGING_ACCORD_TRIAL=PASS");
}

async function allocateTrialInventory(
  actor: string,
  tenantId: string,
  trialId: string
): Promise<ApiResult> {
  const plan = await api<{
    plan: { requirements: Array<{ materialId: string; requiredMassMg: string }> };
  }>(actor, `/trials/${trialId}/preparation-plan`, { tenantId });
  expectStatus(plan, 200, "G7 Trial preparation plan");
  let stock = inventoryStock.get(tenantId);
  if (!stock) {
    const created = await api<{ location: { id: string } }>(actor, "/inventory/locations", {
      method: "POST",
      tenantId,
      body: {
        locationCode: `STAGING-${suffix.slice(0, 12).toUpperCase()}`,
        name: "Staging Trial Lab",
        description: "Gate 7 isolated acceptance"
      }
    });
    expectStatus(created, 201, "G7 Staging Location");
    stock = { locationId: created.body.location.id, lots: new Map() };
    inventoryStock.set(tenantId, stock);
  }
  const allocations: Array<{
    materialId: string;
    lotId: string;
    locationId: string;
    quantityMg: string;
  }> = [];
  for (const requirement of plan.body.plan.requirements) {
    let lotId = stock.lots.get(requirement.materialId);
    if (!lotId) {
      const created = await api<{ lot: { id: string } }>(actor, "/inventory/lots", {
        method: "POST",
        tenantId,
        body: {
          materialId: requirement.materialId,
          lotCode: `STG-${suffix.slice(0, 8)}-${requirement.materialId.slice(0, 8)}`,
          supplierLotCode: null,
          manufacturedAt: null,
          expiresAt: null,
          retestAt: null,
          notes: "Gate 7 isolated acceptance"
        }
      });
      expectStatus(created, 201, "G7 Staging Lot");
      lotId = created.body.lot.id;
      stock.lots.set(requirement.materialId, lotId);
      expectStatus(
        await api(actor, `/inventory/lots/${lotId}/receive`, {
          method: "POST",
          tenantId,
          body: {
            quantityMg: "10000000",
            toLocationId: stock.locationId,
            reasonCode: "G7_STAGING_ACCEPTANCE",
            operationKey: `staging:${suffix}:lot:${lotId}:opening`
          }
        }),
        201,
        "G7 Staging opening stock"
      );
    }
    allocations.push({
      materialId: requirement.materialId,
      lotId,
      locationId: stock.locationId,
      quantityMg: requirement.requiredMassMg
    });
  }
  if ((await trialTraceTotal(actor, tenantId, trialId)) !== 0n)
    throw new Error("DRAFT Trial consumed Inventory before PREPARED.");
  return api(actor, `/trials/${trialId}/inventory/reservations`, {
    method: "POST",
    tenantId,
    body: {
      allocations,
      operationKey: `staging:${suffix}:trial:${trialId}:reserve`
    }
  });
}

async function trialTraceTotal(actor: string, tenantId: string, trialId: string): Promise<bigint> {
  const trace = await api<{
    trace: {
      movements: Array<{
        quantityMg: string;
        sourceModule: string;
        sourceReferenceId: string;
      }>;
    };
  }>(actor, `/inventory/trials/${trialId}/trace`, { tenantId });
  expectStatus(trace, 200, "G7 Trial inventory trace");
  if (
    trace.body.trace.movements.some(
      (item) => item.sourceModule !== "TRIAL" || item.sourceReferenceId !== trialId
    )
  )
    throw new Error("G7 Trial trace contains forged or mismatched provenance.");
  return trace.body.trace.movements.reduce((sum, item) => sum + BigInt(item.quantityMg), 0n);
}

async function assertTrialConsumption(
  actor: string,
  tenantId: string,
  trialId: string,
  expected: bigint
): Promise<void> {
  if ((await trialTraceTotal(actor, tenantId, trialId)) !== expected)
    throw new Error("PREPARED Trial did not consume its exact Inventory reservation set.");
}

async function runG5Acceptance(
  page: Page,
  tenantA: string,
  tenantB: string,
  frozen: {
    formulaVersionId: string;
    bundleHash: string;
    approvalState: string;
    candidate: { generationStrategy: string };
  }
): Promise<void> {
  type TrialBody = {
    trial: {
      id: string;
      formulaVersionId: string;
      formulaBundleHash: string;
      status: string;
      lines: Array<{ scaledMassMg: string; materialSnapshotHash: string }>;
    };
  };
  type EvaluationBody = { evaluation: { id: string; status: string; decision: string | null } };
  const actor = token("B");
  const createPreparedTrial = async (purpose: string) => {
    const created = await api<TrialBody>(actor, "/trials", {
      method: "POST",
      tenantId: tenantA,
      body: {
        formulaVersionId: frozen.formulaVersionId,
        preparationMode: "CONCENTRATE",
        applicationKey: `fine-fragrance-${purpose}`,
        dosagePct: 20,
        carrierOrBaseReference: null,
        targetMassMg: "20000"
      }
    });
    expectStatus(created, 201, `G5 ${purpose} Trial creation`);
    if (
      created.body.trial.formulaVersionId !== frozen.formulaVersionId ||
      created.body.trial.formulaBundleHash !== frozen.bundleHash
    )
      throw new Error("G5 Trial did not preserve exact G4 frozen lineage.");
    expectStatus(
      await allocateTrialInventory(actor, tenantA, created.body.trial.id),
      201,
      `G7 ${purpose} exact reservation`
    );
    const prepared = await api<TrialBody>(actor, `/trials/${created.body.trial.id}/prepare`, {
      method: "POST",
      tenantId: tenantA
    });
    expectStatus(prepared, 200, `G5 ${purpose} exact preparation`);
    const total = prepared.body.trial.lines.reduce(
      (sum, line) => sum + BigInt(line.scaledMassMg),
      0n
    );
    if (
      total !== 20_000n ||
      prepared.body.trial.lines.some(
        (line) =>
          BigInt(line.scaledMassMg) < 1n || !/^[a-f0-9]{64}$/i.test(line.materialSnapshotHash)
      )
    )
      throw new Error("G5 exact scaling or snapshot lineage is invalid.");
    await assertTrialConsumption(actor, tenantA, created.body.trial.id, 20_000n);
    return created.body.trial.id;
  };
  const createFinalEvaluation = async (
    trialId: string,
    decision: "REVISION_REQUIRED" | "READY_FOR_APPROVAL",
    deltas: unknown[]
  ) => {
    const inventoryBefore = await trialTraceTotal(actor, tenantA, trialId);
    const evaluationText =
      decision === "REVISION_REQUIRED"
        ? "The full composition needs a clearer jasminy mid-phase lift."
        : "The full composition is balanced and ready for approval.";
    const created = await api<EvaluationBody>(actor, `/trials/${trialId}/evaluations`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 45,
        temperatureC: 23,
        humidityPct: 55,
        evaluationText,
        diagnosticNote: "Non-canonical diagnostic hypothesis"
      }
    });
    expectStatus(created, 201, "G5 sensory evaluation creation");
    const path = `/trials/${trialId}/evaluations/${created.body.evaluation.id}`;
    expectStatus(
      await api(actor, path, {
        method: "PUT",
        tenantId: tenantA,
        body: {
          evaluationMedium: "BLOTTER",
          sampleAgeMinutes: 45,
          temperatureC: 23,
          humidityPct: 55,
          evaluationText,
          diagnosticNote: "Non-canonical diagnostic hypothesis",
          deltas
        }
      }),
      200,
      "G5 raw evidence and manual mapping"
    );
    expectError(
      await api(actor, `${path}/interpret`, { method: "POST", tenantId: tenantA }),
      503,
      "INTERPRETER_UNAVAILABLE",
      "G5 unavailable interpreter fallback"
    );
    const finalized = await api<EvaluationBody>(actor, `${path}/finalize`, {
      method: "POST",
      tenantId: tenantA,
      body: { decision, deltas }
    });
    expectStatus(finalized, 200, "G5 FINAL evaluation");
    if (
      finalized.body.evaluation.status !== "FINAL" ||
      finalized.body.evaluation.decision !== decision
    )
      throw new Error("G5 evaluation did not preserve the FINAL decision.");
    expectError(
      await api(actor, path, {
        method: "PUT",
        tenantId: tenantA,
        body: {
          evaluationMedium: "BLOTTER",
          sampleAgeMinutes: 46,
          evaluationText: "Mutation must fail.",
          diagnosticNote: null,
          deltas
        }
      }),
      409,
      "EVALUATION_ALREADY_FINAL",
      "G5 FINAL evidence immutability"
    );
    if ((await trialTraceTotal(actor, tenantA, trialId)) !== inventoryBefore)
      throw new Error("Sensory evaluation changed physical Inventory.");
    return created.body.evaluation.id;
  };

  expectError(
    await api(token("E"), "/trials", {
      method: "POST",
      tenantId: tenantB,
      body: {
        formulaVersionId: frozen.formulaVersionId,
        preparationMode: "CONCENTRATE",
        applicationKey: "cross-tenant-probe",
        dosagePct: 20,
        targetMassMg: "20000"
      }
    }),
    409,
    "FORMULA_VERSION_NOT_FROZEN",
    "G5 cross-tenant Formula lineage"
  );

  const revisionTrialId = await createPreparedTrial("revision");
  let preparedContextMutationRejected = false;
  try {
    await maintenance`
      update trial_sensory.trials set target_mass_mg = target_mass_mg + 1
      where tenant_id = ${tenantA} and id = ${revisionTrialId}
    `;
  } catch {
    preparedContextMutationRejected = true;
  }
  if (!preparedContextMutationRejected)
    throw new Error("G5 database allowed PREPARED Trial context mutation.");
  expectError(
    await api(token("E"), `/trials/${revisionTrialId}`, { tenantId: tenantB }),
    404,
    "TRIAL_NOT_FOUND",
    "G5 cross-tenant Trial read"
  );
  const revisionDeltas = [
    {
      phase: "MID",
      assignmentType: "DESCRIPTOR",
      taxonomyTerm: "Jasminy",
      proposedDelta: null,
      confirmedDelta: 2,
      proposalConfidence: null,
      interpreterVersion: null
    }
  ];
  const revisionEvaluationId = await createFinalEvaluation(
    revisionTrialId,
    "REVISION_REQUIRED",
    revisionDeltas
  );
  expectError(
    await api(token("E"), `/trials/${revisionTrialId}/evaluations/${revisionEvaluationId}`, {
      tenantId: tenantB
    }),
    404,
    "EVALUATION_NOT_FOUND",
    "G5 cross-tenant Evaluation read"
  );
  expectError(
    await api(token("E"), `/trials/${revisionTrialId}/evaluations/${revisionEvaluationId}`, {
      method: "PUT",
      tenantId: tenantB,
      body: {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 45,
        evaluationText: "Cross-tenant mutation",
        diagnosticNote: null,
        deltas: revisionDeltas
      }
    }),
    404,
    "EVALUATION_NOT_FOUND",
    "G5 cross-tenant Evaluation mutation"
  );
  let finalDeltaMutationRejected = false;
  try {
    await maintenance`
      update trial_sensory.sensory_deltas set confirmed_delta = confirmed_delta + 1
      where tenant_id = ${tenantA} and evaluation_id = ${revisionEvaluationId}
    `;
  } catch {
    finalDeltaMutationRejected = true;
  }
  if (!finalDeltaMutationRejected)
    throw new Error("G5 database allowed FINAL sensory delta mutation.");
  const revision = await api<{ candidates: Array<{ generationStrategy: string }> }>(
    actor,
    `/trials/${revisionTrialId}/evaluations/${revisionEvaluationId}/create-revision`,
    { method: "POST", tenantId: tenantA }
  );
  expectStatus(revision, 200, "G5-to-G4 revision candidate handoff");
  const revised = await api<{
    formulaVersion: { formulaVersionId: string; parentFormulaVersionId: string | null };
  }>(actor, `/design-studio/formula-versions/${frozen.formulaVersionId}/revisions/freeze`, {
    method: "POST",
    tenantId: tenantA,
    body: {
      sourceTrialId: revisionTrialId,
      sourceEvaluationId: revisionEvaluationId,
      strategy: revision.body.candidates[0]?.generationStrategy,
      formulaName: `G5 sensory revision ${suffix.slice(0, 8)}`
    }
  });
  expectStatus(revised, 201, "G4 revision freeze from G5 evidence");
  if (revised.body.formulaVersion.parentFormulaVersionId !== frozen.formulaVersionId)
    throw new Error("G4 revision did not preserve parent FormulaVersion lineage.");

  const approvalTrialId = await createPreparedTrial("approval");
  const approvalEvaluationId = await createFinalEvaluation(
    approvalTrialId,
    "READY_FOR_APPROVAL",
    []
  );
  expectStatus(
    await api(
      actor,
      `/trials/${approvalTrialId}/evaluations/${approvalEvaluationId}/recommend-approval`,
      { method: "POST", tenantId: tenantA }
    ),
    200,
    "G5 approval recommendation"
  );
  expectError(
    await api(token("A"), `/design-studio/formula-versions/${frozen.formulaVersionId}/approve`, {
      method: "POST",
      tenantId: tenantA,
      body: { sourceTrialId: approvalTrialId, sourceEvaluationId: approvalEvaluationId }
    }),
    403,
    "PERMISSION_DENIED",
    "Unauthorized G4 Formula approval"
  );
  const approved = await api<{
    formulaVersion: { approvalState: string; bundleHash: string };
  }>(actor, `/design-studio/formula-versions/${frozen.formulaVersionId}/approve`, {
    method: "POST",
    tenantId: tenantA,
    body: { sourceTrialId: approvalTrialId, sourceEvaluationId: approvalEvaluationId }
  });
  expectStatus(approved, 200, "G4 Formula approval with G5 evidence");
  if (
    approved.body.formulaVersion.approvalState !== "APPROVED" ||
    approved.body.formulaVersion.bundleHash !== frozen.bundleHash
  )
    throw new Error("Formula approval modified the frozen composition identity.");

  const foreignLineTrial = await api<{ trial: { id: string } }>(actor, "/trials", {
    method: "POST",
    tenantId: tenantA,
    body: {
      formulaVersionId: frozen.formulaVersionId,
      preparationMode: "CONCENTRATE",
      applicationKey: "foreign-line-probe",
      dosagePct: 20,
      targetMassMg: "20000"
    }
  });
  expectStatus(foreignLineTrial, 201, "G5 foreign Formula line probe Trial");
  let foreignFormulaLineRejected = false;
  try {
    await maintenance`
      insert into trial_sensory.trial_lines (
        tenant_id, trial_id, formula_version_id, material_id, line_order,
        scaled_mass_mg, material_snapshot_hash
      ) values (
        ${tenantA}, ${foreignLineTrial.body.trial.id}, ${frozen.formulaVersionId},
        ${randomUUID()}, 1, 20000, ${"0".repeat(64)}
      )
    `;
  } catch {
    foreignFormulaLineRejected = true;
  }
  if (!foreignFormulaLineRejected)
    throw new Error("G5 Trial line accepted Material outside the frozen Formula snapshot.");
  expectStatus(
    await api(actor, `/trials/${foreignLineTrial.body.trial.id}/cancel`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G5 foreign Formula line probe cleanup"
  );

  const draftCancellation = await api<{ trial: { id: string } }>(actor, "/trials", {
    method: "POST",
    tenantId: tenantA,
    body: {
      formulaVersionId: frozen.formulaVersionId,
      preparationMode: "CONCENTRATE",
      applicationKey: "draft-reservation-cancellation",
      dosagePct: 20,
      targetMassMg: "20000"
    }
  });
  expectStatus(draftCancellation, 201, "G7 DRAFT cancellation Trial");
  expectStatus(
    await allocateTrialInventory(actor, tenantA, draftCancellation.body.trial.id),
    201,
    "G7 DRAFT cancellation reservation"
  );
  expectStatus(
    await api(actor, `/trials/${draftCancellation.body.trial.id}/cancel`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 DRAFT Trial cancellation"
  );
  if ((await trialTraceTotal(actor, tenantA, draftCancellation.body.trial.id)) !== 0n)
    throw new Error("DRAFT Trial cancellation created a stock Movement.");
  const cancellationReservations = await maintenance<{ status: string }[]>`
    select status from inventory.stock_reservations
    where tenant_id = ${tenantA} and source_module = 'TRIAL'
      and source_reference_id = ${draftCancellation.body.trial.id}
  `;
  if (
    cancellationReservations.length === 0 ||
    cancellationReservations.some((item) => item.status !== "CANCELLED")
  )
    throw new Error("DRAFT Trial cancellation did not cancel every active reservation.");

  const cancelledTrialId = await createPreparedTrial("cancelled-evidence-lock");
  const cancelledEvaluation = await api<{ evaluation: { id: string } }>(
    actor,
    `/trials/${cancelledTrialId}/evaluations`,
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 15,
        temperatureC: 23,
        humidityPct: 55,
        evaluationText: "Draft evidence before cancellation.",
        diagnosticNote: null
      }
    }
  );
  expectStatus(cancelledEvaluation, 201, "G5 cancellable draft evaluation");
  expectStatus(
    await api(actor, `/trials/${cancelledTrialId}/cancel`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G5 prepared Trial cancellation"
  );
  await assertTrialConsumption(actor, tenantA, cancelledTrialId, 20_000n);
  expectError(
    await api(
      actor,
      `/trials/${cancelledTrialId}/evaluations/${cancelledEvaluation.body.evaluation.id}`,
      {
        method: "PUT",
        tenantId: tenantA,
        body: {
          evaluationMedium: "BLOTTER",
          sampleAgeMinutes: 20,
          temperatureC: 25,
          humidityPct: 60,
          evaluationText: "Mutation after cancellation must fail.",
          diagnosticNote: null,
          deltas: []
        }
      }
    ),
    409,
    "TRIAL_CANCELLED",
    "G5 cancelled Trial API evidence lock"
  );
  let cancelledEvidenceMutationRejected = false;
  try {
    await maintenance`
      update trial_sensory.sensory_evaluations
      set evaluation_text = 'Direct mutation after cancellation must fail.'
      where tenant_id = ${tenantA}
        and id = ${cancelledEvaluation.body.evaluation.id}
    `;
  } catch {
    cancelledEvidenceMutationRejected = true;
  }
  if (!cancelledEvidenceMutationRejected)
    throw new Error("G5 database allowed sensory evidence mutation after Trial cancellation.");

  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL("/trials", stagingUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Trial Registry" }).waitFor({ state: "visible" });
  await captureG5(page, "trial-registry-desktop", "/trials");
  await page.goto(new URL(`/trials/${revisionTrialId}`, stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await page.getByText("FINAL · REVISION REQUIRED").waitFor({ state: "visible" });
  await captureG5(page, "trial-evaluation-desktop", `/trials/${revisionTrialId}`);
  await signOutInBrowser(page);

  const g5Actions = await maintenance<{ action: string }[]>`
    select action from platform.audit_events
    where tenant_id = ${tenantA}
      and action in (
        'trial.created', 'trial.prepared', 'evaluation.created', 'evaluation.updated',
        'evaluation.finalized', 'revision.requested', 'approval.recommended'
      )
  `;
  const observed = new Set(g5Actions.map((event) => event.action));
  for (const action of [
    "trial.created",
    "trial.prepared",
    "evaluation.created",
    "evaluation.updated",
    "evaluation.finalized",
    "revision.requested",
    "approval.recommended"
  ])
    if (!observed.has(action)) throw new Error(`G5 AuditEvent ${action} is missing.`);

  // Browser sign-out revokes every Supabase session for the fixture user. Issue a
  // fresh password-grant token before the API-only G7 acceptance rather than
  // carrying the now-revoked token captured at G5 entry.
  await refreshToken("B");
  await runG7OperationalAcceptance(page, token("B"), tenantA, tenantB, frozen.formulaVersionId);

  // G7's browser acceptance signs the fixture out and Supabase revokes its API
  // sessions. Re-authenticate before beginning the API-only G8 acceptance.
  await refreshToken("B");
  await runG8OperationalAcceptance(page, token("B"), tenantA, tenantB);

  console.log("G5_STAGING_TRIAL_SENSORY_ACCEPTANCE=PASS");
  console.log("G5_STAGING_REVISION_PATH=PASS");
  console.log("G5_STAGING_APPROVAL_PATH=PASS");
  console.log("G5_CANCELLED_TRIAL_EVIDENCE_LOCK=PASS");
  console.log("G8_STAGING_PROCUREMENT_ACCEPTANCE=PASS");
  console.log("G8_STAGING_RECEIPT_ATOMICITY=PASS");
  console.log("G8_STAGING_CONCURRENT_OVER_RECEIPT=PASS");
  console.log("G8_STAGING_TRACEABILITY=PASS");
}

async function runG9OperationalAcceptance(
  page: Page,
  actor: string,
  tenantId: string,
  formulaVersionId: string,
  currentAssessmentId: string
): Promise<void> {
  type Order = {
    id: string;
    status: string;
    releaseReadinessAssessmentId: string | null;
    lines: Array<{ id: string; materialId: string; requiredMassMg: string }>;
    allocations: Array<{
      id: string;
      productionOrderLineId: string;
      inventoryLotId: string;
      allocatedMassMg: string;
      inventoryConsumptionMovementId: string | null;
    }>;
  };
  type Batch = { id: string; productionOrderId: string; actualOutputMassMg: string | null };
  type Lot = {
    lot: { balances: Array<{ locationId: string; onHandMg: string; reservedMg: string }> };
    movements: Array<{
      sourceModule: string;
      sourceReferenceId: string | null;
      quantityMg: string;
    }>;
  };
  const context = await api<{
    moduleAvailability: Array<{ moduleId: string; state: string }>;
    authorization: { modulePermissions: string[] };
  }>(actor, "/context", { tenantId });
  expectStatus(context, 200, "G9 Production context");
  if (
    context.body.moduleAvailability.find((item) => item.moduleId === "production")?.state !==
      "AVAILABLE" ||
    !context.body.authorization.modulePermissions.includes("module.production.order.create") ||
    !context.body.authorization.modulePermissions.includes("module.production.order.release") ||
    !context.body.authorization.modulePermissions.includes("module.production.batch.start")
  )
    throw new Error("G9 Production is not available with the expected Staging permissions.");
  const lines = await runtime<{ material_id: string }[]>`
    select material_id::text
    from design_studio.formula_lines
    where tenant_id = ${tenantId} and formula_version_id = ${formulaVersionId}
    order by line_order
  `;
  if (!lines.length) throw new Error("G9 Staging formula has no production lines.");
  const stock = inventoryStock.get(tenantId);
  if (!stock) throw new Error("G9 Staging inventory fixture is missing.");
  for (const line of lines)
    await runtime`
      update material_intelligence.material_properties
      set ifra_restricted = false, ifra_cat4_max_pct = 100, ifra_amendment = '51', updated_at = now()
      where material_id = ${line.material_id}
    `;
  const ready = await api<{ assessment: { id: string; decision: string } }>(
    actor,
    `/release-readiness/assessments/${currentAssessmentId}/reassess`,
    { method: "POST", tenantId }
  );
  expectStatus(ready, 201, "G9 READY assessment");
  if (ready.body.assessment?.decision !== "READY") throw new Error("G9 READY assessment failed.");
  const create = async (label: string): Promise<Order> => {
    const result = await api<{ order: Order }>(actor, "/production/orders", {
      method: "POST",
      tenantId,
      body: {
        orderNumber: `G9-${label}-${suffix}`,
        formulaVersionId,
        targetMassMg: "1000000",
        notes: "G9 exact-SHA Staging acceptance fixture"
      }
    });
    expectStatus(result, 201, `G9 ${label} order`);
    return result.body.order;
  };
  const ensureLot = async (materialId: string, label: string): Promise<string> => {
    const existing = stock.lots.get(materialId);
    if (existing) return existing;
    const result = await api<{ lot: { id: string } }>(actor, "/inventory/lots", {
      method: "POST",
      tenantId,
      body: {
        materialId,
        lotCode: `G9-${label}-${suffix}-${materialId.slice(0, 8)}`,
        supplierLotCode: null,
        manufacturedAt: null,
        expiresAt: null,
        retestAt: null,
        notes: "G9 exact-SHA Staging acceptance fixture"
      }
    });
    expectStatus(result, 201, "G9 lot");
    stock.lots.set(materialId, result.body.lot.id);
    expectStatus(
      await api(actor, `/inventory/lots/${result.body.lot.id}/receive`, {
        method: "POST",
        tenantId,
        body: {
          quantityMg: "10000000",
          toLocationId: stock.locationId,
          reasonCode: "G9_STAGING_ACCEPTANCE",
          operationKey: `g9:${suffix}:opening:${result.body.lot.id}`
        }
      }),
      201,
      "G9 opening stock"
    );
    return result.body.lot.id;
  };
  const allocate = async (order: Order, split: boolean): Promise<Order> => {
    const allocations: Array<{
      productionOrderLineId: string;
      lotId: string;
      locationId: string;
      allocatedMassMg: string;
    }> = [];
    for (const [index, line] of order.lines.entries()) {
      const lotId = await ensureLot(line.materialId, `LOT-${index}`);
      const quantity = BigInt(line.requiredMassMg);
      if (split && index === 0 && quantity > 1n) {
        const second = await api<{ lot: { id: string } }>(actor, "/inventory/lots", {
          method: "POST",
          tenantId,
          body: {
            materialId: line.materialId,
            lotCode: `G9-SPLIT-${suffix}-${line.materialId.slice(0, 8)}`,
            supplierLotCode: null,
            manufacturedAt: null,
            expiresAt: null,
            retestAt: null,
            notes: "G9 split-lot acceptance fixture"
          }
        });
        expectStatus(second, 201, "G9 split lot");
        expectStatus(
          await api(actor, `/inventory/lots/${second.body.lot.id}/receive`, {
            method: "POST",
            tenantId,
            body: {
              quantityMg: "10000000",
              toLocationId: stock.locationId,
              reasonCode: "G9_STAGING_ACCEPTANCE",
              operationKey: `g9:${suffix}:split:${second.body.lot.id}`
            }
          }),
          201,
          "G9 split stock"
        );
        const first = quantity / 2n;
        allocations.push({
          productionOrderLineId: line.id,
          lotId,
          locationId: stock.locationId,
          allocatedMassMg: String(first)
        });
        allocations.push({
          productionOrderLineId: line.id,
          lotId: second.body.lot.id,
          locationId: stock.locationId,
          allocatedMassMg: String(quantity - first)
        });
      } else {
        allocations.push({
          productionOrderLineId: line.id,
          lotId,
          locationId: stock.locationId,
          allocatedMassMg: line.requiredMassMg
        });
      }
    }
    const result = await api<{ order: Order }>(
      actor,
      `/production/orders/${order.id}/allocations`,
      {
        method: "PUT",
        tenantId,
        body: { allocations }
      }
    );
    expectStatus(result, 200, "G9 exact allocation");
    return result.body.order;
  };
  const main = await allocate(await create("MAIN"), true);
  const released = await api<{ order: Order }>(actor, `/production/orders/${main.id}/release`, {
    method: "POST",
    tenantId
  });
  expectStatus(released, 200, "G9 release");
  if (released.body.order.status !== "RELEASED") throw new Error("G9 release did not complete.");
  await runtime`
    update material_intelligence.material_properties
    set ifra_restricted = true, ifra_cat4_max_pct = 0, ifra_amendment = '51', updated_at = now()
    where material_id = ${lines[0].material_id}
  `;
  const blocked = await api<{ assessment: { id: string; decision: string } }>(
    actor,
    `/release-readiness/assessments/${ready.body.assessment.id}/reassess`,
    { method: "POST", tenantId }
  );
  expectStatus(blocked, 201, "G9 BLOCKED revalidation");
  if (blocked.body.assessment.decision !== "BLOCKED")
    throw new Error("G9 blocked revalidation failed.");
  const denied = await api(actor, `/production/orders/${main.id}/start`, {
    method: "POST",
    tenantId
  });
  if (denied.status !== 409) throw new Error("G9 start ignored blocked readiness.");
  await runtime`
    update material_intelligence.material_properties
    set ifra_restricted = false, ifra_cat4_max_pct = 100, ifra_amendment = '51', updated_at = now()
    where material_id = ${lines[0].material_id}
  `;
  const restored = await api<{ assessment: { id: string; decision: string } }>(
    actor,
    `/release-readiness/assessments/${blocked.body.assessment.id}/reassess`,
    { method: "POST", tenantId }
  );
  expectStatus(restored, 201, "G9 READY revalidation");
  if (restored.body.assessment.decision !== "READY")
    throw new Error("G9 READY revalidation failed.");
  const started = await api<{ batch: Batch }>(actor, `/production/orders/${main.id}/start`, {
    method: "POST",
    tenantId
  });
  expectStatus(started, 200, "G9 start");
  const duplicate = await api<{ batch: Batch }>(actor, `/production/orders/${main.id}/start`, {
    method: "POST",
    tenantId
  });
  expectStatus(duplicate, 200, "G9 duplicate start");
  if (duplicate.body.batch.id !== started.body.batch.id)
    throw new Error("G9 duplicate start created a batch.");
  const batchDetail = await api<{ batch: Batch & { allocations: Order["allocations"] } }>(
    actor,
    `/production/batches/${started.body.batch.id}`,
    { tenantId }
  );
  expectStatus(batchDetail, 200, "G9 batch detail");
  if (batchDetail.body.batch.allocations.some((item) => !item.inventoryConsumptionMovementId))
    throw new Error("G9 batch is missing consumption provenance.");
  for (const allocation of batchDetail.body.batch.allocations) {
    const trace = await api<Lot>(actor, `/inventory/lots/${allocation.inventoryLotId}`, {
      tenantId
    });
    expectStatus(trace, 200, "G9 production lot trace");
    if (
      !trace.body.movements.some(
        (movement) =>
          movement.sourceModule === "PRODUCTION" && movement.sourceReferenceId === allocation.id
      )
    )
      throw new Error("G9 production lot trace is incomplete.");
  }
  const completed = await api<{ batch: Batch }>(
    actor,
    `/production/batches/${started.body.batch.id}/complete`,
    {
      method: "POST",
      tenantId,
      body: { actualOutputMassMg: "980000", processNotes: "G9 acceptance completion" }
    }
  );
  expectStatus(completed, 200, "G9 completion");
  if (completed.body.batch.actualOutputMassMg !== "980000")
    throw new Error("G9 actual output missing.");
  const createCompletedBatch = async (label: string): Promise<Batch> => {
    const order = await allocate(await create(label), false);
    expectStatus(
      await api(actor, `/production/orders/${order.id}/release`, { method: "POST", tenantId }),
      200,
      `G10 ${label} production release`
    );
    const startedBatch = await api<{ batch: Batch }>(
      actor,
      `/production/orders/${order.id}/start`,
      { method: "POST", tenantId }
    );
    expectStatus(startedBatch, 200, `G10 ${label} production start`);
    const completedBatch = await api<{ batch: Batch }>(
      actor,
      `/production/batches/${startedBatch.body.batch.id}/complete`,
      {
        method: "POST",
        tenantId,
        body: { actualOutputMassMg: "975000", processNotes: "G10 Staging QC acceptance Batch" }
      }
    );
    expectStatus(completedBatch, 200, `G10 ${label} production completion`);
    return completedBatch.body.batch;
  };
  await runG10StagingAcceptance(page, actor, {
    tenantId,
    formulaVersionId,
    formulaMaterialId: lines[0].material_id,
    initialReadyAssessmentId: restored.body.assessment.id,
    passBatchId: completed.body.batch.id,
    failBatchId: (await createCompletedBatch("QC-FAIL")).id,
    reviewBatchId: (await createCompletedBatch("QC-REVIEW")).id,
    concurrentBatchId: (await createCompletedBatch("QC-CONCURRENT")).id
  });
  // G10 browser acceptance signs the fixture out, which revokes the API token
  // captured at G9 entry. Re-authenticate before continuing the remaining G9
  // cancellation and abort assertions; this is normal Supabase Auth, not a bypass.
  await refreshToken("B");
  actor = token("B");
  const cancel = await allocate(await create("CANCEL"), false);
  expectStatus(
    await api(actor, `/production/orders/${cancel.id}/release`, { method: "POST", tenantId }),
    200,
    "G9 cancel release"
  );
  const cancelled = await api<{ order: Order }>(actor, `/production/orders/${cancel.id}/cancel`, {
    method: "POST",
    tenantId
  });
  expectStatus(cancelled, 200, "G9 cancel");
  if (cancelled.body.order.status !== "CANCELLED") throw new Error("G9 released cancel failed.");
  const abortOrder = await allocate(await create("ABORT"), false);
  expectStatus(
    await api(actor, `/production/orders/${abortOrder.id}/release`, { method: "POST", tenantId }),
    200,
    "G9 abort release"
  );
  const abortBatch = await api<{ batch: Batch }>(
    actor,
    `/production/orders/${abortOrder.id}/start`,
    { method: "POST", tenantId }
  );
  expectStatus(abortBatch, 200, "G9 abort start");
  const aborted = await api<{ batch: Batch }>(
    actor,
    `/production/batches/${abortBatch.body.batch.id}/abort`,
    { method: "POST", tenantId, body: { reason: "G9 controlled abort" } }
  );
  expectStatus(aborted, 200, "G9 abort");
  const crossTenant = await api(actor, `/production/orders/${main.id}`, { tenantId: randomUUID() });
  if (![403, 404].includes(crossTenant.status))
    throw new Error("G9 cross-tenant production access was not denied.");
  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL("/production", stagingUrl).toString(), { waitUntil: "networkidle" });
  await expectHeading(page, "Production");
  await page.goto(new URL(`/production/batches/${started.body.batch.id}`, stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await expectVisible(page, "QC NOT ASSESSED");
  await signOutInBrowser(page);
}

async function runG10StagingAcceptance(
  page: Page,
  actor: string,
  input: {
    tenantId: string;
    formulaVersionId: string;
    formulaMaterialId: string;
    initialReadyAssessmentId: string;
    passBatchId: string;
    failBatchId: string;
    reviewBatchId: string;
    concurrentBatchId: string;
  }
): Promise<void> {
  type SpecificationItem = { id: string; checkType: string };
  type Specification = {
    id: string;
    status: string;
    formulaBundleHash: string;
    supersedesSpecificationId: string | null;
    items: SpecificationItem[];
  };
  type Result = { specificationItemId: string; judgement: string };
  type Inspection = {
    id: string;
    status: string;
    outcome: string | null;
    supersedesInspectionId: string | null;
    results: Result[];
  };
  type Decision = {
    id: string;
    decision: string;
    releaseReadinessAssessmentId: string | null;
    basisInspectionId: string | null;
  };
  type BatchView = {
    batch: {
      batchId: string;
      productionOrderId: string;
      formulaBundleHash: string;
      allocations: Array<{
        inventoryLotId: string;
        inventoryConsumptionMovementId: string;
      }>;
    };
    disposition: string;
    currentDecision: Decision | null;
  };
  const { tenantId } = input;
  const context = await api<{
    moduleAvailability: Array<{ moduleId: string; state: string }>;
    authorization: { modulePermissions: string[] };
  }>(actor, "/context", { tenantId });
  expectStatus(context, 200, "G10 Quality Control context");
  if (
    context.body.moduleAvailability.find((item) => item.moduleId === "quality-control")?.state !==
      "AVAILABLE" ||
    !context.body.authorization.modulePermissions.includes("module.quality-control.batch.release")
  )
    throw new Error("G10 Quality Control is not available with release permission.");

  const passBatch = await api<{ batch: BatchView }>(
    actor,
    `/quality-control/batches/${input.passBatchId}`,
    { tenantId }
  );
  expectStatus(passBatch, 200, "G10 completed Batch read");
  const bundleHash = passBatch.body.batch.batch.formulaBundleHash;
  const created = await api<{ specification: Specification }>(
    actor,
    "/quality-control/specifications",
    {
      method: "POST",
      tenantId,
      body: {
        specificationCode: `G10-${suffix}`,
        versionNumber: 1,
        formulaVersionId: input.formulaVersionId,
        formulaBundleHash: bundleHash,
        notes: "Exact-SHA G10 Staging acceptance"
      }
    }
  );
  expectStatus(created, 201, "G10 DRAFT specification");
  const itemInputs = [
    {
      itemOrder: 1,
      checkKey: "specific-gravity",
      name: "Specific gravity",
      checkType: "NUMERIC_RANGE",
      unitCode: "ratio",
      minValue: "0.850",
      maxValue: "0.900"
    },
    {
      itemOrder: 2,
      checkKey: "appearance-clear",
      name: "Appearance clear",
      checkType: "BOOLEAN",
      expectedBoolean: true
    },
    {
      itemOrder: 3,
      checkKey: "odor-conformance",
      name: "Odor conformance",
      checkType: "QUALITATIVE",
      acceptanceCriteriaText: "Conforms to approved reference."
    }
  ];
  const configured = await api<{ specification: Specification }>(
    actor,
    `/quality-control/specifications/${created.body.specification.id}/items`,
    { method: "PUT", tenantId, body: { items: itemInputs } }
  );
  expectStatus(configured, 200, "G10 specification items");
  const activated = await api<{ specification: Specification }>(
    actor,
    `/quality-control/specifications/${created.body.specification.id}/activate`,
    { method: "POST", tenantId }
  );
  expectStatus(activated, 200, "G10 specification activation");
  const active = activated.body.specification;
  if (active.status !== "ACTIVE" || active.items.length !== 3)
    throw new Error("G10 specification activation was incomplete.");
  if (
    (
      await api(actor, `/quality-control/specifications/${active.id}`, {
        method: "PUT",
        tenantId,
        body: { notes: "must fail" }
      })
    ).status !== 409
  )
    throw new Error("G10 ACTIVE specification was mutable.");

  const inventoryBefore = (
    await runtime<{ count: number }[]>`
      select count(*)::int as count from inventory.stock_movements where tenant_id = ${tenantId}
    `
  )[0].count;
  const productionBefore = await runtime<
    { id: string; status: string; actual_output_mass_mg: string }[]
  >`
    select batch.id, production_order.status, batch.actual_output_mass_mg::text
    from production.production_batches batch
    join production.production_orders production_order
      on production_order.tenant_id = batch.tenant_id
      and production_order.id = batch.production_order_id
    where batch.tenant_id = ${tenantId}
      and batch.id in (
        ${input.passBatchId}, ${input.failBatchId},
        ${input.reviewBatchId}, ${input.concurrentBatchId}
      )
    order by batch.id
  `;

  const createInspection = async (batchId: string): Promise<Inspection> => {
    const response = await api<{ inspection: Inspection }>(actor, "/quality-control/inspections", {
      method: "POST",
      tenantId,
      body: {
        batchId,
        specificationId: active.id,
        sampleReference: `sample-${batchId.slice(0, 8)}`
      }
    });
    expectStatus(response, 201, "G10 inspection creation");
    return response.body.inspection;
  };
  const saveResults = async (
    inspectionId: string,
    numeric: string,
    qualitative: "PASS" | "REVIEW_REQUIRED" | "FAIL"
  ): Promise<Inspection> => {
    const response = await api<{ inspection: Inspection }>(
      actor,
      `/quality-control/inspections/${inspectionId}/results`,
      {
        method: "PUT",
        tenantId,
        body: {
          results: [
            {
              checkType: "NUMERIC_RANGE",
              specificationItemId: active.items[0].id,
              observedNumericValue: numeric
            },
            {
              checkType: "BOOLEAN",
              specificationItemId: active.items[1].id,
              observedBooleanValue: true
            },
            {
              checkType: "QUALITATIVE",
              specificationItemId: active.items[2].id,
              observedText: "Observed against the approved reference.",
              judgement: qualitative
            }
          ]
        }
      }
    );
    expectStatus(response, 200, "G10 inspection results");
    return response.body.inspection;
  };
  const finalize = async (inspectionId: string): Promise<Inspection> => {
    const response = await api<{ inspection: Inspection }>(
      actor,
      `/quality-control/inspections/${inspectionId}/finalize`,
      { method: "POST", tenantId }
    );
    expectStatus(response, 200, "G10 inspection finalization");
    return response.body.inspection;
  };

  const passInspection = await createInspection(input.passBatchId);
  const forged = await api(actor, `/quality-control/inspections/${passInspection.id}/results`, {
    method: "PUT",
    tenantId,
    body: {
      results: [
        {
          checkType: "NUMERIC_RANGE",
          specificationItemId: active.items[0].id,
          observedNumericValue: "0.875",
          judgement: "PASS"
        }
      ]
    }
  });
  if (forged.status !== 400) throw new Error("G10 accepted browser-authored numeric judgement.");
  const incomplete = await api(actor, `/quality-control/inspections/${passInspection.id}/results`, {
    method: "PUT",
    tenantId,
    body: {
      results: [
        {
          checkType: "NUMERIC_RANGE",
          specificationItemId: active.items[0].id,
          observedNumericValue: "0.850"
        }
      ]
    }
  });
  expectStatus(incomplete, 200, "G10 incomplete draft results");
  if (
    (
      await api(actor, `/quality-control/inspections/${passInspection.id}/finalize`, {
        method: "POST",
        tenantId
      })
    ).status !== 409
  )
    throw new Error("G10 finalized an incomplete inspection.");
  const passResults = await saveResults(passInspection.id, "0.850", "PASS");
  if (
    passResults.results.find((result) => result.specificationItemId === active.items[0].id)
      ?.judgement !== "PASS" ||
    passResults.results.find((result) => result.specificationItemId === active.items[1].id)
      ?.judgement !== "PASS" ||
    passResults.results.find((result) => result.specificationItemId === active.items[2].id)
      ?.judgement !== "PASS"
  )
    throw new Error("G10 judgement authority did not preserve server/human boundaries.");
  const finalPass = await finalize(passInspection.id);
  if (finalPass.outcome !== "PASS") throw new Error("G10 PASS outcome was not derived.");
  if (
    (
      await api(actor, `/quality-control/inspections/${passInspection.id}/results`, {
        method: "PUT",
        tenantId,
        body: {
          results: [
            {
              checkType: "NUMERIC_RANGE",
              specificationItemId: active.items[0].id,
              observedNumericValue: "0.851"
            }
          ]
        }
      })
    ).status !== 409
  )
    throw new Error("G10 FINAL inspection was mutable.");
  const pendingDisposition = await api<{ batch: BatchView }>(
    actor,
    `/quality-control/batches/${input.passBatchId}`,
    { tenantId }
  );
  expectStatus(pendingDisposition, 200, "G10 PASS without automatic release");
  if (pendingDisposition.body.batch.disposition !== "PENDING_QC")
    throw new Error("G10 QC PASS automatically released a Batch.");

  await runtime`
    update material_intelligence.material_properties
    set ifra_amendment = null, ifra_source_reference = null, updated_at = now()
    where material_id = ${input.formulaMaterialId}
  `;
  const reviewReadiness = await api<{ assessment: { id: string; decision: string } }>(
    actor,
    `/release-readiness/assessments/${input.initialReadyAssessmentId}/reassess`,
    { method: "POST", tenantId }
  );
  expectStatus(reviewReadiness, 201, "G10 current REVIEW_REQUIRED readiness");
  if (reviewReadiness.body.assessment.decision !== "REVIEW_REQUIRED")
    throw new Error("G10 could not establish current G6 REVIEW_REQUIRED.");
  if (
    (
      await api(actor, `/quality-control/batches/${input.passBatchId}/release`, {
        method: "POST",
        tenantId
      })
    ).status !== 409
  )
    throw new Error("G10 RELEASE ignored current non-READY G6 state.");
  await runtime`
    update material_intelligence.material_properties
    set ifra_restricted = false, ifra_cat4_max_pct = 100,
      ifra_amendment = '51', ifra_source_reference = 'g10-staging', updated_at = now()
    where material_id = ${input.formulaMaterialId}
  `;
  const ready = await api<{ assessment: { id: string; decision: string } }>(
    actor,
    `/release-readiness/assessments/${reviewReadiness.body.assessment.id}/reassess`,
    { method: "POST", tenantId }
  );
  expectStatus(ready, 201, "G10 current READY readiness");
  if (ready.body.assessment.decision !== "READY")
    throw new Error("G10 could not restore current G6 READY.");
  const release = await api<{ decision: Decision }>(
    actor,
    `/quality-control/batches/${input.passBatchId}/release`,
    { method: "POST", tenantId }
  );
  expectStatus(release, 200, "G10 explicit release");
  if (
    release.body.decision.decision !== "RELEASED" ||
    release.body.decision.releaseReadinessAssessmentId !== ready.body.assessment.id ||
    release.body.decision.basisInspectionId !== finalPass.id
  )
    throw new Error("G10 RELEASE did not pin current inspection and G6 READY evidence.");
  if (
    (
      await api(actor, `/quality-control/batches/${input.passBatchId}/hold`, {
        method: "POST",
        tenantId,
        body: { reason: "must fail" }
      })
    ).status !== 409
  )
    throw new Error("G10 RELEASED Batch reopened.");

  const failInspection = await createInspection(input.failBatchId);
  await saveResults(failInspection.id, "0.900001", "PASS");
  if ((await finalize(failInspection.id)).outcome !== "FAIL")
    throw new Error("G10 exact upper-bound failure was not derived.");
  const rejection = await api<{ decision: Decision }>(
    actor,
    `/quality-control/batches/${input.failBatchId}/reject`,
    {
      method: "POST",
      tenantId,
      body: { reason: "Numeric result exceeded the specification." }
    }
  );
  expectStatus(rejection, 200, "G10 reject");
  if (rejection.body.decision.decision !== "REJECTED")
    throw new Error("G10 REJECT did not become terminal.");
  if (
    (
      await api(actor, `/quality-control/batches/${input.failBatchId}/release`, {
        method: "POST",
        tenantId
      })
    ).status !== 409
  )
    throw new Error("G10 REJECTED Batch reopened.");

  const reviewInspection = await createInspection(input.reviewBatchId);
  await saveResults(reviewInspection.id, "0.875", "REVIEW_REQUIRED");
  if ((await finalize(reviewInspection.id)).outcome !== "REVIEW_REQUIRED")
    throw new Error("G10 REVIEW_REQUIRED precedence failed.");
  const hold = await api<{ decision: Decision }>(
    actor,
    `/quality-control/batches/${input.reviewBatchId}/hold`,
    { method: "POST", tenantId, body: { reason: "Retest required." } }
  );
  expectStatus(hold, 200, "G10 HOLD");
  const cancelledRetest = await api<{ inspection: Inspection }>(
    actor,
    `/quality-control/inspections/${reviewInspection.id}/reinspect`,
    { method: "POST", tenantId, body: { retestReason: "Sample compromised." } }
  );
  expectStatus(cancelledRetest, 201, "G10 reinspection");
  expectStatus(
    await api(actor, `/quality-control/inspections/${cancelledRetest.body.inspection.id}/cancel`, {
      method: "POST",
      tenantId
    }),
    200,
    "G10 cancelled reinspection"
  );
  const retest = await api<{ inspection: Inspection }>(
    actor,
    `/quality-control/inspections/${reviewInspection.id}/reinspect`,
    { method: "POST", tenantId, body: { retestReason: "Fresh controlled sample." } }
  );
  expectStatus(retest, 201, "G10 reinspection recovery");
  if (retest.body.inspection.supersedesInspectionId !== reviewInspection.id)
    throw new Error("G10 reinspection lineage was not preserved.");
  await saveResults(retest.body.inspection.id, "0.900", "PASS");
  if ((await finalize(retest.body.inspection.id)).outcome !== "PASS")
    throw new Error("G10 reinspection did not become current PASS evidence.");
  const releaseAfterHold = await api<{ decision: Decision }>(
    actor,
    `/quality-control/batches/${input.reviewBatchId}/release`,
    { method: "POST", tenantId }
  );
  expectStatus(releaseAfterHold, 200, "G10 release after HOLD");
  if (releaseAfterHold.body.decision.decision !== "RELEASED")
    throw new Error("G10 HOLD was not superseded by explicit RELEASE.");

  const concurrentInspection = await createInspection(input.concurrentBatchId);
  await saveResults(concurrentInspection.id, "0.875", "PASS");
  await finalize(concurrentInspection.id);
  const terminal = await Promise.all([
    api(actor, `/quality-control/batches/${input.concurrentBatchId}/release`, {
      method: "POST",
      tenantId
    }),
    api(actor, `/quality-control/batches/${input.concurrentBatchId}/release`, {
      method: "POST",
      tenantId
    })
  ]);
  if (
    terminal.filter((value) => value.status === 200).length !== 1 ||
    terminal.filter((value) => value.status === 409).length !== 1
  )
    throw new Error("G10 concurrent terminal decisions did not serialize.");

  const replacement = await api<{ specification: Specification }>(
    actor,
    "/quality-control/specifications",
    {
      method: "POST",
      tenantId,
      body: {
        specificationCode: `G10-${suffix}`,
        versionNumber: 2,
        formulaVersionId: input.formulaVersionId,
        formulaBundleHash: bundleHash,
        supersedesSpecificationId: active.id,
        notes: "Controlled replacement"
      }
    }
  );
  expectStatus(replacement, 201, "G10 replacement DRAFT specification");
  expectStatus(
    await api(actor, `/quality-control/specifications/${replacement.body.specification.id}/items`, {
      method: "PUT",
      tenantId,
      body: { items: itemInputs }
    }),
    200,
    "G10 replacement specification items"
  );
  const replacementActive = await api<{ specification: Specification }>(
    actor,
    `/quality-control/specifications/${replacement.body.specification.id}/activate`,
    { method: "POST", tenantId }
  );
  expectStatus(replacementActive, 200, "G10 atomic specification replacement");
  const old = await api<{ specification: Specification }>(
    actor,
    `/quality-control/specifications/${active.id}`,
    { tenantId }
  );
  expectStatus(old, 200, "G10 retired specification history");
  if (
    old.body.specification.status !== "RETIRED" ||
    replacementActive.body.specification.status !== "ACTIVE" ||
    replacementActive.body.specification.supersedesSpecificationId !== active.id
  )
    throw new Error("G10 specification replacement did not preserve lineage.");

  const crossTenant = await api(actor, `/quality-control/batches/${input.passBatchId}`, {
    tenantId: randomUUID()
  });
  if (![403, 404].includes(crossTenant.status))
    throw new Error("G10 cross-tenant Batch disposition leaked.");
  const inventoryAfter = (
    await runtime<{ count: number }[]>`
      select count(*)::int as count from inventory.stock_movements where tenant_id = ${tenantId}
    `
  )[0].count;
  const productionAfter = await runtime<
    { id: string; status: string; actual_output_mass_mg: string }[]
  >`
    select batch.id, production_order.status, batch.actual_output_mass_mg::text
    from production.production_batches batch
    join production.production_orders production_order
      on production_order.tenant_id = batch.tenant_id
      and production_order.id = batch.production_order_id
    where batch.tenant_id = ${tenantId}
      and batch.id in (
        ${input.passBatchId}, ${input.failBatchId},
        ${input.reviewBatchId}, ${input.concurrentBatchId}
      )
    order by batch.id
  `;
  if (
    inventoryAfter !== inventoryBefore ||
    JSON.stringify(productionAfter) !== JSON.stringify(productionBefore)
  )
    throw new Error("G10 mutated G7 inventory or G9 Batch truth.");
  const trace = await api<{ batch: BatchView }>(
    actor,
    `/quality-control/batches/${input.passBatchId}`,
    { tenantId }
  );
  expectStatus(trace, 200, "G10 Batch release trace");
  if (
    trace.body.batch.currentDecision?.decision !== "RELEASED" ||
    trace.body.batch.batch.allocations.length === 0 ||
    trace.body.batch.batch.allocations.some(
      (allocation) => !allocation.inventoryLotId || !allocation.inventoryConsumptionMovementId
    )
  )
    throw new Error("G10 Batch-to-release-to-input-Lot trace is incomplete.");
  const auditRows = await maintenance<{ action: string; actor_user_id: string | null }[]>`
    select action, actor_user_id::text
    from platform.audit_events
    where tenant_id = ${tenantId}
      and action in (
        'quality-control.specification.activated',
        'quality-control.inspection.finalized',
        'quality-control.batch.released',
        'quality-control.batch.rejected'
      )
  `;
  for (const action of [
    "quality-control.specification.activated",
    "quality-control.inspection.finalized",
    "quality-control.batch.released",
    "quality-control.batch.rejected"
  ])
    if (!auditRows.some((row) => row.action === action && row.actor_user_id === fixture("B").id))
      throw new Error(`G10 authenticated AuditEvent ${action} is missing.`);

  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL("/quality-control", stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await expectHeading(page, "Quality Control");
  await page.goto(new URL(`/quality-control/batches/${input.passBatchId}`, stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await expectVisible(page, "RELEASED");
  await signOutInBrowser(page);
}

async function runG7OperationalAcceptance(
  page: Page,
  actor: string,
  tenantA: string,
  tenantB: string,
  formulaVersionId: string
): Promise<void> {
  type LotDetail = {
    lot: {
      id: string;
      materialId: string;
      lotCode: string;
      balances: Array<{
        locationId: string;
        onHandMg: string;
        reservedMg: string;
        availableMg: string;
      }>;
    };
    movements: Array<{ id: string; operationKey: string; quantityMg: string }>;
    reservations: Array<{ id: string; status: string; quantityMg: string }>;
  };
  const context = await api<{
    moduleAvailability: Array<{ moduleId: string; state: string }>;
    authorization: { modulePermissions: string[] };
  }>(actor, "/context", { tenantId: tenantA });
  expectStatus(context, 200, "G7 tenant context");
  if (
    context.body.moduleAvailability.find((item) => item.moduleId === "inventory")?.state !==
      "AVAILABLE" ||
    !context.body.authorization.modulePermissions.includes("module.inventory.stock.consume")
  )
    throw new Error("Inventory module availability or permissions are incomplete.");

  const stock = inventoryStock.get(tenantA);
  const first = stock ? [...stock.lots.entries()][0] : undefined;
  if (!stock || !first) throw new Error("G7 acceptance stock was not reconciled.");
  const [materialId, lotId] = first;
  const secondLocation = await api<{ location: { id: string } }>(actor, "/inventory/locations", {
    method: "POST",
    tenantId: tenantA,
    body: {
      locationCode: `SECOND-${suffix.slice(0, 10).toUpperCase()}`,
      name: "Staging Secondary Lab",
      description: "Gate 7 transfer acceptance"
    }
  });
  expectStatus(secondLocation, 201, "G7 secondary Location");

  const manualReservation = await api<{ reservation: { id: string } }>(
    actor,
    `/inventory/lots/${lotId}/reservations`,
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        locationId: stock.locationId,
        quantityMg: "1000",
        sourceReferenceId: "G7-MANUAL-ACCEPTANCE",
        operationKey: `staging:${suffix}:manual-reservation`
      }
    }
  );
  expectStatus(manualReservation, 201, "G7 manual reservation");
  const afterReservation = await api<LotDetail>(actor, `/inventory/lots/${lotId}`, {
    tenantId: tenantA
  });
  expectStatus(afterReservation, 200, "G7 reservation balance");
  const balance = afterReservation.body.lot.balances.find(
    (item) => item.locationId === stock.locationId
  );
  if (
    !balance ||
    BigInt(balance.onHandMg) - BigInt(balance.reservedMg) !== BigInt(balance.availableMg)
  )
    throw new Error("G7 derived Available balance is invalid.");
  expectError(
    await api(actor, `/inventory/lots/${lotId}/consume`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: (BigInt(balance.availableMg) + 1n).toString(),
        fromLocationId: stock.locationId,
        reasonCode: "RESERVED_STOCK_PROBE",
        operationKey: `staging:${suffix}:reserved-stock-probe`
      }
    }),
    409,
    "INSUFFICIENT_AVAILABLE_STOCK",
    "G7 reserved stock protection"
  );
  expectStatus(
    await api(actor, `/inventory/reservations/${manualReservation.body.reservation.id}/consume`, {
      method: "POST",
      tenantId: tenantA,
      body: { operationKey: `staging:${suffix}:manual-reservation-consume` }
    }),
    200,
    "G7 reservation consumption"
  );

  for (const transition of ["release", "cancel"] as const) {
    const created = await api<{ reservation: { id: string } }>(
      actor,
      `/inventory/lots/${lotId}/reservations`,
      {
        method: "POST",
        tenantId: tenantA,
        body: {
          locationId: stock.locationId,
          quantityMg: "100",
          sourceReferenceId: `G7-MANUAL-${transition.toUpperCase()}`,
          operationKey: `staging:${suffix}:manual-reservation-${transition}`
        }
      }
    );
    expectStatus(created, 201, `G7 manual reservation ${transition}`);
    expectStatus(
      await api(actor, `/inventory/reservations/${created.body.reservation.id}/${transition}`, {
        method: "POST",
        tenantId: tenantA,
        body: { operationKey: `staging:${suffix}:manual-${transition}` }
      }),
      200,
      `G7 reservation ${transition}`
    );
    expectError(
      await api(actor, `/inventory/reservations/${created.body.reservation.id}/${transition}`, {
        method: "POST",
        tenantId: tenantA,
        body: { operationKey: `staging:${suffix}:manual-${transition}:again` }
      }),
      409,
      "RESERVATION_ALREADY_TERMINAL",
      `G7 terminal reservation ${transition}`
    );
  }

  const transferKey = `staging:${suffix}:transfer`;
  const transferBody = {
    quantityMg: "1000",
    fromLocationId: stock.locationId,
    toLocationId: secondLocation.body.location.id,
    reasonCode: "G7_TRANSFER_ACCEPTANCE",
    operationKey: transferKey
  };
  expectStatus(
    await api(actor, `/inventory/lots/${lotId}/transfer`, {
      method: "POST",
      tenantId: tenantA,
      body: transferBody
    }),
    201,
    "G7 atomic transfer"
  );
  expectStatus(
    await api(actor, `/inventory/lots/${lotId}/transfer`, {
      method: "POST",
      tenantId: tenantA,
      body: transferBody
    }),
    201,
    "G7 idempotent transfer retry"
  );
  expectError(
    await api(actor, `/inventory/lots/${lotId}/transfer`, {
      method: "POST",
      tenantId: tenantA,
      body: { ...transferBody, quantityMg: "999" }
    }),
    409,
    "IDEMPOTENCY_CONFLICT",
    "G7 conflicting operation key"
  );
  const afterTransfer = await api<LotDetail>(actor, `/inventory/lots/${lotId}`, {
    tenantId: tenantA
  });
  expectStatus(afterTransfer, 200, "G7 transfer ledger");
  if (afterTransfer.body.movements.filter((item) => item.operationKey === transferKey).length !== 1)
    throw new Error("Idempotent transfer retry appended duplicate Movement truth.");
  expectError(
    await api(actor, `/inventory/locations/${secondLocation.body.location.id}/archive`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "LOCATION_NOT_EMPTY",
    "G7 Location archive guard"
  );
  expectError(
    await api(actor, `/inventory/lots/${lotId}/close`, { method: "POST", tenantId: tenantA }),
    409,
    "LOT_NOT_EMPTY",
    "G7 Lot close guard"
  );
  expectError(
    await api(actor, `/inventory/lots/${lotId}`, {
      method: "PUT",
      tenantId: tenantA,
      body: { lotCode: `${afterTransfer.body.lot.lotCode}-MUTATED` }
    }),
    409,
    "LOT_IDENTITY_IMMUTABLE",
    "G7 Lot identity immutability"
  );

  const emptyLocation = await api<{ location: { id: string } }>(actor, "/inventory/locations", {
    method: "POST",
    tenantId: tenantA,
    body: {
      locationCode: `EMPTY-${suffix.slice(0, 10).toUpperCase()}`,
      name: "Staging Empty Archive Probe",
      description: null
    }
  });
  expectStatus(emptyLocation, 201, "G7 empty Location");
  expectStatus(
    await api(actor, `/inventory/locations/${emptyLocation.body.location.id}/archive`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 empty Location archive"
  );

  const lifecycleLot = await createG7Lot(actor, tenantA, materialId, stock.locationId, {
    lotCode: `LIFE-${suffix.slice(0, 8)}`,
    quantityMg: "100",
    expiresAt: null,
    retestAt: null
  });
  expectStatus(
    await api(actor, `/inventory/lots/${lifecycleLot}/adjust`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        direction: "IN",
        quantityMg: "100",
        locationId: stock.locationId,
        reasonCode: "G7_ADJUSTMENT_IN_ACCEPTANCE",
        operationKey: `staging:${suffix}:adjustment-in`
      }
    }),
    201,
    "G7 adjustment in"
  );
  expectStatus(
    await api(actor, `/inventory/lots/${lifecycleLot}/adjust`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        direction: "OUT",
        quantityMg: "50",
        locationId: stock.locationId,
        reasonCode: "G7_ADJUSTMENT_OUT_ACCEPTANCE",
        operationKey: `staging:${suffix}:adjustment-out`
      }
    }),
    201,
    "G7 adjustment out"
  );
  expectStatus(
    await api(actor, `/inventory/lots/${lifecycleLot}/dispose`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: "150",
        fromLocationId: stock.locationId,
        reasonCode: "G7_DISPOSAL_ACCEPTANCE",
        operationKey: `staging:${suffix}:disposal`
      }
    }),
    201,
    "G7 disposal"
  );
  expectStatus(
    await api(actor, `/inventory/lots/${lifecycleLot}/close`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 zero-balance Lot close"
  );

  expectStatus(
    await api(actor, `/inventory/lots/${lotId}/hold`, { method: "POST", tenantId: tenantA }),
    200,
    "G7 Lot HOLD"
  );
  expectError(
    await api(actor, `/inventory/lots/${lotId}/reservations`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        locationId: stock.locationId,
        quantityMg: "1",
        operationKey: `staging:${suffix}:hold-reservation`
      }
    }),
    409,
    "LOT_ON_HOLD",
    "G7 HOLD reservation denial"
  );
  expectStatus(
    await api(actor, `/inventory/lots/${lotId}/release-hold`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 Lot HOLD release"
  );

  const expired = await createG7Lot(actor, tenantA, materialId, stock.locationId, {
    lotCode: `EXP-${suffix.slice(0, 8)}`,
    quantityMg: "1000",
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    retestAt: null
  });
  expectError(
    await api(actor, `/inventory/lots/${expired}/reservations`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        locationId: stock.locationId,
        quantityMg: "1",
        operationKey: `staging:${suffix}:expired-reservation`
      }
    }),
    409,
    "LOT_EXPIRED",
    "G7 expiry reservation denial"
  );
  const retest = await createG7Lot(actor, tenantA, materialId, stock.locationId, {
    lotCode: `RETEST-${suffix.slice(0, 8)}`,
    quantityMg: "1000",
    expiresAt: null,
    retestAt: new Date(Date.now() - 86_400_000).toISOString()
  });
  const retestDetail = await api<{ lot: { retestAt: string | null } }>(
    actor,
    `/inventory/lots/${retest}`,
    { tenantId: tenantA }
  );
  expectStatus(retestDetail, 200, "G7 retest warning source");
  if (!retestDetail.body.lot.retestAt) throw new Error("G7 retest warning metadata was lost.");

  const reservationRace = await createG7Lot(actor, tenantA, materialId, stock.locationId, {
    lotCode: `RRACE-${suffix.slice(0, 8)}`,
    quantityMg: "1000",
    expiresAt: null,
    retestAt: null
  });
  const reservationResults = await Promise.all([
    api(actor, `/inventory/lots/${reservationRace}/reservations`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        locationId: stock.locationId,
        quantityMg: "700",
        operationKey: `staging:${suffix}:rrace:a`
      }
    }),
    api(actor, `/inventory/lots/${reservationRace}/reservations`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        locationId: stock.locationId,
        quantityMg: "700",
        operationKey: `staging:${suffix}:rrace:b`
      }
    })
  ]);
  if (
    reservationResults.filter((item) => item.status === 201).length !== 1 ||
    reservationResults.filter((item) => item.status === 409).length !== 1
  )
    throw new Error("Concurrent reservations oversubscribed stock or both failed.");

  const consumptionRace = await createG7Lot(actor, tenantA, materialId, stock.locationId, {
    lotCode: `CRACE-${suffix.slice(0, 8)}`,
    quantityMg: "1000",
    expiresAt: null,
    retestAt: null
  });
  const consumptionResults = await Promise.all([
    api(actor, `/inventory/lots/${consumptionRace}/consume`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: "700",
        fromLocationId: stock.locationId,
        operationKey: `staging:${suffix}:crace:a`
      }
    }),
    api(actor, `/inventory/lots/${consumptionRace}/consume`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: "700",
        fromLocationId: stock.locationId,
        operationKey: `staging:${suffix}:crace:b`
      }
    })
  ]);
  if (
    consumptionResults.filter((item) => item.status === 201).length !== 1 ||
    consumptionResults.filter((item) => item.status === 409).length !== 1
  )
    throw new Error("Concurrent consumption made stock negative or both failed.");

  const rollbackTrial = await api<{ trial: { id: string } }>(actor, "/trials", {
    method: "POST",
    tenantId: tenantA,
    body: {
      formulaVersionId,
      preparationMode: "CONCENTRATE",
      applicationKey: "g7-atomic-rollback",
      dosagePct: 20,
      targetMassMg: "20000"
    }
  });
  expectStatus(rollbackTrial, 201, "G7 rollback Trial");
  expectStatus(
    await allocateTrialInventory(actor, tenantA, rollbackTrial.body.trial.id),
    201,
    "G7 rollback Trial reservation"
  );
  const rollbackInventory = await api<{
    availability: {
      activeReservations: Array<{
        lotId: string;
        locationId: string;
        quantityMg: string;
        status: string;
      }>;
    };
  }>(actor, `/trials/${rollbackTrial.body.trial.id}/inventory`, { tenantId: tenantA });
  expectStatus(rollbackInventory, 200, "G7 rollback Trial Inventory");
  const protectedReservation = rollbackInventory.body.availability.activeReservations[0];
  if (!protectedReservation) throw new Error("G7 rollback Trial has no ACTIVE reservation.");
  const protectedLot = await api<LotDetail>(
    actor,
    `/inventory/lots/${protectedReservation.lotId}`,
    { tenantId: tenantA }
  );
  expectStatus(protectedLot, 200, "G7 Trial-reserved Lot");
  const protectedBalance = protectedLot.body.lot.balances.find(
    (item) => item.locationId === protectedReservation.locationId
  );
  if (!protectedBalance) throw new Error("G7 Trial-reserved balance is missing.");
  expectError(
    await api(actor, `/inventory/lots/${protectedReservation.lotId}/consume`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: (BigInt(protectedBalance.availableMg) + 1n).toString(),
        fromLocationId: protectedReservation.locationId,
        reasonCode: "G7_TRIAL_RESERVATION_PROTECTION",
        operationKey: `staging:${suffix}:trial-reservation-protection`
      }
    }),
    409,
    "INSUFFICIENT_AVAILABLE_STOCK",
    "G7 Trial allocation vs manual consumption"
  );
  expectStatus(
    await api(actor, `/inventory/lots/${protectedReservation.lotId}/hold`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 rollback Lot HOLD"
  );
  expectError(
    await api(actor, `/trials/${rollbackTrial.body.trial.id}/prepare`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "TRIAL_INVENTORY_NOT_READY",
    "G7 multi-material prepare rollback"
  );
  const rollbackState = await api<{
    trial: { status: string };
  }>(actor, `/trials/${rollbackTrial.body.trial.id}`, { tenantId: tenantA });
  expectStatus(rollbackState, 200, "G7 rollback Trial state");
  const rollbackTrace = await api<{ trace: { movements: unknown[] } }>(
    actor,
    `/inventory/trials/${rollbackTrial.body.trial.id}/trace`,
    { tenantId: tenantA }
  );
  expectStatus(rollbackTrace, 200, "G7 rollback Trial trace");
  if (
    rollbackState.body.trial.status !== "DRAFT" ||
    rollbackTrace.body.trace.movements.length !== 0
  )
    throw new Error("G7 failed prepare partially committed Trial or Inventory truth.");
  expectStatus(
    await api(actor, `/inventory/lots/${protectedReservation.lotId}/release-hold`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 rollback Lot HOLD release"
  );
  expectStatus(
    await api(actor, `/trials/${rollbackTrial.body.trial.id}/cancel`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G7 rollback Trial cleanup"
  );

  const concurrentTrial = await api<{ trial: { id: string } }>(actor, "/trials", {
    method: "POST",
    tenantId: tenantA,
    body: {
      formulaVersionId,
      preparationMode: "CONCENTRATE",
      applicationKey: "g7-concurrent-prepare",
      dosagePct: 20,
      targetMassMg: "20000"
    }
  });
  expectStatus(concurrentTrial, 201, "G7 concurrent Trial");
  const splitPlan = await api<{
    plan: { requirements: Array<{ materialId: string; requiredMassMg: string }> };
  }>(actor, `/trials/${concurrentTrial.body.trial.id}/preparation-plan`, { tenantId: tenantA });
  expectStatus(splitPlan, 200, "G7 split-lot Trial preparation plan");
  const splitRequirement = splitPlan.body.plan.requirements.find(
    (item) => BigInt(item.requiredMassMg) > 1n
  );
  if (!splitRequirement) throw new Error("G7 split-lot acceptance requires a splittable line.");
  const splitStock = inventoryStock.get(tenantA);
  const primarySplitLot = splitStock?.lots.get(splitRequirement.materialId);
  if (!splitStock || !primarySplitLot) throw new Error("G7 split-lot stock is unavailable.");
  const secondarySplitLot = await createG7Lot(
    actor,
    tenantA,
    splitRequirement.materialId,
    splitStock.locationId,
    {
      lotCode: `SPLIT-${suffix.slice(0, 8)}`,
      quantityMg: "1000000",
      expiresAt: null,
      retestAt: null
    }
  );
  const allocations = splitPlan.body.plan.requirements.flatMap((requirement) => {
    const primaryLot = splitStock.lots.get(requirement.materialId);
    if (!primaryLot) throw new Error("G7 Trial preparation stock is incomplete.");
    if (requirement.materialId !== splitRequirement.materialId)
      return [
        {
          materialId: requirement.materialId,
          lotId: primaryLot,
          locationId: splitStock.locationId,
          quantityMg: requirement.requiredMassMg
        }
      ];
    const required = BigInt(requirement.requiredMassMg);
    return [
      {
        materialId: requirement.materialId,
        lotId: primarySplitLot,
        locationId: splitStock.locationId,
        quantityMg: (required - 1n).toString()
      },
      {
        materialId: requirement.materialId,
        lotId: secondarySplitLot,
        locationId: splitStock.locationId,
        quantityMg: "1"
      }
    ];
  });
  const splitReservationBody = {
    allocations,
    operationKey: `staging:${suffix}:split-trial:${concurrentTrial.body.trial.id}`
  };
  for (const label of ["reservation", "reservation idempotent retry"]) {
    expectStatus(
      await api(actor, `/trials/${concurrentTrial.body.trial.id}/inventory/reservations`, {
        method: "POST",
        tenantId: tenantA,
        body: splitReservationBody
      }),
      201,
      `G7 split-lot concurrent Trial ${label}`
    );
  }
  const splitInventory = await api<{
    availability: { activeReservations: unknown[] };
  }>(actor, `/trials/${concurrentTrial.body.trial.id}/inventory`, { tenantId: tenantA });
  expectStatus(splitInventory, 200, "G7 split-lot reservation trace");
  if (splitInventory.body.availability.activeReservations.length !== allocations.length)
    throw new Error("G7 Trial reservation retry created duplicate Reservation truth.");
  const prepareResults = await Promise.all([
    api(actor, `/trials/${concurrentTrial.body.trial.id}/prepare`, {
      method: "POST",
      tenantId: tenantA
    }),
    api(actor, `/trials/${concurrentTrial.body.trial.id}/prepare`, {
      method: "POST",
      tenantId: tenantA
    })
  ]);
  if (
    prepareResults.filter((item) => item.status === 200).length !== 1 ||
    prepareResults.filter((item) => item.status === 409).length !== 1
  )
    throw new Error("Concurrent Trial prepare was not serialized exactly once.");
  await assertTrialConsumption(actor, tenantA, concurrentTrial.body.trial.id, 20_000n);
  const splitTrace = await api<{
    trace: { movements: Array<{ materialId: string; lotId: string; sourceModule: string }> };
  }>(actor, `/inventory/trials/${concurrentTrial.body.trial.id}/trace`, { tenantId: tenantA });
  expectStatus(splitTrace, 200, "G7 split-lot Trial trace");
  const splitMovements = splitTrace.body.trace.movements.filter(
    (item) => item.materialId === splitRequirement.materialId
  );
  if (
    splitMovements.length !== 2 ||
    new Set(splitMovements.map((item) => item.lotId)).size !== 2 ||
    splitMovements.some((item) => item.sourceModule !== "TRIAL")
  )
    throw new Error("G7 split-lot Trial did not persist two exact TRIAL consumptions.");

  expectError(
    await api(token("A"), `/inventory/lots/${lotId}/consume`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: "1",
        fromLocationId: stock.locationId,
        operationKey: `staging:${suffix}:member-forbidden`
      }
    }),
    403,
    "PERMISSION_DENIED",
    "G7 RBAC fail closed"
  );
  expectError(
    await api(token("E"), `/inventory/lots/${lotId}`, { tenantId: tenantB }),
    404,
    "LOT_NOT_FOUND",
    "G7 cross-tenant Lot read"
  );
  for (const sourceModule of ["TRIAL", "PROCUREMENT", "PRODUCTION"] as const) {
    const forged = await api(actor, `/inventory/lots/${lotId}/receive`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        quantityMg: "1",
        toLocationId: stock.locationId,
        operationKey: `staging:${suffix}:forged-provenance:${sourceModule}`,
        sourceModule
      }
    });
    if (forged.status !== 400)
      throw new Error(`Browser forged ${sourceModule} provenance was accepted.`);
  }

  const movementId = afterTransfer.body.movements.find(
    (item) => item.operationKey === transferKey
  )?.id;
  if (!movementId) throw new Error("G7 append-only movement probe is missing its target.");
  for (const operation of ["update", "delete"] as const) {
    let rejected = false;
    try {
      if (operation === "update")
        await maintenance`update inventory.stock_movements set reason_code = 'FORBIDDEN' where tenant_id = ${tenantA} and id = ${movementId}`;
      else
        await maintenance`delete from inventory.stock_movements where tenant_id = ${tenantA} and id = ${movementId}`;
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`G7 Movement append-only ${operation} guard did not reject.`);
  }

  const actorAudit = await maintenance<{ actor_user_id: string | null }[]>`
    select actor_user_id::text from platform.audit_events
    where tenant_id = ${tenantA} and action = 'inventory.stock.transferred'
      and metadata->>'operationKey' = ${transferKey}
  `;
  if (actorAudit.length === 0 || actorAudit.some((item) => item.actor_user_id !== fixture("B").id))
    throw new Error("G7 AuditEvent actor provenance is missing or forged.");

  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL("/inventory", stagingUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Inventory Registry" }).waitFor({ state: "visible" });
  await captureG7(page, "inventory-registry-desktop", "/inventory");
  await page.goto(new URL(`/inventory/lots/${lotId}`, stagingUrl).toString(), {
    waitUntil: "networkidle"
  });
  await page
    .getByRole("heading", { name: new RegExp(afterTransfer.body.lot.lotCode) })
    .waitFor({ state: "visible" });
  await captureG7(page, "inventory-lot-detail-desktop", `/inventory/lots/${lotId}`);
  await signOutInBrowser(page);

  console.log("G7_STAGING_INVENTORY_ACCEPTANCE=PASS");
  console.log("G7_STAGING_LEDGER_AND_RESERVATION=PASS");
  console.log("G7_STAGING_TRIAL_ATOMICITY=PASS");
  console.log("G7_STAGING_CONCURRENCY=PASS");
  console.log("G7_STAGING_TENANT_RBAC=PASS");
}

async function runG8OperationalAcceptance(
  page: Page,
  actor: string,
  tenantA: string,
  tenantB: string
): Promise<void> {
  type Po = {
    id: string;
    status: string;
    supplierId: string;
    lines: Array<{
      id: string;
      materialId: string;
      receivedQuantityMg: string;
      remainingQuantityMg: string;
    }>;
  };
  type Receipt = {
    id: string;
    status: string;
    purchaseOrderId: string;
    supplierId: string;
    lines: Array<{
      id: string;
      inventoryLotId: string | null;
      inventoryMovementId: string | null;
      receivedQuantityMg: string;
    }>;
  };
  type LotTrace = {
    lot: { id: string; materialId: string; lotCode: string };
    movements: Array<{
      id: string;
      sourceModule: string;
      sourceReferenceId: string | null;
      quantityMg: string;
    }>;
  };
  const stock = inventoryStock.get(tenantA);
  const approvedMaterialId = stock ? [...stock.lots.keys()][0] : undefined;
  if (!stock || !approvedMaterialId)
    throw new Error("G8 Staging requires the accepted G3 Material and G7 Location seam.");

  const context = await api<{
    moduleAvailability: Array<{ moduleId: string; state: string }>;
    authorization: { modulePermissions: string[] };
  }>(actor, "/context", { tenantId: tenantA });
  expectStatus(context, 200, "G8 tenant context");
  if (
    context.body.moduleAvailability.find((item) => item.moduleId === "procurement")?.state !==
      "AVAILABLE" ||
    !context.body.authorization.modulePermissions.includes("module.procurement.receipt.post")
  )
    throw new Error("G8 Procurement is not AVAILABLE for the accepted tenant owner.");

  const pending = await api<{ material: MaterialSummary }>(token("A"), "/materials", {
    method: "POST",
    tenantId: tenantA,
    body: {
      displayName: `G8 Pending Material ${suffix.slice(0, 8)}`,
      materialType: "NATURAL",
      odorAssignments: []
    }
  });
  expectStatus(pending, 201, "G8 PENDING_REVIEW Material fixture");
  materialIds.push(pending.body.material.id);
  if (pending.body.material.approvalStatus !== "PENDING_REVIEW")
    throw new Error("G8 pending Material fixture was not PENDING_REVIEW.");

  const supplier = await api<{ supplier: { id: string; status: string } }>(
    actor,
    "/procurement/suppliers",
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        supplierCode: `G8-${suffix.slice(0, 12).toUpperCase()}`,
        legalName: `G8 Staging Supplier ${suffix}`,
        displayName: `G8 Staging Supplier ${suffix}`,
        countryCode: "AU",
        primaryEmail: null,
        primaryPhone: null,
        website: null,
        taxIdentifier: null,
        defaultCurrency: "AUD",
        defaultIncoterm: "DAP",
        notes: "Exact-SHA G8 Staging acceptance"
      }
    }
  );
  expectStatus(supplier, 201, "G8 Supplier creation");
  const supplierId = supplier.body.supplier.id;

  const pendingOffer = await api(actor, "/procurement/supplier-offers", {
    method: "POST",
    tenantId: tenantA,
    body: {
      supplierId,
      materialId: pending.body.material.id,
      supplierSku: `PENDING-${suffix.slice(0, 8).toUpperCase()}`,
      supplierMaterialName: pending.body.material.displayName,
      packSizeMg: "25000000",
      minimumOrderQuantityMg: "1000000",
      unitPricePerKg: "0",
      currencyCode: "AUD",
      leadTimeDays: 14,
      lastQuotedAt: new Date().toISOString(),
      sourceReference: "G8 PENDING_REVIEW procurement acceptance"
    }
  });
  expectStatus(pendingOffer, 201, "G8 PENDING_REVIEW Material Supplier Offer");

  const createPo = async (
    number: string,
    quantityMg: string,
    materialId = approvedMaterialId
  ): Promise<Po> => {
    const result = await api<{ purchaseOrder: Po }>(actor, "/procurement/purchase-orders", {
      method: "POST",
      tenantId: tenantA,
      body: {
        poNumber: number,
        supplierId,
        orderType: "STANDARD",
        currencyCode: "AUD",
        supplierQuoteReference: `QUOTE-${suffix}`,
        expectedDeliveryAt: null,
        incoterm: "DAP",
        freightAmount: "0",
        notes: "G8 exact-SHA Staging fixture",
        lines: [
          {
            materialId,
            supplierOfferId: null,
            supplierSkuSnapshot: `SKU-${suffix.slice(0, 8).toUpperCase()}`,
            supplierMaterialNameSnapshot: `G8 Material ${suffix}`,
            orderedQuantityMg: quantityMg,
            unitPricePerKg: "123.4567",
            expectedDeliveryAt: null,
            notes: null
          }
        ]
      }
    });
    expectStatus(result, 201, `G8 Purchase Order ${number}`);
    return result.body.purchaseOrder;
  };
  const approvePo = async (purchaseOrderId: string): Promise<Po> => {
    const result = await api<{ purchaseOrder: Po }>(
      actor,
      `/procurement/purchase-orders/${purchaseOrderId}/approve`,
      { method: "POST", tenantId: tenantA }
    );
    expectStatus(result, 200, "G8 Purchase Order approval");
    return result.body.purchaseOrder;
  };
  const getPo = async (purchaseOrderId: string): Promise<Po> => {
    const result = await api<{ purchaseOrder: Po }>(
      actor,
      `/procurement/purchase-orders/${purchaseOrderId}`,
      { tenantId: tenantA }
    );
    expectStatus(result, 200, "G8 Purchase Order read");
    return result.body.purchaseOrder;
  };
  const createReceipt = async (
    purchaseOrderId: string,
    receiptNumber: string,
    lines: Array<{
      purchaseOrderLineId: string;
      materialId: string;
      quantityMg: string;
      lotCode: string;
      locationId?: string;
    }>
  ): Promise<Receipt> => {
    const result = await api<{ goodsReceipt: Receipt }>(actor, "/procurement/goods-receipts", {
      method: "POST",
      tenantId: tenantA,
      body: {
        receiptNumber,
        purchaseOrderId,
        supplierDeliveryReference: `DEL-${receiptNumber}`,
        receivedAt: new Date().toISOString(),
        lines: lines.map((line) => ({
          purchaseOrderLineId: line.purchaseOrderLineId,
          materialId: line.materialId,
          receivedQuantityMg: line.quantityMg,
          lotCode: line.lotCode,
          supplierLotCode: `SUP-${line.lotCode}`,
          manufacturedAt: null,
          expiresAt: null,
          retestAt: null,
          destinationLocationId: line.locationId ?? stock.locationId
        }))
      }
    });
    expectStatus(result, 201, `G8 Goods Receipt ${receiptNumber}`);
    return result.body.goodsReceipt;
  };
  const postReceipt = async (receiptId: string): Promise<Receipt> => {
    const result = await api<{ goodsReceipt: Receipt }>(
      actor,
      `/procurement/goods-receipts/${receiptId}/post`,
      { method: "POST", tenantId: tenantA }
    );
    expectStatus(result, 200, "G8 Goods Receipt POST");
    return result.body.goodsReceipt;
  };

  const po = await createPo(`G8-PO-${suffix.slice(0, 10)}`, "25000000");
  const approved = await approvePo(po.id);
  const poLineId = approved.lines[0]?.id;
  if (!poLineId) throw new Error("G8 approved Purchase Order has no line.");
  expectError(
    await api(actor, `/procurement/purchase-orders/${po.id}`, {
      method: "PUT",
      tenantId: tenantA,
      body: { notes: "forbidden commercial rewrite" }
    }),
    409,
    "PURCHASE_ORDER_NOT_EDITABLE",
    "G8 APPROVED PO commercial immutability"
  );
  let supplierHistoryImmutable = false;
  try {
    await maintenance`
      update procurement.suppliers set supplier_code = 'FORBIDDEN'
      where tenant_id = ${tenantA} and id = ${supplierId}
    `;
  } catch {
    supplierHistoryImmutable = true;
  }
  if (!supplierHistoryImmutable)
    throw new Error("G8 database allowed Supplier code mutation after PO history existed.");

  const firstLotCode = `G8-A-${suffix.slice(0, 12)}`;
  const draftA = await createReceipt(po.id, `G8-GR-A-${suffix.slice(0, 10)}`, [
    {
      purchaseOrderLineId: poLineId,
      materialId: approvedMaterialId,
      quantityMg: "10000000",
      lotCode: firstLotCode
    }
  ]);
  const draftStock = await maintenance<{ count: string }[]>`
    select count(*)::text as count from inventory.material_lots
    where tenant_id = ${tenantA} and lot_code = ${firstLotCode}
  `;
  if (draftStock[0]?.count !== "0") throw new Error("DRAFT Goods Receipt changed G7 stock.");
  const postedA = await postReceipt(draftA.id);
  const lineA = postedA.lines[0];
  if (postedA.status !== "POSTED" || !lineA?.inventoryLotId || !lineA.inventoryMovementId)
    throw new Error("G8 POST did not persist its G7 Lot and Movement references.");
  const traceA = await api<LotTrace>(actor, `/inventory/lots/${lineA.inventoryLotId}`, {
    tenantId: tenantA
  });
  expectStatus(traceA, 200, "G8 forward Inventory trace");
  if (
    !traceA.body.movements.some(
      (movement) =>
        movement.id === lineA.inventoryMovementId &&
        movement.sourceModule === "PROCUREMENT" &&
        movement.sourceReferenceId === lineA.id &&
        movement.quantityMg === "10000000"
    )
  )
    throw new Error("G8→G7 PROCUREMENT provenance is incomplete.");
  const partial = await getPo(po.id);
  if (
    partial.status !== "PARTIALLY_RECEIVED" ||
    partial.lines[0]?.receivedQuantityMg !== "10000000" ||
    partial.lines[0]?.remainingQuantityMg !== "15000000"
  )
    throw new Error("G8 partial receipt totals are not exact and derived.");

  const draftB = await createReceipt(po.id, `G8-GR-B-${suffix.slice(0, 10)}`, [
    {
      purchaseOrderLineId: poLineId,
      materialId: approvedMaterialId,
      quantityMg: "10000000",
      lotCode: `G8-B1-${suffix.slice(0, 10)}`
    },
    {
      purchaseOrderLineId: poLineId,
      materialId: approvedMaterialId,
      quantityMg: "5000000",
      lotCode: `G8-B2-${suffix.slice(0, 10)}`
    }
  ]);
  const postedB = await postReceipt(draftB.id);
  if (
    postedB.lines.length !== 2 ||
    postedB.lines.some((line) => !line.inventoryLotId || !line.inventoryMovementId)
  )
    throw new Error("G8 multi-Lot receipt did not persist two exact Inventory traces.");
  const complete = await getPo(po.id);
  if (
    complete.status !== "RECEIVED" ||
    complete.lines[0]?.receivedQuantityMg !== "25000000" ||
    complete.lines[0]?.remainingQuantityMg !== "0"
  )
    throw new Error("G8 full receipt did not resolve the ordered quantity exactly.");
  await postReceipt(draftB.id);
  const retryCounts = await maintenance<{ source_reference_id: string; count: string }[]>`
    select source_reference_id::text, count(*)::text as count
    from inventory.stock_movements
    where tenant_id = ${tenantA} and source_module = 'PROCUREMENT'
      and source_reference_id in ${maintenance(postedB.lines.map((line) => line.id))}
    group by source_reference_id
  `;
  if (retryCounts.length !== 2 || retryCounts.some((item) => item.count !== "1"))
    throw new Error("G8 receipt retry duplicated G7 stock.");
  expectError(
    await api(actor, `/procurement/goods-receipts/${postedA.id}`, {
      method: "PUT",
      tenantId: tenantA,
      body: { supplierDeliveryReference: "FORBIDDEN" }
    }),
    409,
    "GOODS_RECEIPT_NOT_EDITABLE",
    "G8 POSTED Receipt immutability"
  );
  expectError(
    await api(actor, `/procurement/goods-receipts/${postedA.id}/cancel`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "GOODS_RECEIPT_ALREADY_POSTED",
    "G8 POSTED Receipt cancellation"
  );

  const racePo = await createPo(`G8-RACE-${suffix.slice(0, 10)}`, "10000000");
  const raceApproved = await approvePo(racePo.id);
  const raceLineId = raceApproved.lines[0]?.id;
  if (!raceLineId) throw new Error("G8 concurrency PO has no line.");
  const raceA = await createReceipt(racePo.id, `G8-RACE-A-${suffix.slice(0, 8)}`, [
    {
      purchaseOrderLineId: raceLineId,
      materialId: approvedMaterialId,
      quantityMg: "7000000",
      lotCode: `G8-RACE-A-${suffix.slice(0, 8)}`
    }
  ]);
  const raceB = await createReceipt(racePo.id, `G8-RACE-B-${suffix.slice(0, 8)}`, [
    {
      purchaseOrderLineId: raceLineId,
      materialId: approvedMaterialId,
      quantityMg: "7000000",
      lotCode: `G8-RACE-B-${suffix.slice(0, 8)}`
    }
  ]);
  const raceResults = await Promise.all([
    api(actor, `/procurement/goods-receipts/${raceA.id}/post`, {
      method: "POST",
      tenantId: tenantA
    }),
    api(actor, `/procurement/goods-receipts/${raceB.id}/post`, {
      method: "POST",
      tenantId: tenantA
    })
  ]);
  const raceStatuses = raceResults.map((item) => item.status).sort((a, b) => a - b);
  if (raceStatuses[0] !== 200 || raceStatuses[1] !== 409)
    throw new Error(`G8 concurrent receipt result was ${raceStatuses.join(",")}.`);
  const raceFinal = await getPo(racePo.id);
  if (
    raceFinal.lines[0]?.receivedQuantityMg !== "7000000" ||
    raceFinal.lines[0]?.remainingQuantityMg !== "3000000"
  )
    throw new Error("G8 concurrent partial receipts over-received the Purchase Order line.");
  const raceMovement = await maintenance<{ quantity_mg: string }[]>`
    select coalesce(sum(quantity_mg), 0)::text as quantity_mg
    from inventory.stock_movements
    where tenant_id = ${tenantA} and source_module = 'PROCUREMENT'
      and source_reference_id in (
        select id::text from procurement.goods_receipt_lines
        where tenant_id = ${tenantA} and goods_receipt_id in (${raceA.id}, ${raceB.id})
      )
  `;
  if (raceMovement[0]?.quantity_mg !== "7000000")
    throw new Error("G8 concurrent receipt created excess physical Inventory.");

  const rollbackLocation = await api<{ location: { id: string } }>(actor, "/inventory/locations", {
    method: "POST",
    tenantId: tenantA,
    body: {
      locationCode: `G8-ROLLBACK-${suffix.slice(0, 8).toUpperCase()}`,
      name: "G8 Archived Receipt Target",
      description: "Atomic rollback acceptance"
    }
  });
  expectStatus(rollbackLocation, 201, "G8 rollback Location");
  const rollbackPo = await createPo(`G8-ROLLBACK-${suffix.slice(0, 8)}`, "1000");
  const rollbackApproved = await approvePo(rollbackPo.id);
  const rollbackLineId = rollbackApproved.lines[0]?.id;
  if (!rollbackLineId) throw new Error("G8 rollback PO has no line.");
  const rollbackLotCode = `G8-ROLL-${suffix.slice(0, 10)}`;
  const rollbackReceipt = await createReceipt(rollbackPo.id, `G8-GR-ROLL-${suffix.slice(0, 8)}`, [
    {
      purchaseOrderLineId: rollbackLineId,
      materialId: approvedMaterialId,
      quantityMg: "1000",
      lotCode: rollbackLotCode,
      locationId: rollbackLocation.body.location.id
    }
  ]);
  expectStatus(
    await api(actor, `/inventory/locations/${rollbackLocation.body.location.id}/archive`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G8 rollback Location archive"
  );
  const rollbackPost = await api(actor, `/procurement/goods-receipts/${rollbackReceipt.id}/post`, {
    method: "POST",
    tenantId: tenantA
  });
  if (rollbackPost.status !== 409)
    throw new Error("G8 POST did not fail when the G7 destination Location was archived.");
  const rollbackState = await api<{ goodsReceipt: Receipt }>(
    actor,
    `/procurement/goods-receipts/${rollbackReceipt.id}`,
    { tenantId: tenantA }
  );
  expectStatus(rollbackState, 200, "G8 rollback Receipt state");
  const rollbackOrder = await getPo(rollbackPo.id);
  const rollbackLots = await maintenance<{ count: string }[]>`
    select count(*)::text as count from inventory.material_lots
    where tenant_id = ${tenantA} and lot_code = ${rollbackLotCode}
  `;
  if (
    rollbackState.body.goodsReceipt.status !== "DRAFT" ||
    rollbackState.body.goodsReceipt.lines.some(
      (line) => line.inventoryLotId !== null || line.inventoryMovementId !== null
    ) ||
    rollbackOrder.status !== "APPROVED" ||
    rollbackOrder.lines[0]?.receivedQuantityMg !== "0" ||
    rollbackLots[0]?.count !== "0"
  )
    throw new Error("G8/G7 failure did not roll back the whole receipt transaction.");

  const multiPoResult = await api<{ purchaseOrder: Po }>(actor, "/procurement/purchase-orders", {
    method: "POST",
    tenantId: tenantA,
    body: {
      poNumber: `G8-MULTI-ROLL-${suffix.slice(0, 8)}`,
      supplierId,
      orderType: "STANDARD",
      currencyCode: "AUD",
      supplierQuoteReference: null,
      expectedDeliveryAt: null,
      incoterm: null,
      freightAmount: "0",
      notes: "G8 multi-line atomic rollback fixture",
      lines: [1, 2].map((line) => ({
        materialId: approvedMaterialId,
        supplierOfferId: null,
        supplierSkuSnapshot: null,
        supplierMaterialNameSnapshot: `G8 rollback line ${line}`,
        orderedQuantityMg: "1000",
        unitPricePerKg: "1.25",
        expectedDeliveryAt: null,
        notes: null
      }))
    }
  });
  expectStatus(multiPoResult, 201, "G8 multi-line rollback Purchase Order");
  const multiApproved = await approvePo(multiPoResult.body.purchaseOrder.id);
  if (multiApproved.lines.length !== 2)
    throw new Error("G8 multi-line rollback Purchase Order is incomplete.");
  const firstRollbackLot = `G8-MULTI-A-${suffix.slice(0, 8)}`;
  const secondRollbackLot = `G8-MULTI-B-${suffix.slice(0, 8)}`;
  const multiReceipt = await createReceipt(multiApproved.id, `G8-GR-MULTI-${suffix.slice(0, 8)}`, [
    {
      purchaseOrderLineId: multiApproved.lines[0].id,
      materialId: approvedMaterialId,
      quantityMg: "1000",
      lotCode: firstRollbackLot
    },
    {
      purchaseOrderLineId: multiApproved.lines[1].id,
      materialId: approvedMaterialId,
      quantityMg: "1000",
      lotCode: secondRollbackLot,
      locationId: rollbackLocation.body.location.id
    }
  ]);
  const multiPost = await api(actor, `/procurement/goods-receipts/${multiReceipt.id}/post`, {
    method: "POST",
    tenantId: tenantA
  });
  if (multiPost.status !== 409)
    throw new Error("G8 multi-line POST did not fail on its invalid second G7 receipt.");
  const multiState = await api<{ goodsReceipt: Receipt }>(
    actor,
    `/procurement/goods-receipts/${multiReceipt.id}`,
    { tenantId: tenantA }
  );
  expectStatus(multiState, 200, "G8 multi-line rollback Receipt state");
  const multiOrder = await getPo(multiApproved.id);
  const multiLots = await maintenance<{ count: string }[]>`
    select count(*)::text as count from inventory.material_lots
    where tenant_id = ${tenantA} and lot_code in (${firstRollbackLot}, ${secondRollbackLot})
  `;
  if (
    multiState.body.goodsReceipt.status !== "DRAFT" ||
    multiState.body.goodsReceipt.lines.some(
      (line) => line.inventoryLotId !== null || line.inventoryMovementId !== null
    ) ||
    multiOrder.status !== "APPROVED" ||
    multiOrder.lines.some((line) => line.receivedQuantityMg !== "0") ||
    multiLots[0]?.count !== "0"
  )
    throw new Error("G8 multi-line failure partially committed Procurement or Inventory truth.");

  const draftCancelPo = await createPo(`G8-CANCEL-${suffix.slice(0, 8)}`, "1000");
  const draftCancelApproved = await approvePo(draftCancelPo.id);
  const draftCancelLineId = draftCancelApproved.lines[0]?.id;
  if (!draftCancelLineId) throw new Error("G8 cancellation PO has no line.");
  const cancelledLotCode = `G8-CANCEL-${suffix.slice(0, 8)}`;
  const draftCancelReceipt = await createReceipt(
    draftCancelPo.id,
    `G8-GR-CANCEL-${suffix.slice(0, 8)}`,
    [
      {
        purchaseOrderLineId: draftCancelLineId,
        materialId: approvedMaterialId,
        quantityMg: "1000",
        lotCode: cancelledLotCode
      }
    ]
  );
  expectStatus(
    await api(actor, `/procurement/goods-receipts/${draftCancelReceipt.id}/cancel`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G8 DRAFT Receipt cancellation"
  );
  const cancelledStock = await maintenance<{ count: string }[]>`
    select count(*)::text as count from inventory.material_lots
    where tenant_id = ${tenantA} and lot_code = ${cancelledLotCode}
  `;
  if (cancelledStock[0]?.count !== "0")
    throw new Error("G8 DRAFT Receipt cancellation changed G7 stock.");

  const preHoldPo = await createPo(`G8-HOLD-OLD-${suffix.slice(0, 8)}`, "1000");
  const preHoldApproved = await approvePo(preHoldPo.id);
  expectStatus(
    await api(actor, `/procurement/suppliers/${supplierId}`, {
      method: "PUT",
      tenantId: tenantA,
      body: { status: "HOLD" }
    }),
    200,
    "G8 Supplier HOLD"
  );
  const newHoldPo = await createPo(`G8-HOLD-NEW-${suffix.slice(0, 8)}`, "1000");
  expectError(
    await api(actor, `/procurement/purchase-orders/${newHoldPo.id}/approve`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "SUPPLIER_ON_HOLD",
    "G8 Supplier HOLD approval rule"
  );
  const preHoldLineId = preHoldApproved.lines[0]?.id;
  if (!preHoldLineId) throw new Error("G8 pre-HOLD Purchase Order has no line.");
  await postReceipt(
    (
      await createReceipt(preHoldPo.id, `G8-GR-HOLD-${suffix.slice(0, 8)}`, [
        {
          purchaseOrderLineId: preHoldLineId,
          materialId: approvedMaterialId,
          quantityMg: "1000",
          lotCode: `G8-HOLD-${suffix.slice(0, 8)}`
        }
      ])
    ).id
  );

  expectError(
    await api(token("E"), `/procurement/suppliers/${supplierId}`, { tenantId: tenantB }),
    404,
    "SUPPLIER_NOT_FOUND",
    "G8 cross-tenant Supplier read"
  );
  expectError(
    await api(token("E"), `/procurement/goods-receipts/${postedA.id}/post`, {
      method: "POST",
      tenantId: tenantB
    }),
    404,
    "GOODS_RECEIPT_NOT_FOUND",
    "G8 cross-tenant Receipt POST"
  );
  expectError(
    await api(token("A"), "/procurement/suppliers", {
      method: "POST",
      tenantId: tenantA,
      body: {
        supplierCode: `FORGED-${suffix.slice(0, 8).toUpperCase()}`,
        legalName: "Forbidden",
        displayName: "Forbidden"
      }
    }),
    403,
    "PERMISSION_DENIED",
    "G8 member RBAC fail closed"
  );

  const actorAudit = await maintenance<{ actor_user_id: string | null; metadata: unknown }[]>`
    select actor_user_id::text, metadata from platform.audit_events
    where tenant_id = ${tenantA} and action = 'procurement.goods_receipt.posted'
      and resource_id = ${postedA.id}
  `;
  if (actorAudit.length !== 1 || actorAudit[0].actor_user_id !== fixture("B").id)
    throw new Error("G8 Goods Receipt audit actor provenance is missing or forged.");

  await signInInBrowser(page, fixture("B"));
  await page.goto(new URL("/procurement", stagingUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Procurement" }).waitFor({ state: "visible" });
  await page.getByRole("heading", { name: "Purchase Orders" }).waitFor({ state: "visible" });
  await page.getByText(`G8-PO-${suffix.slice(0, 10)}`).waitFor({ state: "visible" });
  await captureG8(page, "procurement-purchase-orders-desktop", "/procurement");
  await signOutInBrowser(page);
}

async function captureG8(page: Page, name: string, route: string): Promise<void> {
  if (!g8VisualCaptureDirectory) return;
  await mkdir(g8VisualCaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(g8VisualCaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(g8VisualCaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSourceSha, environment: "staging" },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function captureG7(page: Page, name: string, route: string): Promise<void> {
  if (!g7VisualCaptureDirectory) return;
  await mkdir(g7VisualCaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(g7VisualCaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(g7VisualCaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSourceSha, environment: "staging" },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function createG7Lot(
  actor: string,
  tenantId: string,
  materialId: string,
  locationId: string,
  input: { lotCode: string; quantityMg: string; expiresAt: string | null; retestAt: string | null }
): Promise<string> {
  const created = await api<{ lot: { id: string } }>(actor, "/inventory/lots", {
    method: "POST",
    tenantId,
    body: {
      materialId,
      lotCode: input.lotCode,
      supplierLotCode: null,
      manufacturedAt: null,
      expiresAt: input.expiresAt,
      retestAt: input.retestAt,
      notes: "Gate 7 Staging acceptance"
    }
  });
  expectStatus(created, 201, `G7 Lot ${input.lotCode}`);
  const operationKey = `staging:${suffix}:lot:${created.body.lot.id}:opening`;
  const openingBody = {
    quantityMg: input.quantityMg,
    toLocationId: locationId,
    reasonCode: "G7_STAGING_ACCEPTANCE",
    operationKey
  };
  for (const label of ["opening stock", "idempotent opening-stock retry"]) {
    expectStatus(
      await api(actor, `/inventory/lots/${created.body.lot.id}/receive`, {
        method: "POST",
        tenantId,
        body: openingBody
      }),
      201,
      `G7 ${label} ${input.lotCode}`
    );
  }
  const detail = await api<{ movements: Array<{ operationKey: string }> }>(
    actor,
    `/inventory/lots/${created.body.lot.id}`,
    { tenantId }
  );
  expectStatus(detail, 200, `G7 idempotent receipt trace ${input.lotCode}`);
  if (detail.body.movements.filter((item) => item.operationKey === operationKey).length !== 1)
    throw new Error("G7 idempotent RECEIPT appended duplicate Movement truth.");
  return created.body.lot.id;
}

async function captureG5(page: Page, name: string, route: string): Promise<void> {
  if (!g5VisualCaptureDirectory) return;
  await mkdir(g5VisualCaptureDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(g5VisualCaptureDirectory, `${name}.png`),
    fullPage: true
  });
  await writeFile(
    resolve(g5VisualCaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSourceSha, environment: "staging" },
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
      // Fixture cleanup is a Staging-admin concern. Replica mode bypasses only the immutable
      // composition triggers for the explicitly enumerated disposable acceptance identities.
      await transaction`set local session_replication_role = replica`;
      for (const tenantId of tenantIds) {
        await transaction`delete from procurement.goods_receipt_lines where tenant_id = ${tenantId}`;
        await transaction`delete from procurement.goods_receipts where tenant_id = ${tenantId}`;
        await transaction`delete from procurement.purchase_order_lines where tenant_id = ${tenantId}`;
        await transaction`delete from procurement.purchase_orders where tenant_id = ${tenantId}`;
        await transaction`delete from procurement.supplier_material_offers where tenant_id = ${tenantId}`;
        await transaction`delete from procurement.suppliers where tenant_id = ${tenantId}`;
        await transaction`delete from production.production_material_allocations where tenant_id = ${tenantId}`;
        await transaction`delete from production.production_order_lines where tenant_id = ${tenantId}`;
        await transaction`delete from production.production_batches where tenant_id = ${tenantId}`;
        await transaction`delete from production.production_orders where tenant_id = ${tenantId}`;
        await transaction`delete from inventory.stock_reservations where tenant_id = ${tenantId}`;
        await transaction`delete from inventory.stock_movements where tenant_id = ${tenantId}`;
        await transaction`delete from inventory.material_lots where tenant_id = ${tenantId}`;
        await transaction`delete from inventory.locations where tenant_id = ${tenantId}`;
        await transaction`delete from release_readiness.checks where tenant_id = ${tenantId}`;
        await transaction`delete from release_readiness.assessments where tenant_id = ${tenantId}`;
        await transaction`
          delete from trial_sensory.sensory_deltas where tenant_id = ${tenantId}
        `;
        await transaction`
          delete from trial_sensory.sensory_evaluations where tenant_id = ${tenantId}
        `;
        await transaction`delete from trial_sensory.trial_lines where tenant_id = ${tenantId}`;
        await transaction`delete from trial_sensory.trials where tenant_id = ${tenantId}`;
        await transaction`
          delete from design_studio.formula_frozen_snapshots where tenant_id = ${tenantId}
        `;
        await transaction`delete from design_studio.formula_lines where tenant_id = ${tenantId}`;
        await transaction`
          delete from design_studio.formula_versions where tenant_id = ${tenantId}
        `;
        await transaction`delete from design_studio.formulas where tenant_id = ${tenantId}`;
        await transaction`delete from design_studio.design_briefs where tenant_id = ${tenantId}`;
        await transaction`delete from design_studio.projects where tenant_id = ${tenantId}`;
      }
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
