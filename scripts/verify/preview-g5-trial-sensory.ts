import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

type ApiResult<T = unknown> = { status: number; body: T };
type Candidate = { generationStrategy: string };

const previewUrl = required("NOX_PREVIEW_URL");
const expectedSha = required("EXPECTED_SOURCE_SHA");
const email = required("NOX_PREVIEW_MATERIAL_USER_EMAIL");
const password = required("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const captureDirectory = process.env.G5_VISUAL_CAPTURE_DIR;
const suffix = randomUUID().slice(0, 8);

if (!/^[0-9a-f]{40}$/i.test(expectedSha))
  throw new Error("G5 Preview acceptance requires a full immutable source SHA.");

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
}

console.log("G5_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
console.log("G5_TRIAL_SCALING=PASS");
console.log("G5_SENSORY_REVISION=PASS");
console.log("G5_APPROVAL_EVIDENCE=PASS");

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
  return trial.id;
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
