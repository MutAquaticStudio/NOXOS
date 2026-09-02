import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createRuntimeDatabase } from "@nox-os/database";

type ApiResult<T = unknown> = { status: number; body: T };
type Candidate = { generationStrategy: string };
type PreparationPlan = {
  requirements: Array<{ materialId: string; requiredMassMg: string }>;
};

const previewUrl = required("NOX_PREVIEW_URL");
const expectedSha = required("EXPECTED_SOURCE_SHA");
const email = required("NOX_PREVIEW_MATERIAL_USER_EMAIL");
const password = required("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const captureDirectory = process.env.G5_VISUAL_CAPTURE_DIR;
const g6CaptureDirectory = process.env.G6_VISUAL_CAPTURE_DIR;
const g7CaptureDirectory = process.env.G7_VISUAL_CAPTURE_DIR;
const g8CaptureDirectory = process.env.G8_VISUAL_CAPTURE_DIR;
const runtimeDatabaseUrl = required("NOX_PREVIEW_RUNTIME_DATABASE_URL");
const suffix = randomUUID().slice(0, 8);
const inventoryStock = new Map<string, { locationId: string; lots: Map<string, string> }>();

if (!/^[0-9a-f]{40}$/i.test(expectedSha))
  throw new Error("G5 Preview acceptance requires a full immutable source SHA.");

const runtime = createRuntimeDatabase({
  connectionUrl: runtimeDatabaseUrl,
  applicationName: "nox-os-g6-preview-acceptance",
  expectedRole: "nox_app_runtime"
});
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
  await assertAvailability(page, tenantId);
  const formulaVersionId = await createFrozenFormula(page, tenantId);

  const { trialId: revisionTrial } = await completeRevisionInBrowser(
    page,
    tenantId,
    formulaVersionId
  );

  const approvalTrial = await createPreparedTrial(page, tenantId, formulaVersionId, "approval");
  const approvalEvaluation = await createEvaluation(page, tenantId, approvalTrial, {
    evaluationText: "The full composition is balanced and ready for approval.",
    decision: "READY_FOR_APPROVAL",
    deltas: []
  });
  expectStatus(
    await api(
      page,
      tenantId,
      `/trials/${approvalTrial}/evaluations/${approvalEvaluation}/recommend-approval`,
      "POST"
    ),
    200,
    "G5 approval recommendation"
  );
  expectStatus(
    await api(
      page,
      tenantId,
      `/design-studio/formula-versions/${formulaVersionId}/approve`,
      "POST",
      {
        sourceTrialId: approvalTrial,
        sourceEvaluationId: approvalEvaluation
      }
    ),
    200,
    "G4 approval with exact G5 evidence"
  );

  const accordVersionId = await createFrozenAccord(page, tenantId);
  const accordTrial = await createPreparedTrial(page, tenantId, accordVersionId, "accord");
  const accordEvaluation = await createEvaluation(page, tenantId, accordTrial, {
    evaluationText: "The accord is coherent and useful as a building block.",
    decision: "READY_FOR_APPROVAL",
    deltas: []
  });
  expectStatus(
    await api(
      page,
      tenantId,
      `/trials/${accordTrial}/evaluations/${accordEvaluation}/recommend-approval`,
      "POST"
    ),
    200,
    "G5 Accord approval recommendation"
  );
  expectStatus(
    await api(
      page,
      tenantId,
      `/design-studio/formula-versions/${accordVersionId}/approve`,
      "POST",
      {
        sourceTrialId: accordTrial,
        sourceEvaluationId: accordEvaluation
      }
    ),
    200,
    "G4 Accord approval with G5 evidence"
  );

  await page.goto(url(`/design-studio/formula-versions/${formulaVersionId}`), {
    waitUntil: "networkidle"
  });
  await visible(page, page.getByRole("button", { name: "Assess Release Readiness" }));
  await page.goto(url(`/design-studio/formula-versions/${accordVersionId}`), {
    waitUntil: "networkidle"
  });
  if (await page.getByRole("button", { name: "Assess Release Readiness" }).count())
    throw new Error("G4 displayed the G6 entry action for an ACCORD_FORMULATION.");

  await runG6PreviewAcceptance(page, tenantId, formulaVersionId, accordVersionId);

  await runG7PreviewAcceptance(page, tenantId);

  await runG8PreviewAcceptance(page, tenantId);

  await runG9PreviewAcceptance(page, tenantId, formulaVersionId);

  await page.goto(url("/trials"), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "Trial Registry" }));
  await capture(page, "trial-registry-desktop", "/trials");
  await page.goto(url(`/trials/${revisionTrial}`), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: /G5 Preview Formula/i }));
  await visible(page, page.getByText("FINAL · REVISION REQUIRED"));
  await capture(page, "trial-evaluation-desktop", `/trials/${revisionTrial}`);
  await page.goto(url(`/trials/${accordTrial}`), { waitUntil: "networkidle" });
  await visible(page, page.getByText("WHOLE ACCORD"));
  await capture(page, "accord-trial-desktop", `/trials/${accordTrial}`);

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: bypassHeaders()
  });
  try {
    await mobile.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await signIn(mobile);
    await mobile.goto(url(`/trials/${approvalTrial}`), { waitUntil: "networkidle" });
    await visible(mobile, mobile.getByRole("heading", { name: /G5 Preview Formula/i }));
    await capture(mobile, "trial-evaluation-mobile", `/trials/${approvalTrial}`);
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
  await runtime.end({ timeout: 5 });
}

console.log("G5_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
console.log("G5_TRIAL_SCALING=PASS");
console.log("G5_SENSORY_REVISION=PASS");
console.log("G5_APPROVAL_EVIDENCE=PASS");
console.log("G6_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
console.log("G6_PREVIEW_READY_PATH=PASS");
console.log("G6_PREVIEW_REVIEW_REQUIRED_PATH=PASS");
console.log("G6_PREVIEW_BLOCKED_PATH=PASS");
console.log("G6_PREVIEW_ACCORD_REJECTION=PASS");
console.log("G6_PREVIEW_TENANT_DENIAL=PASS");
console.log("G6_PREVIEW_IMMUTABLE_HISTORY=PASS");
console.log("G7_PREVIEW_INVENTORY_ACCEPTANCE=PASS");
console.log("G7_PREVIEW_TRIAL_RESERVATION=PASS");
console.log("G7_PREVIEW_TRIAL_CONSUMPTION=PASS");
console.log("G8_PREVIEW_PROCUREMENT_ACCEPTANCE=PASS");
console.log("G8_PREVIEW_RECEIPT_ATOMICITY=PASS");
console.log("G8_PREVIEW_TRACEABILITY=PASS");
console.log("G9_PREVIEW_PRODUCTION_ACCEPTANCE=PASS");
console.log("G9_PREVIEW_RELEASE_RESERVATION=PASS");
console.log("G9_PREVIEW_START_CONSUMPTION=PASS");
console.log("G9_PREVIEW_READINESS_REVALIDATION=PASS");
console.log("G9_PREVIEW_IDEMPOTENCY=PASS");
console.log("G9_PREVIEW_PROVENANCE=PASS");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for G5 Preview acceptance.`);
  return value;
}
function url(path: string): string {
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
      throw new Error(`G5 Preview identity failed for ${path}.`);
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
function expectStatus<T>(result: ApiResult<T>, status: number, label: string): T {
  if (result.status !== status)
    throw new Error(`${label} returned ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}
async function activeTenant(page: Page): Promise<string> {
  const result = await api<{ tenants?: Array<{ tenant?: { id?: string } }> }>(
    page,
    "00000000-0000-0000-0000-000000000000",
    "/me/tenants"
  );
  const tenantId = result.body.tenants?.[0]?.tenant?.id;
  if (result.status !== 200 || !tenantId) throw new Error("G5 Preview needs one active tenant.");
  return tenantId;
}
async function assertAvailability(page: Page, tenantId: string) {
  const context = expectStatus(
    await api<{
      moduleAvailability?: Array<{ moduleId: string; state: string }>;
      authorization?: { modulePermissions?: string[] };
    }>(page, tenantId, "/context"),
    200,
    "Trial & Sensory context"
  );
  if (
    context.moduleAvailability?.find((item) => item.moduleId === "trial-sensory")?.state !==
      "AVAILABLE" ||
    !context.authorization?.modulePermissions?.includes("module.trial-sensory.trial.prepare")
  )
    throw new Error("Trial & Sensory is not available with expected server permissions.");
  if (
    context.moduleAvailability?.find((item) => item.moduleId === "inventory")?.state !==
      "AVAILABLE" ||
    !context.authorization?.modulePermissions?.includes("module.inventory.read")
  )
    throw new Error("Inventory is not available with expected server permissions.");
  const denied = await page.request.post(url("/api/v1/trials"), {
    headers: {
      ...(bypassHeaders() ?? {}),
      "content-type": "application/json",
      "x-nox-tenant-id": tenantId,
      "x-role": "TENANT_OWNER",
      "x-permission": "module.trial-sensory.trial.create"
    },
    data: { formulaVersionId: randomUUID() }
  });
  if (denied.status() !== 401)
    throw new Error("Forged authority headers affected an unauthenticated G5 request.");
}

async function runG6PreviewAcceptance(
  page: Page,
  tenantId: string,
  formulaVersionId: string,
  accordVersionId: string
): Promise<void> {
  const lines = await runtime<Array<{ material_id: string; active_aromatic_mass_mg: string }>>`
    select material_id::text, active_aromatic_mass_mg::text
    from design_studio.formula_lines
    where tenant_id = ${tenantId} and formula_version_id = ${formulaVersionId}
    order by line_order
  `;
  const restricted = lines.find((line) => BigInt(line.active_aromatic_mass_mg) > 0n);
  if (!restricted) throw new Error("G6 Preview requires an active aromatic Formula line.");
  for (const line of lines) {
    const isRestricted = line.material_id === restricted.material_id;
    await runtime`
      insert into material_intelligence.material_properties (
        material_id, source_reference, ifra_cat4_max_pct, ifra_amendment,
        ifra_source_reference, ifra_restricted, ifra_limits, eu_allergens
      ) values (
        ${line.material_id},
        ${isRestricted ? "G6-PREVIEW-SOURCE" : "G6-PREVIEW-NONRESTRICTED-SOURCE"},
        ${isRestricted ? 100 : null}, '51',
        ${isRestricted ? "G6-PREVIEW-IFRA" : "G6-PREVIEW-NONRESTRICTED-IFRA"},
        ${isRestricted},
        '{}'::jsonb, '[]'::jsonb
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

  const context = expectStatus(
    await api<{
      moduleAvailability?: Array<{ moduleId: string; state: string }>;
      authorization?: { modulePermissions?: string[] };
    }>(page, tenantId, "/context"),
    200,
    "Release Readiness context"
  );
  if (
    context.moduleAvailability?.find((item) => item.moduleId === "release-readiness")?.state !==
      "AVAILABLE" ||
    !context.authorization?.modulePermissions?.includes("module.release-readiness.assessment.run")
  )
    throw new Error("G6 Preview module availability or permission is incomplete.");

  await page.goto(url(`/release-readiness/new?formulaVersionId=${formulaVersionId}`), {
    waitUntil: "networkidle"
  });
  await visible(page, page.getByRole("heading", { name: "Assess Release Readiness" }));
  await captureG6(
    page,
    "release-readiness-profile",
    `/release-readiness/new?formulaVersionId=${formulaVersionId}`
  );

  const accord = await api<{ error?: { code?: string } }>(
    page,
    tenantId,
    "/release-readiness/assessments",
    "POST",
    {
      formulaVersionId: accordVersionId,
      applicationKey: "fine-fragrance",
      dosagePct: 10,
      policyKey: "g6-known-limit-v1"
    }
  );
  if (accord.status !== 409 || accord.body.error?.code !== "UNSUPPORTED_COMPOSITION_KIND")
    throw new Error(`G6 Accord rejection failed: ${JSON.stringify(accord)}`);

  const crossTenant = await api(page, randomUUID(), "/release-readiness/assessments", "POST", {
    formulaVersionId,
    applicationKey: "fine-fragrance",
    dosagePct: 10,
    policyKey: "g6-known-limit-v1"
  });
  if (![403, 404].includes(crossTenant.status))
    throw new Error("G6 forged cross-tenant context was not denied.");

  type Result = {
    assessment: { id: string; decision: string; supersedesAssessmentId: string | null };
  };
  const ready = expectStatus(
    await api<Result>(page, tenantId, "/release-readiness/assessments", "POST", {
      formulaVersionId,
      applicationKey: "fine-fragrance",
      dosagePct: 10,
      policyKey: "g6-known-limit-v1"
    }),
    201,
    "G6 READY Preview assessment"
  ).assessment;
  if (ready.decision !== "READY") throw new Error("G6 Preview READY path failed.");

  await runtime`
    update material_intelligence.material_properties
    set ifra_amendment = null, updated_at = now()
    where material_id = ${restricted.material_id}
  `;
  const review = expectStatus(
    await api<Result>(
      page,
      tenantId,
      `/release-readiness/assessments/${ready.id}/reassess`,
      "POST"
    ),
    201,
    "G6 REVIEW_REQUIRED Preview reassessment"
  ).assessment;
  if (review.decision !== "REVIEW_REQUIRED" || review.supersedesAssessmentId !== ready.id)
    throw new Error("G6 Preview REVIEW_REQUIRED lineage failed.");

  await runtime`
    update material_intelligence.material_properties
    set ifra_cat4_max_pct = 0, ifra_amendment = '51', updated_at = now()
    where material_id = ${restricted.material_id}
  `;
  const blocked = expectStatus(
    await api<Result>(
      page,
      tenantId,
      `/release-readiness/assessments/${review.id}/reassess`,
      "POST"
    ),
    201,
    "G6 BLOCKED Preview reassessment"
  ).assessment;
  if (blocked.decision !== "BLOCKED" || blocked.supersedesAssessmentId !== review.id)
    throw new Error("G6 Preview BLOCKED lineage failed.");

  for (const [id, expected] of [
    [ready.id, "READY"],
    [review.id, "REVIEW_REQUIRED"],
    [blocked.id, "BLOCKED"]
  ] as const) {
    const historical = expectStatus(
      await api<Result>(page, tenantId, `/release-readiness/assessments/${id}`),
      200,
      `G6 historical ${expected} assessment`
    ).assessment;
    if (historical.decision !== expected)
      throw new Error(`G6 historical ${expected} assessment changed.`);
  }

  let immutable = false;
  try {
    await runtime`
      update release_readiness.assessments set decision = 'READY'
      where tenant_id = ${tenantId} and id = ${blocked.id}
    `;
  } catch {
    immutable = true;
  }
  if (!immutable) throw new Error("G6 Preview final assessment was mutable.");

  await page.goto(url("/release-readiness"), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "Release Assessments" }));
  await captureG6(page, "release-readiness-registry", "/release-readiness");
  await page.goto(url(`/release-readiness/${blocked.id}`), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "BLOCKED" }));
  await captureG6(page, "release-readiness-detail", `/release-readiness/${blocked.id}`);
}
async function createFrozenFormula(page: Page, tenantId: string): Promise<string> {
  const project = expectStatus(
    await api<{ project: { id: string } }>(page, tenantId, "/design-studio/projects", "POST", {
      name: `G5 Preview ${suffix}`,
      description: "Exact-SHA Trial acceptance"
    }),
    201,
    "G5 source Project"
  ).project;
  const brief = expectStatus(
    await api<{ brief: { id: string }; intentDraft: { intent: unknown } }>(
      page,
      tenantId,
      `/design-studio/projects/${project.id}/briefs`,
      "POST",
      {
        workflowMode: "FORMULA_GENERATION",
        rawBrief: "A transparent jasminy fine-fragrance direction.",
        applicationKey: "fine-fragrance",
        targetDosagePct: 20,
        explicitTags: [
          { assignmentType: "DESCRIPTOR", taxonomyTerm: "Jasminy", targetStrength: 1 }
        ],
        explicitExclusions: [],
        signals: [],
        assetReferences: []
      }
    ),
    201,
    "G5 source Brief"
  );
  expectStatus(
    await api(page, tenantId, `/design-studio/briefs/${brief.brief.id}/confirm`, "POST", {
      intent: brief.intentDraft.intent
    }),
    200,
    "G5 source Intent"
  );
  const generated = expectStatus(
    await api<{ candidates: Candidate[] }>(
      page,
      tenantId,
      `/design-studio/briefs/${brief.brief.id}/generate`,
      "POST",
      { budget: { mode: "STANDARD" } }
    ),
    200,
    "G5 source Formula generation"
  );
  const frozen = expectStatus(
    await api<{ formulaVersion: { formulaVersionId: string } }>(
      page,
      tenantId,
      `/design-studio/briefs/${brief.brief.id}/freeze`,
      "POST",
      {
        budget: { mode: "STANDARD" },
        strategy: generated.candidates[0]?.generationStrategy,
        formulaName: `G5 Preview Formula ${suffix}`
      }
    ),
    201,
    "G5 source Formula freeze"
  );
  return frozen.formulaVersion.formulaVersionId;
}
async function createFrozenAccord(page: Page, tenantId: string): Promise<string> {
  const project = expectStatus(
    await api<{ project: { id: string } }>(page, tenantId, "/design-studio/projects", "POST", {
      name: `G5 Preview Accord ${suffix}`,
      description: "Exact-SHA Accord Trial acceptance"
    }),
    201,
    "G5 Accord Project"
  ).project;
  const brief = expectStatus(
    await api<{ brief: { id: string }; intentDraft: { intent: unknown } }>(
      page,
      tenantId,
      `/design-studio/projects/${project.id}/briefs`,
      "POST",
      {
        workflowMode: "ACCORD_ARCHITECTURE",
        rawBrief: "A transparent jasminy accord for a fine-fragrance heart.",
        applicationKey: "fine-fragrance",
        targetDosagePct: 20,
        explicitTags: [
          { assignmentType: "DESCRIPTOR", taxonomyTerm: "Jasminy", targetStrength: 1 }
        ],
        explicitExclusions: [],
        signals: [],
        assetReferences: []
      }
    ),
    201,
    "G5 Accord Brief"
  );
  expectStatus(
    await api(page, tenantId, `/design-studio/briefs/${brief.brief.id}/confirm`, "POST", {
      intent: brief.intentDraft.intent
    }),
    200,
    "G5 Accord Intent"
  );
  const plan = expectStatus(
    await api<{ plan: { accords: Array<{ accordKey: string }> } }>(
      page,
      tenantId,
      `/design-studio/briefs/${brief.brief.id}/accord-plan`,
      "POST"
    ),
    200,
    "G5 Accord planning"
  ).plan;
  const generated = expectStatus(
    await api<{ candidates: Candidate[] }>(
      page,
      tenantId,
      `/design-studio/briefs/${brief.brief.id}/generate`,
      "POST",
      { budget: { mode: "STANDARD" }, accordKey: plan.accords[0]?.accordKey }
    ),
    200,
    "G5 Accord development"
  );
  const frozen = expectStatus(
    await api<{ formulaVersion: { formulaVersionId: string; compositionKind: string } }>(
      page,
      tenantId,
      `/design-studio/briefs/${brief.brief.id}/freeze`,
      "POST",
      {
        budget: { mode: "STANDARD" },
        accordKey: plan.accords[0]?.accordKey,
        strategy: generated.candidates[0]?.generationStrategy,
        formulaName: `G5 Preview Accord ${suffix}`
      }
    ),
    201,
    "G5 Accord Formulation freeze"
  ).formulaVersion;
  if (frozen.compositionKind !== "ACCORD_FORMULATION")
    throw new Error("G5 Accord Trial source was not an ACCORD_FORMULATION.");
  return frozen.formulaVersionId;
}
async function completeRevisionInBrowser(
  page: Page,
  tenantId: string,
  formulaVersionId: string
): Promise<{ trialId: string; evaluationId: string }> {
  await page.goto(url(`/trials?formulaVersionId=${formulaVersionId}`), {
    waitUntil: "networkidle"
  });
  await visible(page, page.getByRole("heading", { name: "Create Trial from FROZEN Formula" }));
  await page.getByLabel("Target batch (g)").fill("25");
  await page.getByRole("button", { name: "Create Draft Trial" }).click();
  await page.waitForURL(/\/trials\/[0-9a-f-]{36}$/i);
  const trialId = page.url().match(/\/trials\/([0-9a-f-]{36})$/i)?.[1];
  if (!trialId) throw new Error("G5 browser workflow did not navigate to the created Trial.");
  await allocateTrialInventory(page, tenantId, trialId);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Prepare exact weighing plan" }).click();
  await visible(page, page.getByText("Trial prepared with exact G4 scaling."));
  await visible(page, page.getByText("25 g"));
  await page.getByRole("button", { name: "Start sensory evaluation" }).click();
  await visible(page, page.getByLabel("What did this sample smell like?"));
  await page
    .getByLabel("What did this sample smell like?")
    .fill("The opening needs a clearer jasminy lift.");
  await page.getByLabel("Sample age (minutes)").fill("45");
  await page.getByRole("button", { name: "Add taxonomy delta" }).click();
  await page.getByLabel("Sensory phase").selectOption("MID");
  await page.getByLabel("Canonical taxonomy term").selectOption("DESCRIPTOR:Jasminy");
  await page.getByLabel("Confirmed delta").fill("2");
  await page.getByRole("button", { name: "Interpret text" }).click();
  await visible(page, page.getByText(/interpreter is unavailable/i));
  await page.getByRole("button", { name: "Finalize Evaluation" }).click();
  await visible(page, page.getByText("FINAL · REVISION REQUIRED"));
  await page.getByRole("button", { name: "Create Revision Candidates" }).click();
  await visible(page, page.getByRole("heading", { name: "G4 revision candidates" }));
  const revisionResponsePromise = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/design-studio/formula-versions/${formulaVersionId}/revisions/freeze`) &&
      response.request().method() === "POST"
  );
  await page
    .getByRole("button", { name: /Freeze Revision$/ })
    .first()
    .click();
  const revisionResponse = await revisionResponsePromise;
  const revisionBody = (await revisionResponse.json()) as {
    formulaVersion?: { parentFormulaVersionId?: string | null };
  };
  if (
    revisionResponse.status() !== 201 ||
    revisionBody.formulaVersion?.parentFormulaVersionId !== formulaVersionId
  )
    throw new Error("G4 revision freeze did not preserve the G5 parent FormulaVersion lineage.");
  await visible(page, page.getByText("New immutable FormulaVersion frozen with parent lineage."));
  const detail = expectStatus(
    await api<{
      trial: { lines: Array<{ scaledMassMg: string }> };
      evaluation: { id: string } | null;
    }>(page, tenantId, `/trials/${trialId}`),
    200,
    "G5 browser Trial reload"
  );
  const total = detail.trial.lines.reduce((sum, line) => sum + BigInt(line.scaledMassMg), 0n);
  if (total !== 25_000n || !detail.evaluation)
    throw new Error("G5 browser workflow did not preserve exact mass and evaluation evidence.");
  await assertTrialConsumption(page, tenantId, trialId, 25_000n);
  return { trialId, evaluationId: detail.evaluation.id };
}
async function createPreparedTrial(
  page: Page,
  tenantId: string,
  formulaVersionId: string,
  purpose: string
): Promise<string> {
  const trial = expectStatus(
    await api<{ trial: { id: string } }>(page, tenantId, "/trials", "POST", {
      formulaVersionId,
      preparationMode: "CONCENTRATE",
      applicationKey: `fine-fragrance-${purpose}`,
      dosagePct: 20,
      carrierOrBaseReference: null,
      targetMassMg: "20000"
    }),
    201,
    `G5 ${purpose} Trial creation`
  ).trial;
  await allocateTrialInventory(page, tenantId, trial.id);
  const prepared = expectStatus(
    await api<{ trial: { lines: Array<{ scaledMassMg: string }> } }>(
      page,
      tenantId,
      `/trials/${trial.id}/prepare`,
      "POST"
    ),
    200,
    `G5 ${purpose} exact preparation`
  ).trial;
  const total = prepared.lines.reduce((sum, line) => sum + BigInt(line.scaledMassMg), 0n);
  if (total !== 20_000n) throw new Error("G5 exact scaling did not conserve target mass.");
  await assertTrialConsumption(page, tenantId, trial.id, 20_000n);
  return trial.id;
}

async function allocateTrialInventory(
  page: Page,
  tenantId: string,
  trialId: string
): Promise<void> {
  const plan = expectStatus(
    await api<{ plan: PreparationPlan }>(page, tenantId, `/trials/${trialId}/preparation-plan`),
    200,
    "G7 Trial preparation plan"
  ).plan;
  let stock = inventoryStock.get(tenantId);
  if (!stock) {
    const created = expectStatus(
      await api<{ location: { id: string } }>(page, tenantId, "/inventory/locations", "POST", {
        locationCode: `PREVIEW-${suffix.toUpperCase()}`,
        name: "Preview Trial Lab",
        description: "Gate 7 isolated acceptance"
      }),
      201,
      "G7 Preview Location"
    );
    stock = { locationId: created.location.id, lots: new Map() };
    inventoryStock.set(tenantId, stock);
  }
  const allocations: Array<{
    materialId: string;
    lotId: string;
    locationId: string;
    quantityMg: string;
  }> = [];
  const before = new Map<
    string,
    { onHand: bigint; reserved: bigint; available: bigint; quantity: bigint }
  >();
  for (const requirement of plan.requirements) {
    let lotId = stock.lots.get(requirement.materialId);
    if (!lotId) {
      const created = expectStatus(
        await api<{ lot: { id: string } }>(page, tenantId, "/inventory/lots", "POST", {
          materialId: requirement.materialId,
          lotCode: `PREVIEW-${suffix}-${requirement.materialId.slice(0, 8)}`,
          supplierLotCode: null,
          manufacturedAt: null,
          expiresAt: null,
          retestAt: null,
          notes: "Gate 7 isolated acceptance"
        }),
        201,
        "G7 Preview Lot"
      );
      lotId = created.lot.id;
      stock.lots.set(requirement.materialId, lotId);
      expectStatus(
        await api(page, tenantId, `/inventory/lots/${lotId}/receive`, "POST", {
          quantityMg: "10000000",
          toLocationId: stock.locationId,
          reasonCode: "G7_PREVIEW_ACCEPTANCE",
          operationKey: `preview:${suffix}:lot:${lotId}:opening`
        }),
        201,
        "G7 Preview opening stock"
      );
    }
    allocations.push({
      materialId: requirement.materialId,
      lotId,
      locationId: stock.locationId,
      quantityMg: requirement.requiredMassMg
    });
    const detail = expectStatus(
      await api<{
        lot: {
          balances: Array<{
            locationId: string;
            onHandMg: string;
            reservedMg: string;
            availableMg: string;
          }>;
        };
      }>(page, tenantId, `/inventory/lots/${lotId}`),
      200,
      "G7 pre-reservation Lot balance"
    );
    const balance = detail.lot.balances.find((item) => item.locationId === stock.locationId);
    if (!balance) throw new Error("G7 Preview opening balance is missing.");
    before.set(lotId, {
      onHand: BigInt(balance.onHandMg),
      reserved: BigInt(balance.reservedMg),
      available: BigInt(balance.availableMg),
      quantity: BigInt(requirement.requiredMassMg)
    });
  }
  const draftTrace = expectStatus(
    await api<{ trace: { movements: unknown[] } }>(
      page,
      tenantId,
      `/inventory/trials/${trialId}/trace`
    ),
    200,
    "G7 DRAFT Trial trace"
  );
  if (draftTrace.trace.movements.length !== 0)
    throw new Error("Create DRAFT Trial consumed Inventory.");
  expectStatus(
    await api(page, tenantId, `/trials/${trialId}/inventory/reservations`, "POST", {
      allocations,
      operationKey: `preview:${suffix}:trial:${trialId}:reserve`
    }),
    201,
    "G7 exact Trial reservation"
  );
  for (const allocation of allocations) {
    const original = before.get(allocation.lotId);
    const detail = expectStatus(
      await api<{
        lot: {
          balances: Array<{
            locationId: string;
            onHandMg: string;
            reservedMg: string;
            availableMg: string;
          }>;
        };
      }>(page, tenantId, `/inventory/lots/${allocation.lotId}`),
      200,
      "G7 post-reservation Lot balance"
    );
    const balance = detail.lot.balances.find((item) => item.locationId === allocation.locationId);
    if (
      !original ||
      !balance ||
      BigInt(balance.onHandMg) !== original.onHand ||
      BigInt(balance.reservedMg) !== original.reserved + original.quantity ||
      BigInt(balance.availableMg) !== original.available - original.quantity
    )
      throw new Error("G7 reservation changed On Hand or derived an incorrect Available balance.");
  }
}

async function runG7PreviewAcceptance(page: Page, tenantId: string): Promise<void> {
  type LotDetail = {
    lot: {
      id: string;
      lotCode: string;
      balances: Array<{
        locationId: string;
        onHandMg: string;
        reservedMg: string;
        availableMg: string;
      }>;
    };
    movements: Array<{
      id: string;
      sourceModule: string;
      sourceReferenceId: string | null;
      quantityMg: string;
    }>;
  };
  const stock = inventoryStock.get(tenantId);
  const lotId = stock ? [...stock.lots.values()][0] : undefined;
  if (!stock || !lotId) throw new Error("G7 Preview did not reconcile physical Material Lots.");
  const initial = expectStatus(
    await api<LotDetail>(page, tenantId, `/inventory/lots/${lotId}`),
    200,
    "G7 Preview Lot trace"
  );
  const firstBalance = initial.lot.balances.find((item) => item.locationId === stock.locationId);
  if (!firstBalance || BigInt(firstBalance.availableMg) < 1000n)
    throw new Error("G7 Preview Lot does not have enough derived Available stock.");

  const overConsume = await api(page, tenantId, `/inventory/lots/${lotId}/consume`, "POST", {
    quantityMg: (BigInt(firstBalance.availableMg) + 1n).toString(),
    fromLocationId: stock.locationId,
    reasonCode: "G7_PREVIEW_RESERVED_STOCK_PROBE",
    operationKey: `preview:${suffix}:reserved-stock-probe`
  });
  if (overConsume.status !== 409)
    throw new Error("G7 Preview allowed manual consumption beyond Available stock.");

  const secondLocation = expectStatus(
    await api<{ location: { id: string } }>(page, tenantId, "/inventory/locations", "POST", {
      locationCode: `PREVIEW-B-${suffix.toUpperCase()}`,
      name: "Preview Secondary Trial Lab",
      description: "Gate 7 transfer acceptance"
    }),
    201,
    "G7 Preview secondary Location"
  ).location;
  expectStatus(
    await api(page, tenantId, `/inventory/lots/${lotId}/transfer`, "POST", {
      quantityMg: "1000",
      fromLocationId: stock.locationId,
      toLocationId: secondLocation.id,
      reasonCode: "G7_PREVIEW_TRANSFER",
      operationKey: `preview:${suffix}:transfer`
    }),
    201,
    "G7 Preview atomic transfer"
  );
  expectStatus(
    await api(page, tenantId, `/inventory/lots/${lotId}/hold`, "POST"),
    200,
    "G7 Preview Lot HOLD"
  );
  for (const [path, body] of [
    [
      "reservations",
      {
        locationId: secondLocation.id,
        quantityMg: "1",
        operationKey: `preview:${suffix}:hold-reservation`
      }
    ],
    [
      "consume",
      {
        fromLocationId: secondLocation.id,
        quantityMg: "1",
        reasonCode: "G7_PREVIEW_HOLD",
        operationKey: `preview:${suffix}:hold-consume`
      }
    ]
  ] as const) {
    const blocked = await api(page, tenantId, `/inventory/lots/${lotId}/${path}`, "POST", body);
    if (blocked.status !== 409) throw new Error(`G7 Preview HOLD allowed ${path}.`);
  }
  expectStatus(
    await api(page, tenantId, `/inventory/lots/${lotId}/release-hold`, "POST"),
    200,
    "G7 Preview Lot HOLD release"
  );

  const denied = await api(page, randomUUID(), `/inventory/lots/${lotId}`);
  if (![403, 404].includes(denied.status))
    throw new Error("G7 Preview forged cross-tenant context was accepted.");
  const forged = await api(page, tenantId, `/inventory/lots/${lotId}/receive`, "POST", {
    quantityMg: "1",
    toLocationId: stock.locationId,
    operationKey: `preview:${suffix}:forged-trial-provenance`,
    sourceModule: "TRIAL"
  });
  if (forged.status !== 400) throw new Error("G7 Preview browser forged TRIAL provenance.");

  const traced = expectStatus(
    await api<LotDetail>(page, tenantId, `/inventory/lots/${lotId}`),
    200,
    "G7 Preview Lot reverse trace"
  );
  const trialReferences = new Set(
    traced.movements
      .filter((item) => item.sourceModule === "TRIAL")
      .map((item) => item.sourceReferenceId)
      .filter((item): item is string => Boolean(item))
  );
  if (trialReferences.size < 2)
    throw new Error("G7 Preview Lot did not trace multiple independent physical Trials.");

  await page.goto(url("/inventory"), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "Inventory Registry" }));
  await visible(page, page.getByText(/kg| g|mg/).first());
  await captureG7(page, "inventory-registry-desktop", "/inventory");
  await page.goto(url(`/inventory/lots/${lotId}`), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: new RegExp(initial.lot.lotCode) }));
  await captureG7(page, "inventory-lot-detail-desktop", `/inventory/lots/${lotId}`);
}

async function runG8PreviewAcceptance(page: Page, tenantId: string): Promise<void> {
  type PurchaseOrderResult = {
    purchaseOrder: {
      id: string;
      status: string;
      lines: Array<{
        id: string;
        materialId: string;
        orderedQuantityMg: string;
        receivedQuantityMg: string;
        remainingQuantityMg: string;
      }>;
    };
  };
  type ReceiptResult = {
    goodsReceipt: {
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

  const stock = inventoryStock.get(tenantId);
  const materialId = stock ? [...stock.lots.keys()][0] : undefined;
  if (!stock || !materialId)
    throw new Error("G8 Preview requires the accepted G7 Location and G3 Material seam.");

  const context = expectStatus(
    await api<{
      moduleAvailability: Array<{ moduleId: string; state: string }>;
      authorization: { modulePermissions: string[] };
    }>(page, tenantId, "/context"),
    200,
    "G8 Preview tenant context"
  );
  if (
    context.moduleAvailability.find((item) => item.moduleId === "procurement")?.state !==
      "AVAILABLE" ||
    !context.authorization.modulePermissions.includes("module.procurement.receipt.post")
  )
    throw new Error("G8 Procurement is not AVAILABLE with receipt authority in Preview.");

  const supplier = expectStatus(
    await api<{ supplier: { id: string; status: string } }>(
      page,
      tenantId,
      "/procurement/suppliers",
      "POST",
      {
        supplierCode: `G8-${suffix.toUpperCase()}`,
        legalName: `G8 Preview Supplier ${suffix}`,
        displayName: `G8 Preview Supplier ${suffix}`,
        countryCode: "AU",
        primaryEmail: null,
        primaryPhone: null,
        website: null,
        taxIdentifier: null,
        defaultCurrency: "AUD",
        defaultIncoterm: "DAP",
        notes: "Exact-SHA G8 Preview acceptance"
      }
    ),
    201,
    "G8 Supplier creation"
  ).supplier;

  expectStatus(
    await api(page, tenantId, "/procurement/supplier-offers", "POST", {
      supplierId: supplier.id,
      materialId,
      supplierSku: `SKU-${suffix.toUpperCase()}`,
      supplierMaterialName: `G8 Preview Material ${suffix}`,
      packSizeMg: "25000000",
      minimumOrderQuantityMg: "1000000",
      unitPricePerKg: "123.4567",
      currencyCode: "AUD",
      leadTimeDays: 14,
      lastQuotedAt: new Date().toISOString(),
      sourceReference: "G8 exact-SHA Preview fixture"
    }),
    201,
    "G8 Supplier Offer creation"
  );

  const createPo = async (number: string, quantityMg: string) =>
    expectStatus(
      await api<PurchaseOrderResult>(page, tenantId, "/procurement/purchase-orders", "POST", {
        poNumber: number,
        supplierId: supplier.id,
        orderType: "STANDARD",
        currencyCode: "AUD",
        supplierQuoteReference: `QUOTE-${suffix}`,
        expectedDeliveryAt: null,
        incoterm: "DAP",
        freightAmount: "0",
        notes: "G8 exact-SHA Preview fixture",
        lines: [
          {
            materialId,
            supplierOfferId: null,
            supplierSkuSnapshot: `SKU-${suffix.toUpperCase()}`,
            supplierMaterialNameSnapshot: `G8 Preview Material ${suffix}`,
            orderedQuantityMg: quantityMg,
            unitPricePerKg: "123.4567",
            expectedDeliveryAt: null,
            notes: null
          }
        ]
      }),
      201,
      `G8 Purchase Order ${number}`
    ).purchaseOrder;
  const approvePo = async (id: string) =>
    expectStatus(
      await api<PurchaseOrderResult>(
        page,
        tenantId,
        `/procurement/purchase-orders/${id}/approve`,
        "POST"
      ),
      200,
      "G8 Purchase Order approval"
    ).purchaseOrder;
  const createReceipt = async (
    purchaseOrderId: string,
    purchaseOrderLineId: string,
    receiptNumber: string,
    lines: Array<{ quantityMg: string; lotCode: string }>
  ) =>
    expectStatus(
      await api<ReceiptResult>(page, tenantId, "/procurement/goods-receipts", "POST", {
        receiptNumber,
        purchaseOrderId,
        supplierDeliveryReference: `DEL-${receiptNumber}`,
        receivedAt: new Date().toISOString(),
        lines: lines.map((line) => ({
          purchaseOrderLineId,
          materialId,
          receivedQuantityMg: line.quantityMg,
          lotCode: line.lotCode,
          supplierLotCode: `SUP-${line.lotCode}`,
          manufacturedAt: null,
          expiresAt: null,
          retestAt: null,
          destinationLocationId: stock.locationId
        }))
      }),
      201,
      `G8 Goods Receipt ${receiptNumber}`
    ).goodsReceipt;
  const postReceipt = async (receiptId: string) =>
    expectStatus(
      await api<ReceiptResult>(
        page,
        tenantId,
        `/procurement/goods-receipts/${receiptId}/post`,
        "POST"
      ),
      200,
      "G8 Goods Receipt POST"
    ).goodsReceipt;

  const po = await createPo(`G8-PO-${suffix}`, "25000000");
  const approved = await approvePo(po.id);
  const poLineId = approved.lines[0]?.id;
  if (!poLineId) throw new Error("G8 approved Purchase Order has no line.");
  const immutable = await api(page, tenantId, `/procurement/purchase-orders/${po.id}`, "PUT", {
    notes: "forbidden commercial rewrite"
  });
  if (immutable.status !== 409)
    throw new Error("G8 Preview allowed APPROVED Purchase Order mutation.");

  const lotA = `G8-A-${suffix}`;
  const draftA = await createReceipt(po.id, poLineId, `G8-GR-A-${suffix}`, [
    { quantityMg: "10000000", lotCode: lotA }
  ]);
  const beforeLots = expectStatus(
    await api<{ lots: Array<{ lotCode: string }> }>(page, tenantId, "/inventory/lots"),
    200,
    "G8 DRAFT Inventory probe"
  );
  if (beforeLots.lots.some((item) => item.lotCode === lotA))
    throw new Error("DRAFT Goods Receipt changed G7 Inventory.");
  const postedA = await postReceipt(draftA.id);
  if (
    postedA.status !== "POSTED" ||
    !postedA.lines[0]?.inventoryLotId ||
    !postedA.lines[0]?.inventoryMovementId
  )
    throw new Error("G8 Goods Receipt POST did not persist G7 trace references.");
  const traceA = expectStatus(
    await api<LotTrace>(page, tenantId, `/inventory/lots/${postedA.lines[0].inventoryLotId}`),
    200,
    "G8 forward Inventory trace"
  );
  if (
    !traceA.movements.some(
      (movement) =>
        movement.id === postedA.lines[0]?.inventoryMovementId &&
        movement.sourceModule === "PROCUREMENT" &&
        movement.sourceReferenceId === postedA.lines[0]?.id &&
        movement.quantityMg === "10000000"
    )
  )
    throw new Error("G8→G7 PROCUREMENT provenance is incomplete.");

  const partial = expectStatus(
    await api<PurchaseOrderResult>(page, tenantId, `/procurement/purchase-orders/${po.id}`),
    200,
    "G8 partial receipt derivation"
  ).purchaseOrder;
  if (
    partial.status !== "PARTIALLY_RECEIVED" ||
    partial.lines[0]?.receivedQuantityMg !== "10000000" ||
    partial.lines[0]?.remainingQuantityMg !== "15000000"
  )
    throw new Error("G8 partial Purchase Order totals were not derived from POSTED receipts.");

  const draftB = await createReceipt(po.id, poLineId, `G8-GR-B-${suffix}`, [
    { quantityMg: "10000000", lotCode: `G8-B1-${suffix}` },
    { quantityMg: "5000000", lotCode: `G8-B2-${suffix}` }
  ]);
  const postedB = await postReceipt(draftB.id);
  if (
    postedB.lines.length !== 2 ||
    postedB.lines.some((line) => !line.inventoryLotId || !line.inventoryMovementId)
  )
    throw new Error("G8 multi-Lot receipt did not create two exact G7 traces.");
  const complete = expectStatus(
    await api<PurchaseOrderResult>(page, tenantId, `/procurement/purchase-orders/${po.id}`),
    200,
    "G8 full receipt derivation"
  ).purchaseOrder;
  if (
    complete.status !== "RECEIVED" ||
    complete.lines[0]?.receivedQuantityMg !== "25000000" ||
    complete.lines[0]?.remainingQuantityMg !== "0"
  )
    throw new Error("G8 full Purchase Order receipt did not close exact quantity.");

  const movementCounts = new Map<string, number>();
  for (const line of postedB.lines) {
    const trace = expectStatus(
      await api<LotTrace>(page, tenantId, `/inventory/lots/${line.inventoryLotId}`),
      200,
      "G8 reverse Inventory trace"
    );
    movementCounts.set(
      line.id,
      trace.movements.filter(
        (movement) =>
          movement.sourceModule === "PROCUREMENT" && movement.sourceReferenceId === line.id
      ).length
    );
  }
  await postReceipt(draftB.id);
  for (const line of postedB.lines) {
    const trace = expectStatus(
      await api<LotTrace>(page, tenantId, `/inventory/lots/${line.inventoryLotId}`),
      200,
      "G8 idempotent Inventory trace"
    );
    const count = trace.movements.filter(
      (movement) =>
        movement.sourceModule === "PROCUREMENT" && movement.sourceReferenceId === line.id
    ).length;
    if (count !== 1 || count !== movementCounts.get(line.id))
      throw new Error("G8 receipt retry duplicated G7 stock.");
  }

  const overPo = await createPo(`G8-OVER-${suffix}`, "10000000");
  const overApproved = await approvePo(overPo.id);
  const overLineId = overApproved.lines[0]?.id;
  if (!overLineId) throw new Error("G8 over-receipt PO has no line.");
  const overReceipt = await createReceipt(overPo.id, overLineId, `G8-GR-OVER-${suffix}`, [
    { quantityMg: "10000001", lotCode: `G8-OVER-${suffix}` }
  ]);
  const overPost = await api(
    page,
    tenantId,
    `/procurement/goods-receipts/${overReceipt.id}/post`,
    "POST"
  );
  if (overPost.status !== 409)
    throw new Error("G8 Preview allowed receipt beyond ordered quantity.");

  const heldCompatible = await createPo(`G8-HOLD-OLD-${suffix}`, "1000");
  const heldApproved = await approvePo(heldCompatible.id);
  expectStatus(
    await api(page, tenantId, `/procurement/suppliers/${supplier.id}`, "PUT", { status: "HOLD" }),
    200,
    "G8 Supplier HOLD"
  );
  const newHeldPo = await createPo(`G8-HOLD-NEW-${suffix}`, "1000");
  const heldApproval = await api(
    page,
    tenantId,
    `/procurement/purchase-orders/${newHeldPo.id}/approve`,
    "POST"
  );
  if (heldApproval.status !== 409)
    throw new Error("G8 Supplier HOLD allowed new Purchase Order approval.");
  const heldLineId = heldApproved.lines[0]?.id;
  if (!heldLineId) throw new Error("G8 pre-HOLD approved PO has no line.");
  const heldReceipt = await createReceipt(heldApproved.id, heldLineId, `G8-GR-HOLD-${suffix}`, [
    { quantityMg: "1000", lotCode: `G8-HOLD-${suffix}` }
  ]);
  await postReceipt(heldReceipt.id);

  const denied = await api(page, randomUUID(), `/procurement/suppliers/${supplier.id}`);
  if (![403, 404].includes(denied.status))
    throw new Error("G8 Preview accepted forged cross-tenant Procurement access.");
  const baseLotId = [...stock.lots.values()][0];
  const forged = await api(page, tenantId, `/inventory/lots/${baseLotId}/receive`, "POST", {
    quantityMg: "1",
    toLocationId: stock.locationId,
    reasonCode: "G8_PREVIEW_FORGERY",
    operationKey: `preview:${suffix}:forged-procurement`,
    sourceModule: "PROCUREMENT",
    sourceReferenceId: postedA.lines[0].id
  });
  if (forged.status !== 400) throw new Error("G8 Preview browser forged PROCUREMENT provenance.");

  await page.goto(url("/procurement"), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "Procurement" }));
  await visible(page, page.getByRole("heading", { name: "Purchase Orders" }));
  await visible(page, page.getByText(`G8-PO-${suffix}`));
  await captureG8(page, "procurement-purchase-orders-desktop", "/procurement");
}

async function runG9PreviewAcceptance(
  page: Page,
  tenantId: string,
  formulaVersionId: string
): Promise<void> {
  type ProductionOrder = {
    id: string;
    status: string;
    formulaVersionId: string;
    targetMassMg: string;
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
  type ProductionBatch = {
    id: string;
    productionOrderId: string;
    actualOutputMassMg: string | null;
    allocations: ProductionOrder["allocations"];
  };
  type LotDetail = {
    lot: {
      balances: Array<{
        locationId: string;
        onHandMg: string;
        reservedMg: string;
        availableMg: string;
      }>;
    };
    movements: Array<{
      sourceModule: string;
      sourceReferenceId: string | null;
      quantityMg: string;
    }>;
  };

  const context = expectStatus(
    await api<{
      moduleAvailability: Array<{ moduleId: string; state: string }>;
      authorization: { modulePermissions: string[] };
    }>(page, tenantId, "/context"),
    200,
    "G9 Preview tenant context"
  );
  const production = context.moduleAvailability.find((item) => item.moduleId === "production");
  if (
    production?.state !== "AVAILABLE" ||
    !context.authorization.modulePermissions.includes("module.production.order.create") ||
    !context.authorization.modulePermissions.includes("module.production.order.release") ||
    !context.authorization.modulePermissions.includes("module.production.batch.start")
  )
    throw new Error("Production is not AVAILABLE with the expected permissions in Preview.");

  const formulaLines = await runtime<
    {
      material_id: string;
    }[]
  >`
    select material_id::text
    from design_studio.formula_lines
    where tenant_id = ${tenantId} and formula_version_id = ${formulaVersionId}
    order by line_order
  `;
  if (!formulaLines.length) throw new Error("G9 Preview formula has no production requirements.");
  const stock = inventoryStock.get(tenantId);
  if (!stock) throw new Error("G9 Preview requires the reconciled G7 inventory location.");

  const ensureLot = async (materialId: string, label: string): Promise<string> => {
    const existing = stock.lots.get(materialId);
    if (existing) return existing;
    const created = expectStatus(
      await api<{ lot: { id: string } }>(page, tenantId, "/inventory/lots", "POST", {
        materialId,
        lotCode: `G9-${label}-${suffix}-${materialId.slice(0, 8)}`,
        supplierLotCode: null,
        manufacturedAt: null,
        expiresAt: null,
        retestAt: null,
        notes: "G9 production acceptance fixture"
      }),
      201,
      "G9 Preview lot"
    ).lot.id;
    stock.lots.set(materialId, created);
    expectStatus(
      await api(page, tenantId, `/inventory/lots/${created}/receive`, "POST", {
        quantityMg: "10000000",
        toLocationId: stock.locationId,
        reasonCode: "G9_PREVIEW_ACCEPTANCE",
        operationKey: `g9:${suffix}:opening:${created}`
      }),
      201,
      "G9 Preview opening stock"
    );
    return created;
  };
  const targetMassMg = "1000000";
  const createOrder = async (label: string) =>
    expectStatus(
      await api<{ order: ProductionOrder }>(page, tenantId, "/production/orders", "POST", {
        orderNumber: `G9-${label}-${suffix}`,
        formulaVersionId,
        targetMassMg,
        notes: "G9 exact-SHA production acceptance fixture"
      }),
      201,
      `G9 ${label} order creation`
    ).order;
  const allocationFor = async (order: ProductionOrder, split: boolean) => {
    const allocations: Array<{
      productionOrderLineId: string;
      lotId: string;
      locationId: string;
      allocatedMassMg: string;
    }> = [];
    for (const [index, line] of order.lines.entries()) {
      const lotId = await ensureLot(line.materialId, `LOT-${index}`);
      const required = BigInt(line.requiredMassMg);
      if (split && index === 0 && required > 1n) {
        const second = expectStatus(
          await api<{ lot: { id: string } }>(page, tenantId, "/inventory/lots", "POST", {
            materialId: line.materialId,
            lotCode: `G9-SPLIT-${suffix}-${line.materialId.slice(0, 8)}`,
            supplierLotCode: null,
            manufacturedAt: null,
            expiresAt: null,
            retestAt: null,
            notes: "G9 split-lot acceptance fixture"
          }),
          201,
          "G9 split lot"
        ).lot.id;
        expectStatus(
          await api(page, tenantId, `/inventory/lots/${second}/receive`, "POST", {
            quantityMg: "10000000",
            toLocationId: stock.locationId,
            reasonCode: "G9_PREVIEW_ACCEPTANCE",
            operationKey: `g9:${suffix}:split-opening:${second}`
          }),
          201,
          "G9 split opening stock"
        );
        const firstMass = required / 2n;
        allocations.push({
          productionOrderLineId: line.id,
          lotId,
          locationId: stock.locationId,
          allocatedMassMg: String(firstMass)
        });
        allocations.push({
          productionOrderLineId: line.id,
          lotId: second,
          locationId: stock.locationId,
          allocatedMassMg: String(required - firstMass)
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
    return expectStatus(
      await api<{ order: ProductionOrder }>(
        page,
        tenantId,
        `/production/orders/${order.id}/allocations`,
        "PUT",
        { allocations }
      ),
      200,
      "G9 exact allocations"
    ).order;
  };
  const balance = async (lotId: string) => {
    const detail = expectStatus(
      await api<LotDetail>(page, tenantId, `/inventory/lots/${lotId}`),
      200,
      "G9 lot balance"
    );
    const value = detail.lot.balances.find((item) => item.locationId === stock.locationId);
    if (!value) throw new Error("G9 lot balance is missing at the acceptance location.");
    return { detail, onHand: BigInt(value.onHandMg), reserved: BigInt(value.reservedMg) };
  };

  // Ensure a current READY assessment exists for release.
  for (const line of formulaLines)
    await runtime`
      update material_intelligence.material_properties
      set ifra_restricted = false, ifra_cat4_max_pct = 100, ifra_amendment = '51', updated_at = now()
      where material_id = ${line.material_id}
    `;
  const ready = expectStatus(
    await api<{ assessment: { id: string; decision: string } }>(
      page,
      tenantId,
      "/release-readiness/assessments",
      "POST",
      {
        formulaVersionId,
        applicationKey: "fine-fragrance",
        dosagePct: 10,
        policyKey: "g6-known-limit-v1"
      }
    ),
    201,
    "G9 current READY assessment"
  ).assessment;
  if (ready.decision !== "READY") throw new Error("G9 could not establish a READY assessment.");

  const order = await allocationFor(await createOrder("MAIN"), true);
  const before = new Map<string, { onHand: bigint; reserved: bigint }>();
  for (const allocation of order.allocations)
    before.set(allocation.inventoryLotId, await balance(allocation.inventoryLotId));
  const released = expectStatus(
    await api<{ order: ProductionOrder }>(
      page,
      tenantId,
      `/production/orders/${order.id}/release`,
      "POST"
    ),
    200,
    "G9 release"
  ).order;
  if (released.status !== "RELEASED" || !released.releaseReadinessAssessmentId)
    throw new Error("G9 release did not reserve the complete order.");
  for (const allocation of order.allocations) {
    const after = await balance(allocation.inventoryLotId);
    const initial = before.get(allocation.inventoryLotId)!;
    if (after.onHand !== initial.onHand || after.reserved < initial.reserved)
      throw new Error("G9 release changed On Hand or failed to reserve stock atomically.");
  }

  // A newer BLOCKED assessment must prevent START, then a newer READY assessment permits it.
  const restricted = formulaLines[0].material_id;
  await runtime`
    update material_intelligence.material_properties
    set ifra_restricted = true, ifra_cat4_max_pct = 0, ifra_amendment = '51', updated_at = now()
    where material_id = ${restricted}
  `;
  const blocked = expectStatus(
    await api<{ assessment: { id: string; decision: string } }>(
      page,
      tenantId,
      `/release-readiness/assessments/${ready.id}/reassess`,
      "POST"
    ),
    201,
    "G9 blocked revalidation"
  ).assessment;
  if (blocked.decision !== "BLOCKED") throw new Error("G9 BLOCKED revalidation did not occur.");
  const deniedStart = await api(page, tenantId, `/production/orders/${order.id}/start`, "POST");
  if (deniedStart.status !== 409)
    throw new Error("G9 START ignored a newer BLOCKED readiness assessment.");
  await runtime`
    update material_intelligence.material_properties
    set ifra_restricted = false, ifra_cat4_max_pct = 100, ifra_amendment = '51', updated_at = now()
    where material_id = ${restricted}
  `;
  const currentReady = expectStatus(
    await api<{ assessment: { id: string; decision: string } }>(
      page,
      tenantId,
      `/release-readiness/assessments/${blocked.id}/reassess`,
      "POST"
    ),
    201,
    "G9 READY revalidation"
  ).assessment;
  if (currentReady.decision !== "READY") throw new Error("G9 READY revalidation did not occur.");

  const batch = expectStatus(
    await api<{ batch: ProductionBatch }>(
      page,
      tenantId,
      `/production/orders/${order.id}/start`,
      "POST"
    ),
    200,
    "G9 start"
  ).batch;
  if (
    batch.productionOrderId !== order.id ||
    batch.allocations.some((a) => !a.inventoryConsumptionMovementId)
  )
    throw new Error("G9 START did not consume every reserved allocation atomically.");
  const duplicate = expectStatus(
    await api<{ batch: ProductionBatch }>(
      page,
      tenantId,
      `/production/orders/${order.id}/start`,
      "POST"
    ),
    200,
    "G9 idempotent start"
  ).batch;
  if (duplicate.id !== batch.id) throw new Error("G9 duplicate START created a second batch.");
  for (const allocation of batch.allocations) {
    const trace = (await balance(allocation.inventoryLotId)).detail;
    if (
      !trace.movements.some(
        (movement) =>
          movement.sourceModule === "PRODUCTION" &&
          movement.sourceReferenceId === allocation.id &&
          movement.quantityMg === allocation.allocatedMassMg
      )
    )
      throw new Error("G9 PRODUCTION inventory provenance is incomplete.");
  }
  const completed = expectStatus(
    await api<{ batch: ProductionBatch }>(
      page,
      tenantId,
      `/production/batches/${batch.id}/complete`,
      "POST",
      {
        actualOutputMassMg: "980000",
        processNotes: "G9 acceptance completion"
      }
    ),
    200,
    "G9 complete"
  ).batch;
  if (completed.actualOutputMassMg !== "980000")
    throw new Error("G9 actual output was not recorded.");

  const cancel = await allocationFor(await createOrder("CANCEL"), false);
  expectStatus(
    await api(page, tenantId, `/production/orders/${cancel.id}/release`, "POST"),
    200,
    "G9 released cancel"
  );
  const cancelled = expectStatus(
    await api<{ order: ProductionOrder }>(
      page,
      tenantId,
      `/production/orders/${cancel.id}/cancel`,
      "POST"
    ),
    200,
    "G9 cancel"
  ).order;
  if (cancelled.status !== "CANCELLED")
    throw new Error("G9 RELEASED cancellation did not release reservations.");

  const abortOrder = await allocationFor(await createOrder("ABORT"), false);
  await expectStatus(
    await api(page, tenantId, `/production/orders/${abortOrder.id}/release`, "POST"),
    200,
    "G9 abort release"
  );
  const abortBatch = expectStatus(
    await api<{ batch: ProductionBatch }>(
      page,
      tenantId,
      `/production/orders/${abortOrder.id}/start`,
      "POST"
    ),
    200,
    "G9 abort start"
  ).batch;
  const aborted = expectStatus(
    await api<{ batch: ProductionBatch }>(
      page,
      tenantId,
      `/production/batches/${abortBatch.id}/abort`,
      "POST",
      {
        reason: "G9 controlled abort"
      }
    ),
    200,
    "G9 abort"
  ).batch;
  if (!aborted.id) throw new Error("G9 abort did not persist the batch terminal state.");

  const crossTenant = await api(page, randomUUID(), `/production/orders/${order.id}`);
  if (![403, 404].includes(crossTenant.status))
    throw new Error("G9 cross-tenant order access was not denied.");
  await page.goto(url("/production"), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "Production" }));
  await page.goto(url(`/production/batches/${batch.id}`), { waitUntil: "networkidle" });
  await visible(page, page.getByText("QC NOT ASSESSED"));
}

async function assertTrialConsumption(
  page: Page,
  tenantId: string,
  trialId: string,
  expected: bigint
) {
  const value = expectStatus(
    await api<{
      trace: {
        movements: Array<{
          lotId: string;
          quantityMg: string;
          sourceModule: string;
          sourceReferenceId: string;
        }>;
      };
    }>(page, tenantId, `/inventory/trials/${trialId}/trace`),
    200,
    "G7 PREPARED Trial trace"
  );
  if (
    value.trace.movements.reduce((sum, item) => sum + BigInt(item.quantityMg), 0n) !== expected ||
    value.trace.movements.some(
      (item) => item.sourceModule !== "TRIAL" || item.sourceReferenceId !== trialId
    )
  )
    throw new Error("PREPARED Trial did not consume its exact Inventory reservation set.");
  for (const lotId of new Set(value.trace.movements.map((item) => item.lotId))) {
    const detail = expectStatus(
      await api<{
        lot: {
          balances: Array<{ onHandMg: string; reservedMg: string; availableMg: string }>;
        };
        reservations: Array<{ sourceReferenceId: string | null; status: string }>;
      }>(page, tenantId, `/inventory/lots/${lotId}`),
      200,
      "G7 consumed Trial Lot state"
    );
    if (
      detail.reservations.some(
        (item) => item.sourceReferenceId === trialId && item.status !== "CONSUMED"
      ) ||
      detail.lot.balances.some(
        (item) => BigInt(item.onHandMg) - BigInt(item.reservedMg) !== BigInt(item.availableMg)
      )
    )
      throw new Error("PREPARED Trial left a non-consumed reservation or invalid balance.");
  }
}
function delta(confirmedDelta: number) {
  return {
    phase: "MID",
    assignmentType: "DESCRIPTOR",
    taxonomyTerm: "Jasminy",
    proposedDelta: null,
    confirmedDelta,
    proposalConfidence: null,
    interpreterVersion: null
  };
}
async function createEvaluation(
  page: Page,
  tenantId: string,
  trialId: string,
  input: { evaluationText: string; decision: string; deltas: ReturnType<typeof delta>[] }
): Promise<string> {
  const evaluation = expectStatus(
    await api<{ evaluation: { id: string } }>(
      page,
      tenantId,
      `/trials/${trialId}/evaluations`,
      "POST",
      {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 45,
        temperatureC: null,
        humidityPct: null,
        evaluationText: input.evaluationText,
        diagnosticNote: "Non-canonical diagnostic hypothesis"
      }
    ),
    201,
    "G5 evaluation creation"
  ).evaluation;
  expectStatus(
    await api(page, tenantId, `/trials/${trialId}/evaluations/${evaluation.id}`, "PUT", {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 45,
      temperatureC: null,
      humidityPct: null,
      evaluationText: input.evaluationText,
      diagnosticNote: "Non-canonical diagnostic hypothesis",
      deltas: input.deltas
    }),
    200,
    "G5 raw sensory evidence and manual mapping"
  );
  const interpreter = await api(
    page,
    tenantId,
    `/trials/${trialId}/evaluations/${evaluation.id}/interpret`,
    "POST"
  );
  if (interpreter.status !== 503)
    throw new Error("Unavailable interpreter did not fail safely while preserving manual mapping.");
  expectStatus(
    await api(page, tenantId, `/trials/${trialId}/evaluations/${evaluation.id}/finalize`, "POST", {
      decision: input.decision,
      deltas: input.deltas
    }),
    200,
    "G5 FINAL evaluation"
  );
  const immutable = await api(
    page,
    tenantId,
    `/trials/${trialId}/evaluations/${evaluation.id}`,
    "PUT",
    {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 46,
      evaluationText: "Mutation must fail.",
      diagnosticNote: null,
      deltas: input.deltas
    }
  );
  if (immutable.status !== 409) throw new Error("FINAL evaluation was not immutable.");
  return evaluation.id;
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

async function captureG6(page: Page, name: string, route: string) {
  if (!g6CaptureDirectory) return;
  await mkdir(g6CaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(g6CaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(g6CaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSha, environment: "preview" },
      null,
      2
    ) + "\n"
  );
}

async function captureG7(page: Page, name: string, route: string) {
  if (!g7CaptureDirectory) return;
  await mkdir(g7CaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(g7CaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(g7CaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSha, environment: "preview" },
      null,
      2
    ) + "\n"
  );
}

async function captureG8(page: Page, name: string, route: string) {
  if (!g8CaptureDirectory) return;
  await mkdir(g8CaptureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(g8CaptureDirectory, `${name}.png`), fullPage: true });
  await writeFile(
    resolve(g8CaptureDirectory, `${name}.json`),
    JSON.stringify(
      { route, viewport: page.viewportSize(), sha: expectedSha, environment: "preview" },
      null,
      2
    ) + "\n"
  );
}
