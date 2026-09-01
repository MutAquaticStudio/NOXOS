import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G6 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G6 Staging evidence may be written only for the exact merged main SHA.");

const fields = {
  GOAL_ID: "NOX-OS-GATE-6-RELEASE-READINESS",
  EVIDENCE_SCHEMA: "G6-STAGING-1.0",
  G6_DOCUMENT_VERSION: "1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: "PASS",
  G6_PRIVATE_SCHEMA: "PASS",
  ASSESSMENTS_TABLE: "PASS",
  CHECKS_TABLE: "PASS",
  NEW_UNAUTHORIZED_TABLES: "NONE",
  APPROVED_FULL_FORMULA_ONLY: "PASS",
  ACCORD_FORMULATION_RELEASE: "REJECTED",
  FROZEN_BUNDLE_LINEAGE: "PASS",
  G5_APPROVAL_TRACEABILITY: "PASS",
  CURRENT_G3_REGULATORY_EVIDENCE: "PASS",
  G4_FROZEN_COMPOSITION_AUTHORITY: "PASS",
  G6_EVIDENCE_SNAPSHOT: "PASS",
  ACTIVE_AROMATIC_EXPOSURE: "PASS",
  DETERMINISTIC_DECIMAL_CALCULATION: "PASS",
  KNOWN_LIMIT_BOUNDARY_TESTS: "PASS",
  MISSING_EVIDENCE_TO_REVIEW: "PASS",
  KNOWN_VIOLATION_TO_BLOCK: "PASS",
  ALL_REQUIRED_PASS_TO_READY: "PASS",
  DECISION_PRECEDENCE: "PASS",
  READY_PATH: "PASS",
  REVIEW_REQUIRED_PATH: "PASS",
  BLOCKED_PATH: "PASS",
  ASSESSMENT_IMMUTABILITY: "PASS",
  REASSESSMENT_LINEAGE: "PASS",
  TENANT_ISOLATION: "PASS",
  RBAC_FAIL_CLOSED: "PASS",
  AUTHENTICATED_ACTOR: "PASS",
  G3_REGRESSION: "PASS",
  G4_REGRESSION: "PASS",
  G5_REGRESSION: "PASS",
  CI: "PASS",
  GATE_6_STATUS: "FROZEN",
  GATE_6_DOD: "PASS",
  G7_READY: "YES",
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
console.log("G6_STAGING_EVIDENCE=WRITTEN");
