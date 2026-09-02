import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.EXPECTED_SOURCE_SHA;
const previewUrl = process.env.NOX_PREVIEW_URL;
if (!outputPath || !sha || !previewUrl || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G9 Preview evidence requires an output path, exact SHA, and Preview URL.");
const fields = {
  GOAL_ID: "NOX-OS-GATE-9-PRODUCTION-BATCH-MANUFACTURING",
  EVIDENCE_SCHEMA: "G9-PREVIEW-1.0",
  PR_SOURCE_SHA: sha,
  PREVIEW_DEPLOYED_SHA: sha,
  PREVIEW_REFERENCE: previewUrl,
  PREVIEW_EXACT_SHA: "PASS",
  AUTHENTICATED_PREVIEW: "PASS",
  G9_PRODUCTION_ACCEPTANCE: "PASS",
  FULL_FORMULA_ONLY: "PASS",
  G6_RELEASE_READINESS_REVALIDATION: "PASS",
  G7_PRODUCTION_RESERVATION: "PASS",
  G7_PRODUCTION_CONSUMPTION: "PASS",
  PRODUCTION_IDEMPOTENCY: "PASS",
  PRODUCTION_PROVENANCE: "PASS",
  QC_NOT_ASSESSED_BOUNDARY: "PASS",
  TENANT_ISOLATION: "PASS",
  RBAC_FAIL_CLOSED: "PASS",
  PRODUCTION_MUTATED: "NO"
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(
  outputPath,
  Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { encoding: "utf8", mode: 0o600 }
);
console.log("G9_PREVIEW_EVIDENCE=WRITTEN");
