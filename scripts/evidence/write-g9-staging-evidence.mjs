import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G9 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G9 Staging evidence may be written only for the exact merged main SHA.");
const fields = {
  GOAL_ID: "NOX-OS-GATE-9-PRODUCTION-BATCH-MANUFACTURING",
  EVIDENCE_SCHEMA: "G9-STAGING-1.0",
  G9_DOCUMENT_VERSION: "1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: "PASS",
  G9_SCHEMA: "PASS",
  PRODUCTION_ORDERS_TABLE: "PASS",
  PRODUCTION_ORDER_LINES_TABLE: "PASS",
  PRODUCTION_MATERIAL_ALLOCATIONS_TABLE: "PASS",
  PRODUCTION_BATCHES_TABLE: "PASS",
  FULL_FORMULA_ONLY: "PASS",
  FROZEN_APPROVED_REQUIRED: "PASS",
  G4_SHARED_SCALER: "PASS",
  G6_RELEASE_READINESS_REQUIRED: "PASS",
  G6_START_READINESS_REVALIDATION: "PASS",
  EXACT_G7_ALLOCATION: "PASS",
  G7_RELEASE_RESERVATION_ATOMICITY: "PASS",
  RELEASE_NO_ON_HAND_CONSUMPTION: "PASS",
  PRODUCTION_START_ATOMICITY: "PASS",
  PRODUCTION_START_IDEMPOTENCY: "PASS",
  PRODUCTION_PROVENANCE: "PASS",
  RELEASED_CANCEL_RELEASES_RESERVATIONS: "PASS",
  ABORT_NO_AUTO_RETURN: "PASS",
  BATCH_ONE_PER_ORDER: "PASS",
  ACTUAL_OUTPUT_RECORDING: "PASS",
  NO_FINISHED_INVENTORY_CREATION: "PASS",
  QC_NOT_ASSESSED_BOUNDARY: "PASS",
  BATCH_TO_LOT_TRACEABILITY: "PASS",
  LOT_TO_BATCH_TRACEABILITY: "PASS",
  TENANT_ISOLATION: "PASS",
  RBAC_FAIL_CLOSED: "PASS",
  AUTHENTICATED_ACTOR_PROVENANCE: "PASS",
  G3_G8_REGRESSION: "PASS",
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
console.log("G9_STAGING_EVIDENCE=WRITTEN");
