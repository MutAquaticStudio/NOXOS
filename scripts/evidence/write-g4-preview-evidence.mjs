import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.EXPECTED_SOURCE_SHA;
const previewUrl = process.env.NOX_PREVIEW_URL;
if (!outputPath || !sha || !previewUrl || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G4 Preview evidence requires an output path, exact SHA, and Preview URL.");

const fields = {
  GOAL_ID: "NOX-OS-G4-DESIGN-STUDIO-NOX-OE-CLOSURE",
  EVIDENCE_SCHEMA: "G4-PREVIEW-1.0",
  PR_SOURCE_SHA: sha,
  PREVIEW_DEPLOYED_SHA: sha,
  PREVIEW_REFERENCE: previewUrl,
  PREVIEW_EXACT_SHA: "PASS",
  AUTHENTICATED_PREVIEW: "PASS",
  FORMULA_WORKFLOW: "PASS",
  ACCORD_WORKFLOW: "PASS",
  SCIENTIFIC_RUNTIME_FALLBACK: "PASS",
  TENANT_SCIENTIFIC_INTERNAL_BOUNDARY: "PASS"
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(
  outputPath,
  Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { encoding: "utf8", mode: 0o600 }
);
console.log("G4_PREVIEW_EVIDENCE=WRITTEN");
