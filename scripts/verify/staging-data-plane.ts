import { requiredServerValue } from "@nox-os/config";
import { createRuntimeDatabase, probeDatabase } from "@nox-os/database";
import { SupabasePrivateFileStore } from "@nox-os/storage";
import { verifyEnvironmentIsolation } from "./environment-isolation";
import { verifyVercelDeployment } from "./vercel-deployment";

const raw = process.env;
verifyEnvironmentIsolation(raw);
const database = createRuntimeDatabase({
  connectionUrl: requiredServerValue(raw, "NOX_RUNTIME_DATABASE_URL"),
  applicationName: "nox-os-g1-staging-probe"
});

try {
  const databaseProbe = await probeDatabase(database);
  if (!databaseProbe.healthy) {
    throw new Error("Staging runtime database probe failed.");
  }
} finally {
  await database.end({ timeout: 5 });
}

const storage = new SupabasePrivateFileStore({
  url: requiredServerValue(raw, "SUPABASE_URL"),
  serviceRoleKey: requiredServerValue(raw, "SUPABASE_SERVICE_ROLE_KEY"),
  bucket: raw.SUPABASE_STORAGE_BUCKET ?? "nox-private"
});
const authorization = {
  actor: { type: "SYSTEM" as const },
  tenant: { id: "g1-staging-probe" },
  allowedPurposes: ["g1-staging-probe"]
};
let uploaded: Awaited<ReturnType<typeof storage.put>> | undefined;

try {
  uploaded = await storage.put(
    {
      scope: "TENANT",
      tenantId: authorization.tenant.id,
      checksum: "g1-staging-probe",
      mimeType: "text/plain",
      purpose: "g1-staging-probe",
      classification: "internal"
    },
    new TextEncoder().encode("NØX-OS Gate 1 staging diagnostic probe."),
    authorization
  );
  await storage.stat(uploaded, authorization);
  const downloadGrant = await storage.createDownloadGrant(uploaded, authorization);
  if (!downloadGrant) {
    throw new Error("Staging private storage probe did not create an authorized read grant.");
  }
} finally {
  if (uploaded) {
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
const workflowResponse = await fetch(new URL("/api/v1/internal/g1/workflow-probe", deploymentUrl), {
  method: "POST",
  headers: {
    "x-nox-diagnostic-probe-token": requiredServerValue(raw, "NOX_DIAGNOSTIC_PROBE_TOKEN")
  }
});
const workflowProbe = await workflowResponse.json();
if (!workflowResponse.ok || !workflowProbe?.workflowId || !workflowProbe?.correlationId) {
  throw new Error("Deployed API-to-workflow staging probe failed.");
}

console.log("STAGING_DATABASE_PROBE=PASS");
console.log("STAGING_PRIVATE_STORAGE_PROBE=PASS");
console.log("STAGING_WORKFLOW_PROBE=PASS");
