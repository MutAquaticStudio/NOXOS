import { requiredServerValue } from "@nox-os/config";
import { createRuntimeDatabase, probeDatabase, readWorkflowProbeRecord } from "@nox-os/database";
import { createOpaqueId } from "@nox-os/shared";
import { SupabasePrivateFileStore } from "@nox-os/storage";
import { verifyEnvironmentIsolation } from "./environment-isolation";
import { verifyVercelDeployment } from "./vercel-deployment";

const raw = process.env;
verifyEnvironmentIsolation(raw);
const database = createRuntimeDatabase({
  connectionUrl: requiredServerValue(raw, "NOX_RUNTIME_DATABASE_URL"),
  applicationName: "nox-os-foundation-staging-probe",
  expectedRole: "nox_app_runtime"
});

const databaseProbe = await probeDatabase(database, "nox_app_runtime");
if (!databaseProbe.healthy || databaseProbe.role !== "nox_app_runtime") {
  await database.end({ timeout: 5 });
  throw new Error("Staging runtime database role probe failed.");
}

const supabaseUrl = requiredServerValue(raw, "SUPABASE_URL");
const storageBucket = raw.SUPABASE_STORAGE_BUCKET ?? "nox-os-staging-private";
const storage = new SupabasePrivateFileStore({
  url: supabaseUrl,
  serviceRoleKey: requiredServerValue(raw, "SUPABASE_SERVICE_ROLE_KEY"),
  bucket: storageBucket
});
const authorization = {
  actor: { type: "SYSTEM" as const },
  tenant: { id: "foundation-staging-probe" },
  allowedPurposes: ["foundation-staging-probe"]
};
let uploaded: Awaited<ReturnType<typeof storage.put>> | undefined;
let deleted = false;

try {
  uploaded = await storage.put(
    {
      scope: "TENANT",
      tenantId: authorization.tenant.id,
      checksum: "foundation-staging-probe",
      mimeType: "text/plain",
      purpose: "foundation-staging-probe",
      classification: "internal"
    },
    new TextEncoder().encode("NØX-OS staging foundation diagnostic probe."),
    authorization
  );
  await storage.stat(uploaded, authorization);
  const downloadGrant = await storage.createDownloadGrant(uploaded, authorization);
  const authorizedRead = await fetch(downloadGrant);
  if (
    !authorizedRead.ok ||
    (await authorizedRead.text()) !== "NØX-OS staging foundation diagnostic probe."
  ) {
    throw new Error("Staging private storage probe did not create an authorized read grant.");
  }

  const encodedPath = uploaded.storagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const publicRead = await fetch(
    new URL(
      "/storage/v1/object/public/" + encodeURIComponent(storageBucket) + "/" + encodedPath,
      supabaseUrl
    )
  );
  if (publicRead.ok) {
    throw new Error("Private storage object was accessible through an unauthenticated public URL.");
  }

  await storage.delete(uploaded, authorization);
  deleted = true;
  await expectStoredObjectDeleted(storage, uploaded, authorization);
} finally {
  if (uploaded && !deleted) {
    await storage.delete(uploaded, authorization);
  }
}

const deploymentUrl = await verifyVercelDeployment(
  {
    organizationId: requiredServerValue(raw, "VERCEL_ORG_ID"),
    projectId: requiredServerValue(raw, "VERCEL_PROJECT_ID"),
    sourceSha: requiredServerValue(raw, "EXPECTED_SOURCE_SHA"),
    target: "staging",
    token: requiredServerValue(raw, "VERCEL_TOKEN")
  },
  requiredServerValue(raw, "NOX_DEPLOYMENT_URL")
);
const workflowId = createOpaqueId("workflow_probe");
const correlationId = createOpaqueId("corr");
const idempotencyKey = createOpaqueId("idempotency");
const deploymentHeaders = {
  "x-vercel-protection-bypass": requiredServerValue(raw, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  "x-nox-diagnostic-probe-token": requiredServerValue(raw, "NOX_DIAGNOSTIC_PROBE_TOKEN"),
  "x-correlation-id": correlationId,
  "x-nox-diagnostic-workflow-id": workflowId,
  "x-nox-diagnostic-idempotency-key": idempotencyKey
};

for (let attempt = 0; attempt < 2; attempt += 1) {
  const workflowResponse = await fetch(
    new URL("/api/v1/internal/diagnostics/workflow", deploymentUrl),
    { method: "POST", headers: deploymentHeaders }
  );
  const workflowProbe = await workflowResponse.json();
  if (
    workflowResponse.status !== 202 ||
    workflowProbe?.workflowId !== workflowId ||
    workflowProbe?.state !== "QUEUED" ||
    workflowProbe?.correlationId !== correlationId
  ) {
    await database.end({ timeout: 5 });
    throw new Error("Deployed API-to-workflow staging launch probe failed.");
  }
}

const workflowCompletion = await waitForWorkflowCompletion(database, workflowId);
await database.end({ timeout: 5 });
if (
  !workflowCompletion ||
  workflowCompletion.correlationId !== correlationId ||
  workflowCompletion.idempotencyKey !== idempotencyKey ||
  workflowCompletion.deliveryCount < 2
) {
  throw new Error("Durable workflow retry, idempotency, or correlation verification failed.");
}

console.log("STAGING_DATABASE_PROBE=PASS");
console.log("STAGING_DATABASE_CURRENT_USER=nox_app_runtime");
console.log("STAGING_PRIVATE_BUCKET_EXISTS=PASS");
console.log("STAGING_PRIVATE_BUCKET_PUBLIC_FALSE=PASS");
console.log("STAGING_PRIVATE_STORAGE_PROBE=PASS");
console.log("STAGING_WORKFLOW_PROBE=PASS");
console.log("STAGING_WORKFLOW_DATABASE_CURRENT_USER=nox_workflow_runtime");

async function expectStoredObjectDeleted(
  fileStore: SupabasePrivateFileStore,
  reference: NonNullable<typeof uploaded>,
  access: typeof authorization
): Promise<void> {
  try {
    await fileStore.stat(reference, access);
  } catch {
    return;
  }
  throw new Error("Staging private storage probe did not delete its diagnostic object.");
}

async function waitForWorkflowCompletion(sql: typeof database, expectedWorkflowId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const record = await readWorkflowProbeRecord(sql, expectedWorkflowId);
    if (record) {
      return record;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }
  return undefined;
}
