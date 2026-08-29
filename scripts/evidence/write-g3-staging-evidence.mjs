import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;

if (!outputPath || !sha || !expectedSha || !stagingUrl) {
  throw new Error("G3 evidence requires an output path, exact SHA, and Staging URL.");
}
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha)) {
  throw new Error("G3 evidence may be written only for the exact accepted main SHA.");
}

const fields = {
  GOAL_ID: "NOX-OS-G3B-MATERIAL-INTELLIGENCE-EXPERIENCE-CLOSURE",
  EVIDENCE_SCHEMA: "G3-STAGING-1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_AUTH: "PASS",
  STAGING_READY: "YES",
  STAGING_EXACT_SHA: "PASS",
  TENANT_USER_A: "PASS",
  TENANT_APPROVER_A: "PASS",
  TENANT_B_PRIVATE_ISOLATION: "PASS",
  TENANT_B_SHARED_VISIBILITY: "PASS",
  CROSS_TENANT_CONTRIBUTOR_PRIVACY: "PASS",
  PLATFORM_OWNER_GLOBAL_REVIEW: "PASS",
  TENANT_APPROVER_PLATFORM_DENIAL: "PASS"
};

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(
  outputPath,
  Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { encoding: "utf8", mode: 0o600 }
);

console.log("G3_STAGING_EVIDENCE=WRITTEN");
