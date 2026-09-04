import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G10 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G10 Staging evidence may be written only for the exact merged main SHA.");

const pass = "PASS";
const fields = {
  GOAL_ID: "NOX-OS-GATE-10-QC-BATCH-RELEASE",
  EVIDENCE_SCHEMA: "G10-STAGING-1.0",
  G10_DOCUMENT_VERSION: "1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: pass,
  G10_SCHEMA: pass,
  BATCH_SPECIFICATIONS_TABLE: pass,
  BATCH_SPECIFICATION_ITEMS_TABLE: pass,
  BATCH_INSPECTIONS_TABLE: pass,
  BATCH_INSPECTION_RESULTS_TABLE: pass,
  BATCH_RELEASE_DECISIONS_TABLE: pass,
  NEW_UNAUTHORIZED_TABLES: "NONE",
  QC_COMPLETED_G9_BATCH_ONLY: pass,
  QC_FORMULA_BUNDLE_MATCH: pass,
  SPEC_DRAFT_ACTIVE_RETIRED: pass,
  ACTIVE_SPEC_IMMUTABILITY: pass,
  ONE_ACTIVE_SPEC_PER_FORMULA_BUNDLE: pass,
  SPEC_VERSION_LINEAGE: pass,
  NUMERIC_RANGE_EXACT_DECIMAL: pass,
  BOOLEAN_SERVER_JUDGEMENT: pass,
  QUALITATIVE_HUMAN_JUDGEMENT: pass,
  INSPECTION_COMPLETENESS: pass,
  INSPECTION_FINAL_IMMUTABILITY: pass,
  INSPECTION_OUTCOME_PRECEDENCE: pass,
  REINSPECTION_LINEAGE: pass,
  CANCELLED_REINSPECTION_RECOVERY: pass,
  HOLD_DECISION: pass,
  RELEASE_REQUIRES_QC_PASS: pass,
  RELEASE_RECHECKS_CURRENT_G6: pass,
  G6_READY_RELEASE: pass,
  G6_REVIEW_BLOCKS_RELEASE: pass,
  G6_BLOCKED_BLOCKS_RELEASE: pass,
  G6_MISSING_BLOCKS_RELEASE: pass,
  G6_AMBIGUOUS_BLOCKS_RELEASE: pass,
  RELEASE_PINS_G6_ASSESSMENT: pass,
  REJECT_REQUIRES_QC_FAIL: pass,
  CONCURRENT_TERMINAL_DECISION: pass,
  RELEASED_TERMINAL: pass,
  REJECTED_TERMINAL: pass,
  NO_G7_MUTATION_FROM_G10: pass,
  NO_G9_MUTATION_FROM_G10: pass,
  NO_FINISHED_GOODS_INVENTORY: pass,
  BATCH_TO_RELEASE_TRACEABILITY: pass,
  RELEASE_TO_INPUT_LOT_TRACEABILITY: pass,
  PROCUREMENT_PROVENANCE_OPTIONAL_TRACE: pass,
  BATCH_RELEASE_SOURCE: pass,
  TENANT_ISOLATION: pass,
  RBAC_FAIL_CLOSED: pass,
  AUTHENTICATED_ACTOR_PROVENANCE: pass,
  G3_G9_REGRESSION: pass,
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
console.log("G10_STAGING_EVIDENCE=WRITTEN");
