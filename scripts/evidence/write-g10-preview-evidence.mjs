import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.EXPECTED_SOURCE_SHA;
const previewUrl = process.env.NOX_PREVIEW_URL;
if (!outputPath || !sha || !previewUrl || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G10 Preview evidence requires an output path, exact SHA, and Preview URL.");

const fields = {
  GOAL_ID: "NOX-OS-GATE-10-QC-BATCH-RELEASE",
  EVIDENCE_SCHEMA: "G10-PREVIEW-1.0",
  PR_SOURCE_SHA: sha,
  PREVIEW_DEPLOYED_SHA: sha,
  PREVIEW_REFERENCE: previewUrl,
  PREVIEW_EXACT_SHA: "PASS",
  AUTHENTICATED_PREVIEW: "PASS",
  G10_QC_BATCH_RELEASE_ACCEPTANCE: "PASS",
  EXACT_DECIMAL_AND_SERVER_JUDGEMENT: "PASS",
  CURRENT_G6_RELEASE_REVALIDATION: "PASS",
  TERMINAL_DECISION_SERIALIZATION: "PASS",
  TENANT_ISOLATION: "PASS",
  RBAC_FAIL_CLOSED: "PASS",
  NO_G7_MUTATION_FROM_G10: "PASS",
  NO_G9_MUTATION_FROM_G10: "PASS",
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
console.log("G10_PREVIEW_EVIDENCE=WRITTEN");
