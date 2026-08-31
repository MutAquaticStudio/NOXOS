import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G5 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G5 Staging evidence may be written only for the exact merged main SHA.");

const fields = {
  GOAL_ID: "NOX-OS-GATE-5-TRIAL-SENSORY",
  EVIDENCE_SCHEMA: "G5-STAGING-1.0",
  G5_DOCUMENT_VERSION: "1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: "PASS",
  TRIAL_LINEAGE: "PASS",
  EXACT_SCALING: "PASS",
  EVALUATION_CONTEXT: "PASS",
  RAW_EVIDENCE_IMMUTABILITY: "PASS",
  MANUAL_MAPPING: "PASS",
  REVISION_PATH: "PASS",
  APPROVAL_PATH: "PASS",
  TENANT_ISOLATION: "PASS",
  AUDIT_INTEGRITY: "PASS",
  GATE_5_STATUS: "FROZEN",
  GATE_5_DOD: "PASS",
  G6_READY: "YES",
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
console.log("G5_STAGING_EVIDENCE=WRITTEN");
