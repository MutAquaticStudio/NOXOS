import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

type ApiResult<T = unknown> = { status: number; body: T };

const previewUrl = required("NOX_PREVIEW_URL");
const expectedSha = required("EXPECTED_SOURCE_SHA");
const email = required("NOX_PREVIEW_MATERIAL_USER_EMAIL");
const password = required("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const captureDirectory = process.env.G12_VISUAL_CAPTURE_DIR;
const suffix = randomUUID().slice(0, 8);

if (!/^[0-9a-f]{40}$/i.test(expectedSha))
  throw new Error("G12 Preview acceptance requires a full immutable source SHA.");

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

  const created = expectStatus(
    await api<{ project: { id: string } }>(page, tenantId, "/project-operations/projects", "POST", {
      projectType: "INTERNAL",
      projectCode: `G12-PREVIEW-${suffix}`,
      name: `Preview Operations ${suffix}`,
      description: "Exact-SHA authenticated Preview acceptance.",
      ownerUserId: await actorUserId(page, tenantId),
      priority: "NORMAL"
    }),
    201,
    "G12 internal Project creation"
  ).project;
  expectStatus(
    await api(page, tenantId, `/project-operations/projects/${created.id}/tasks`, "POST", {
      taskKind: "TASK",
      title: "Preview operational task",
      description: null,
      priority: "NORMAL",
      required: true,
      assigneeUserId: null,
      dueDate: null,
      phasePlanId: null,
      sourceServiceOrderLineId: null
    }),
    201,
    "G12 task creation"
  );

  await page.goto(url("/project-operations"), { waitUntil: "networkidle" });
  await selectTenant(page, tenantId);
  await visible(page, page.getByRole("heading", { name: "Project Operations" }));
  await capture(page, "project-operations-registry-desktop", "/project-operations");
  await page.goto(url(`/project-operations/projects/${created.id}`), { waitUntil: "networkidle" });
  await selectTenant(page, tenantId);
  await visible(page, page.getByRole("heading", { name: new RegExp(`G12-PREVIEW-${suffix}`) }));
  await visible(page, page.getByRole("heading", { name: "Tasks & Milestones" }));
  await capture(
    page,
    "project-operations-detail-desktop",
    `/project-operations/projects/${created.id}`
  );

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: bypassHeaders()
  });
  try {
    await mobile.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await signIn(mobile);
    await selectTenant(mobile, tenantId);
    await mobile.goto(url(`/project-operations/projects/${created.id}`), {
      waitUntil: "networkidle"
    });
    await selectTenant(mobile, tenantId);
    await visible(mobile, mobile.getByRole("heading", { name: "Tasks & Milestones" }));
    await capture(
      mobile,
      "project-operations-detail-mobile",
      `/project-operations/projects/${created.id}`
    );
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}

console.log("G12_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");
console.log("G12_PROJECT_OPERATIONS_API_ACCEPTANCE=PASS");
console.log("G12_PROJECT_OPERATIONS_UI_ACCEPTANCE=PASS");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for G12 Preview acceptance.`);
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
      throw new Error(`G12 Preview identity failed for ${path}.`);
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
  if (result.status !== 200 || !tenantId)
    throw new Error("G12 Preview requires one active Tenant.");
  return tenantId;
}
async function selectTenant(page: Page, tenantId: string) {
  const selector = page.getByLabel("Current tenant");
  await visible(page, selector);
  if ((await selector.inputValue()) !== tenantId) await selector.selectOption(tenantId);
}
async function actorUserId(page: Page, tenantId: string): Promise<string> {
  const context = expectStatus(
    await api<{ actor?: { userId?: string } }>(page, tenantId, "/context"),
    200,
    "G12 current actor context"
  );
  if (!context.actor?.userId) throw new Error("G12 Preview context has no actor identity.");
  return context.actor.userId;
}
async function assertAvailability(page: Page, tenantId: string) {
  const context = expectStatus(
    await api<{
      moduleAvailability?: Array<{ moduleId: string; state: string }>;
      authorization?: { modulePermissions?: string[] };
    }>(page, tenantId, "/context"),
    200,
    "G12 context"
  );
  if (
    context.moduleAvailability?.find((item) => item.moduleId === "project-operations")?.state !==
      "AVAILABLE" ||
    !context.authorization?.modulePermissions?.includes("module.project-operations.project.create")
  )
    throw new Error("Project Operations is not available with expected server permissions.");
  const denied = await page.request.get(url("/api/v1/project-operations/projects"), {
    headers: {
      ...(bypassHeaders() ?? {}),
      "x-nox-tenant-id": tenantId,
      "x-role": "TENANT_OWNER",
      "x-permission": "module.project-operations.read"
    }
  });
  if (denied.status() !== 401)
    throw new Error("Forged authority headers affected an unauthenticated G12 request.");
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
