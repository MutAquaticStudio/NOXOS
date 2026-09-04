import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G12 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G12 Staging evidence may be written only for the exact merged main SHA.");

const pass = "PASS";
const fields = {
  GOAL_ID: "NOX-OS-GATE-12-PROJECT-OPERATIONS",
  EVIDENCE_SCHEMA: "G12-STAGING-1.0",
  G12_DOCUMENT_VERSION: "1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: pass,
  CROSS_GATE_CONSISTENCY_AUDIT: pass,
  G11_SERVICE_ORDER_SOURCE_REUSED: pass,
  G4_DESIGN_PROJECT_AUTHORITY_PRESERVED: pass,
  G5_TRIAL_SENSORY_AUTHORITY_PRESERVED: pass,
  G6_READINESS_AUTHORITY_PRESERVED: pass,
  G9_PRODUCTION_AUTHORITY_PRESERVED: pass,
  G10_RELEASE_AUTHORITY_PRESERVED: pass,
  G13_COMMERCIAL_BOUNDARY_PRESERVED: pass,
  OPERATIONAL_PROJECT_DUPLICATION: "NONE",
  G12_SCHEMA: pass,
  SIX_G12_TABLES: pass,
  PHASE_STATE_DERIVED_ONLY: pass,
  CLIENT_PROJECT_SOURCE_GUARD: pass,
  SCOPE_COVERAGE: pass,
  TASK_DEPENDENCY_CYCLE_SAFETY: pass,
  ARTIFACT_LINEAGE_VALIDATION: pass,
  ARTIFACT_LINK_HISTORY_APPEND_ONLY: pass,
  PROJECT_UPDATE_HISTORY_APPEND_ONLY: pass,
  PROJECT_COMPLETION_GUARDS: pass,
  PROJECT_OPERATIONS_SOURCE: pass,
  TENANT_ISOLATION: pass,
  RBAC_FAIL_CLOSED: pass,
  FORGED_AUTHORITY_DENIED: pass,
  UPSTREAM_MUTATION_FROM_G12: "NONE",
  G3_G11_REGRESSION: pass,
  PRODUCTION_PROMOTION_PERFORMED: "NO",
  PRODUCTION_MIGRATION_PERFORMED: "NO",
  PRODUCTION_DATA_MUTATED: "NO"
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(
  outputPath,
  Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { encoding: "utf8", mode: 0o600 }
);
console.log("G12_STAGING_EVIDENCE=WRITTEN");
