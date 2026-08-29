import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const previewUrl = required("NOX_PREVIEW_URL");
const expectedSha = required("EXPECTED_SOURCE_SHA");
const email = required("NOX_PREVIEW_MATERIAL_USER_EMAIL");
const password = required("NOX_PREVIEW_MATERIAL_USER_PASSWORD");
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const captureDirectory = process.env.G3_VISUAL_CAPTURE_DIR;

if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
  throw new Error("Authenticated G3 Preview acceptance requires a full immutable source SHA.");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: bypassHeaders()
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  await verifyDeploymentIdentity(page);
  await signIn(page);
  await capture(page, "materials-registry-desktop", "/materials");

  const materialId = await resolveAccessibleMaterialId(page);
  await page.goto(url(`/materials/${materialId}`), { waitUntil: "networkidle" });
  await requireVisible(page, "material detail heading", page.locator("h1"));
  await assertTenantMaterialBoundary(page, materialId);
  await capture(page, "material-detail-desktop", `/materials/${materialId}`);

  await page.goto(url("/materials/new"), { waitUntil: "networkidle" });
  await requireVisible(
    page,
    "create Material form",
    page.getByRole("heading", { name: "Add Material" })
  );
  await capture(page, "material-create-desktop", "/materials/new");

  await page.goto(url("/materials/review"), { waitUntil: "networkidle" });
  await requireVisible(
    page,
    "tenant review permission state",
    page.getByText(/Material review|not granted|Permission denied/i)
  );
  await page.goto(url("/platform/material-intelligence/review"), { waitUntil: "networkidle" });
  await requireVisible(
    page,
    "platform review permission state",
    page.getByText(/Global Material review|not granted|Permission denied/i)
  );

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: bypassHeaders()
  });
  try {
    await mobile.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await mobile.goto(url(`/materials/${materialId}`), { waitUntil: "networkidle" });
    await requireVisible(mobile, "mobile Material detail", mobile.locator("h1"));
    if (await mobile.locator(".nox-inspector").isVisible()) {
      throw new Error("Material Detail must collapse the global Inspector on a narrow viewport.");
    }
    await capture(mobile, "material-detail-mobile", `/materials/${materialId}`);
    await mobile.goto(url("/materials/new"), { waitUntil: "networkidle" });
    await requireVisible(
      mobile,
      "mobile create Material form",
      mobile.getByRole("heading", { name: "Add Material" })
    );
    await capture(mobile, "material-create-mobile", "/materials/new");
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}

console.log("G3_AUTHENTICATED_PREVIEW_ACCEPTANCE=PASS");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for authenticated G3 Preview acceptance.`);
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

async function requireVisible(
  page: Page,
  description: string,
  locator: ReturnType<Page["locator"]>
) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new Error(`Authenticated Preview is missing ${description}.`);
  }
}

async function verifyDeploymentIdentity(page: Page): Promise<void> {
  const health = await page.request.get(url("/api/v1/health"), { headers: bypassHeaders() });
  const version = await page.request.get(url("/api/v1/version"), { headers: bypassHeaders() });
  if (!health.ok() || !version.ok()) {
    throw new Error("Authenticated Preview health/version endpoints did not respond successfully.");
  }
  const healthBody = (await health.json()) as { environment?: string; sourceSha?: string };
  const versionBody = (await version.json()) as { environment?: string; sourceSha?: string };
  if (
    healthBody.environment !== "preview" ||
    versionBody.environment !== "preview" ||
    healthBody.sourceSha !== expectedSha ||
    versionBody.sourceSha !== expectedSha
  ) {
    throw new Error("Preview identity did not attest the exact G3 source SHA.");
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(url("/sign-in"), { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await requireVisible(
    page,
    "authenticated NØX shell",
    page.getByRole("button", { name: "User menu" })
  );
}

async function resolveAccessibleMaterialId(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const storageEntry = Object.entries(localStorage).find(([, value]) =>
      value.includes("access_token")
    );
    if (!storageEntry) return { error: "BROWSER_SESSION_NOT_FOUND" };
    const session = JSON.parse(storageEntry[1]) as { access_token?: string };
    if (!session.access_token) return { error: "BROWSER_ACCESS_TOKEN_NOT_FOUND" };
    const response = await fetch("/api/v1/materials?limit=1", {
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    const body = (await response.json().catch(() => undefined)) as
      { materials?: Array<{ id?: string }> } | undefined;
    return { status: response.status, materialId: body?.materials?.[0]?.id };
  });
  if (result.status !== 200 || !result.materialId) {
    throw new Error(
      "Authenticated Preview requires one accessible, non-production Material fixture for route acceptance."
    );
  }
  return result.materialId;
}

async function assertTenantMaterialBoundary(page: Page, materialId: string): Promise<void> {
  const result = await page.evaluate(async (id) => {
    const storageEntry = Object.entries(localStorage).find(([, value]) =>
      value.includes("access_token")
    );
    const session = storageEntry
      ? (JSON.parse(storageEntry[1]) as { access_token?: string })
      : undefined;
    const response = await fetch(`/api/v1/materials/${id}`, {
      headers: session?.access_token
        ? { authorization: `Bearer ${session.access_token}` }
        : undefined
    });
    return await response.json();
  }, materialId);
  const serialized = JSON.stringify(result);
  if (
    /chemical_entity_id|canonical_smiles|isomeric_smiles|inchikey|molecular_formula|molecular_weight|embedding/i.test(
      serialized
    )
  ) {
    throw new Error("Tenant Preview Material DTO leaked internal ChemicalEntity data.");
  }
}

async function capture(page: Page, name: string, route: string): Promise<void> {
  if (!captureDirectory) return;
  await mkdir(captureDirectory, { recursive: true });
  const path = resolve(captureDirectory, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await writeFile(
    resolve(captureDirectory, `${name}.json`),
    JSON.stringify(
      {
        route,
        viewport: page.viewportSize(),
        sha: expectedSha,
        environment: "preview",
        capturedAt: new Date().toISOString()
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}
