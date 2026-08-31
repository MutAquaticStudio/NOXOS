import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

type ApiResult<T> = { status: number; body: T };

const previewUrl = required("NOX_PREVIEW_URL");
const expectedSha = required("EXPECTED_SOURCE_SHA");
const email = required("NOX_PREVIEW_MATERIAL_USER_EMAIL");
const password = required("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const captureDirectory = process.env.G4_VISUAL_CAPTURE_DIR;
const suffix = randomUUID().slice(0, 8);

if (!/^[0-9a-f]{40}$/i.test(expectedSha))
  throw new Error("G4 Preview acceptance requires a full immutable source SHA.");

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
  await assertDesignAvailability(page, tenantId);
  await completeFormulaWorkflow(page, tenantId);
  await completeAccordWorkflow(page, tenantId);

  await page.goto(url("/design-studio"), { waitUntil: "networkidle" });
  await visible(page, page.getByRole("heading", { name: "What do you want to create?" }));
  await capture(page, "design-studio-entry-desktop", "/design-studio");
  await page.getByRole("button", { name: /Complete Formula/i }).click();
  await visible(page, page.getByRole("heading", { name: "Brief Composer" }));
  await capture(page, "design-studio-formula-desktop", "/design-studio");

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: bypassHeaders()
  });
  try {
    await mobile.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await signIn(mobile);
    await mobile.goto(url("/design-studio"), { waitUntil: "networkidle" });
    await visible(mobile, mobile.getByRole("heading", { name: "What do you want to create?" }));
    await capture(mobile, "design-studio-entry-mobile", "/design-studio");
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}

console.log("G4_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
console.log("G4_FORMULA_WORKFLOW=PASS");
console.log("G4_ACCORD_WORKFLOW=PASS");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for G4 Preview acceptance.`);
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
      throw new Error(`G4 Preview identity failed for ${path}.`);
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
  if (!value) throw new Error("Authenticated Preview did not expose its Supabase browser session.");
  return value;
}
async function api<T>(
  page: Page,
  tenantId: string,
  path: string,
  method = "GET",
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<ApiResult<T>> {
  const token = await accessToken(page);
  return page.evaluate(
    async ({ path, method, body, tenantId, token, extraHeaders }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "x-nox-tenant-id": tenantId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...extraHeaders
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body, tenantId, token, extraHeaders }
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
  if (result.status !== 200 || !tenantId) throw new Error("G4 Preview requires one active tenant.");
  return tenantId;
}
async function assertDesignAvailability(page: Page, tenantId: string) {
  const context = expectStatus(
    await api<{
      moduleAvailability?: Array<{ moduleId: string; state: string }>;
      authorization?: { modulePermissions?: string[] };
    }>(page, tenantId, "/context"),
    200,
    "Design Studio context"
  );
  if (
    context.moduleAvailability?.find((item) => item.moduleId === "design-studio")?.state !==
      "AVAILABLE" ||
    !context.authorization?.modulePermissions?.includes("module.design-studio.formula.freeze")
  )
    throw new Error("Design Studio is not available with the expected server permissions.");
  const denied = await page.request.post(url("/api/v1/design-studio/projects"), {
    headers: {
      ...(bypassHeaders() ?? {}),
      "content-type": "application/json",
      "x-nox-tenant-id": tenantId,
      "x-role": "TENANT_OWNER",
      "x-permission": "module.design-studio.project.create",
      "x-is-owner": "true"
    },
    data: { name: "Forged authority must fail" }
  });
  if (denied.status() !== 401)
    throw new Error("Forged authority headers affected an unauthenticated G4 request.");
}
async function createConfirmedBrief(page: Page, tenantId: string, workflowMode: string) {
  const project = expectStatus(
    await api<{ project: { id: string } }>(page, tenantId, "/design-studio/projects", "POST", {
      name: `G4 Preview ${workflowMode} ${suffix}`,
      description: "Exact-SHA protected Preview acceptance"
    }),
    201,
    `${workflowMode} project creation`
  ).project;
  const created = expectStatus(
    await api<{ brief: { id: string }; intentDraft: { intent: unknown } }>(
      page,
      tenantId,
      `/design-studio/projects/${project.id}/briefs`,
      "POST",
      {
        workflowMode,
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
    `${workflowMode} brief creation`
  );
  expectStatus(
    await api(page, tenantId, `/design-studio/briefs/${created.brief.id}/confirm`, "POST", {
      intent: created.intentDraft.intent
    }),
    200,
    `${workflowMode} human confirmation`
  );
  return created.brief.id;
}
async function completeFormulaWorkflow(page: Page, tenantId: string) {
  const briefId = await createConfirmedBrief(page, tenantId, "FORMULA_GENERATION");
  const generated = expectStatus(
    await api<{ candidates: Array<{ generationStrategy: string; lines: unknown[] }> }>(
      page,
      tenantId,
      `/design-studio/briefs/${briefId}/generate`,
      "POST",
      { budget: { mode: "STANDARD" } }
    ),
    200,
    "Formula generation"
  );
  if (!generated.candidates[0]?.lines.length)
    throw new Error("Formula generation returned no lines.");
  const frozen = expectStatus(
    await api<{
      formulaVersion: {
        formulaVersionId: string;
        bundleHash: string;
        candidate: { lines: Array<{ materialSnapshot: Record<string, unknown> }> };
      };
    }>(page, tenantId, `/design-studio/briefs/${briefId}/freeze`, "POST", {
      budget: { mode: "STANDARD" },
      strategy: generated.candidates[0].generationStrategy,
      formulaName: `G4 Preview Formula ${suffix}`
    }),
    201,
    "Formula freeze"
  ).formulaVersion;
  const serialized = JSON.stringify(frozen);
  if (
    !/^[a-f0-9]{64}$/i.test(frozen.bundleHash) ||
    /scientificInternal|canonical_smiles|chemical_entity_id/i.test(serialized)
  )
    throw new Error("Frozen Formula evidence is invalid or leaks internal scientific fields.");
  expectStatus(
    await api(page, tenantId, `/design-studio/formula-versions/${frozen.formulaVersionId}`),
    200,
    "Frozen Formula retrieval"
  );
  expectStatus(
    await api(
      page,
      tenantId,
      `/design-studio/formula-versions/${frozen.formulaVersionId}/trial-context`,
      "POST"
    ),
    200,
    "G5 TrialContext handoff"
  );
}
async function completeAccordWorkflow(page: Page, tenantId: string) {
  const briefId = await createConfirmedBrief(page, tenantId, "ACCORD_ARCHITECTURE");
  const created = expectStatus(
    await api<{ plan: { accords: Array<{ accordKey: string }> } }>(
      page,
      tenantId,
      `/design-studio/briefs/${briefId}/accord-plan`,
      "POST"
    ),
    200,
    "Accord planning"
  );
  if (!created.plan.accords[0]) throw new Error("Accord planner returned no Accord.");
  expectStatus(
    await api(page, tenantId, `/design-studio/briefs/${briefId}/accord-plan`, "PUT", {
      plan: created.plan
    }),
    200,
    "Accord save/reload contract"
  );
  const developed = expectStatus(
    await api<{ candidates: Array<{ generationStrategy: string }> }>(
      page,
      tenantId,
      `/design-studio/briefs/${briefId}/generate`,
      "POST",
      {
        budget: { mode: "STANDARD" },
        accordKey: created.plan.accords[0].accordKey
      }
    ),
    200,
    "Develop This Accord"
  );
  const frozen = expectStatus(
    await api<{ formulaVersion: { formulaVersionId: string } }>(
      page,
      tenantId,
      `/design-studio/briefs/${briefId}/freeze`,
      "POST",
      {
        budget: { mode: "STANDARD" },
        accordKey: created.plan.accords[0].accordKey,
        strategy: developed.candidates[0].generationStrategy,
        formulaName: `G4 Preview Accord ${suffix}`
      }
    ),
    201,
    "Accord Formulation Freeze"
  );
  expectStatus(
    await api(
      page,
      tenantId,
      `/design-studio/formula-versions/${frozen.formulaVersion.formulaVersionId}/trial-context`,
      "POST"
    ),
    200,
    "Accord G5 TrialContext handoff"
  );
  expectStatus(
    await api(page, tenantId, `/design-studio/briefs/${briefId}/generate`, "POST", {
      budget: { mode: "STANDARD" },
      buildCompleteFromAccords: true
    }),
    200,
    "Build Complete Formula from Accords"
  );
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
