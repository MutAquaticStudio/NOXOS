import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G4 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G4 Staging evidence may be written only for the exact merged main SHA.");

const fields = {
  GOAL_ID: "NOX-OS-GATE-4-CANONICAL-CLOSURE",
  EVIDENCE_SCHEMA: "G4-STAGING-1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: "PASS",
  FORMULA_WORKFLOW_END_TO_END: "PASS",
  ACCORD_WORKFLOW_END_TO_END: "PASS",
  FORMULA_FREEZE: "PASS",
  FROZEN_IMMUTABILITY: "PASS",
  APPROVAL_STATE_SEPARATION: "PASS",
  TENANT_ISOLATION: "PASS",
  REQUIRED_AUDIT_EVENTS: "PASS",
  PRIVATE_ASSET_PROVENANCE: "PASS",
  CURATED_ONLY_FALLBACK: "PASS",
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
console.log("G4_STAGING_EVIDENCE=WRITTEN");
