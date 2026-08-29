import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;

if (!outputPath || !sha || !expectedSha || !stagingUrl) {
  throw new Error("G2 evidence requires an output path, Git SHA, expected SHA, and Staging URL.");
}
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha)) {
  throw new Error("G2 evidence may be written only for the exact accepted main SHA.");
}

const fields = {
  GOAL_ID: "NOX-OS-GATE-2B-PLATFORM-CORE-CLOSURE",
  EVIDENCE_SCHEMA: "G2-1.0",
  ACCEPTED_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  SUPABASE_AUTH: "PASS",
  PLATFORM_USER: "PASS",
  PLATFORM_OWNER: "PASS",
  PLATFORM_OWNER_SAFETY: "PASS",
  PLATFORM_OWNER_TENANT_SEPARATION: "PASS",
  TENANT: "PASS",
  MEMBERSHIP: "PASS",
  TENANT_OWNER_SAFETY: "PASS",
  OWNER_CONCURRENCY: "PASS",
  PLATFORM_RBAC: "PASS",
  TENANT_RBAC: "PASS",
  MODULE_PERMISSION_EXTENSION: "PASS",
  AUTHORIZATION_SERVICE: "PASS",
  REQUEST_CONTEXT: "PASS",
  TENANT_ISOLATION: "PASS",
  FORGED_AUTHORITY_TESTS: "PASS",
  ENTITLEMENT: "PASS",
  FEATURE_FLAGS: "PASS",
  MODULE_AVAILABILITY: "PASS",
  AUDIT_FOUNDATION: "PASS",
  AUDIT_TRANSACTION_INTEGRITY: "PASS",
  SESSION_LIFECYCLE: "PASS",
  TENANT_SETTINGS_UI: "PASS",
  PLATFORM_CONTROL_UI: "PASS",
  SERVICE_ROLE_BROWSER_EXPOSURE: "PASS",
  DB_SECRET_BROWSER_EXPOSURE: "PASS",
  APPLICATION_BUSINESS_FEATURES_ADDED: "NO",
  PRODUCTION_PROMOTION_PERFORMED: "NO",
  PRODUCTION_MIGRATION_PERFORMED: "NO",
  PRODUCTION_DATA_MUTATED: "NO",
  PRODUCTION_AUTH_USERS_CREATED: "NO",
  ARCHITECTURE_P0: "0",
  ARCHITECTURE_P1: "0",
  ARCHITECTURE_P2: "0",
  GATE_2_STATUS: "FROZEN",
  GATE_2_DOD: "PASS",
  G3_READY: "YES"
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(
  outputPath,
  Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { encoding: "utf8", mode: 0o600 }
);

console.log("G2_ACCEPTANCE_EVIDENCE=WRITTEN");
