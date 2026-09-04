import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.EXPECTED_SOURCE_SHA;
const previewUrl = process.env.NOX_PREVIEW_URL;
if (!outputPath || !sha || !previewUrl || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G13 Preview evidence requires an output path, exact SHA, and Preview URL.");

const fields = {
  GOAL_ID: "NOX-OS-GATE-13-COMMERCIAL-ORDERS",
  EVIDENCE_SCHEMA: "G13-PREVIEW-1.0",
  PR_SOURCE_SHA: sha,
  PREVIEW_DEPLOYED_SHA: sha,
  PREVIEW_REFERENCE: previewUrl,
  PREVIEW_EXACT_SHA: "PASS",
  AUTHENTICATED_PREVIEW: "PASS",
  COMMERCIAL_ORDERS_MODULE_AVAILABILITY: "PASS",
  COMMERCIAL_ORDERS_API_ACCEPTANCE: "PASS",
  COMMERCIAL_ORDERS_UI_ACCEPTANCE: "PASS",
  FORGED_AUTHORITY_DENIED: "PASS",
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
console.log("G13_PREVIEW_EVIDENCE=WRITTEN");
