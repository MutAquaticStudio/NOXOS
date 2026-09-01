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
    await runG6Acceptance(page, tenantA, tenantB, frozen, frozenAccord.body.formulaVersion);
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
): Promise<void> {
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
    await api(actor, `/trials/${created.body.trial.id}/prepare`, {
      method: "POST",
      tenantId
    }),
    200,
    "G5 Accord exact preparation"
  );
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
    return created.body.trial.id;
  };
  const createFinalEvaluation = async (
    trialId: string,
    decision: "REVISION_REQUIRED" | "READY_FOR_APPROVAL",
    deltas: unknown[]
  ) => {
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

  console.log("G5_STAGING_TRIAL_SENSORY_ACCEPTANCE=PASS");
  console.log("G5_STAGING_REVISION_PATH=PASS");
  console.log("G5_STAGING_APPROVAL_PATH=PASS");
  console.log("G5_CANCELLED_TRIAL_EVIDENCE_LOCK=PASS");
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
