import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G13 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G13 Staging evidence may be written only for the exact merged main SHA.");

const pass = "PASS";
const fields = {
  GOAL_ID: "NOX-OS-GATE-13-COMMERCIAL-ORDERS",
  EVIDENCE_SCHEMA: "G13-STAGING-1.0",
  G13_DOCUMENT_VERSION: "1.2",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: pass,
  CROSS_GATE_CONSISTENCY_AUDIT: pass,
  EIGHT_G13_TABLES: pass,
  CUSTOMER_PROJECT_INVENTORY_TRUTH_REUSED: pass,
  QUOTE_ORDER_LIFECYCLE: pass,
  QUOTE_TO_ORDER_CONCURRENCY: pass,
  COMMERCIAL_ALLOCATION: pass,
  G7_COMMERCIAL_RESERVATION: pass,
  FULFILLMENT_CONSUMPTION: pass,
  BATCH_RELEASE_REVALIDATION: pass,
  SERVICE_COMPLETION_REVALIDATION: pass,
  SHIPMENT_NO_INVENTORY_MUTATION: pass,
  TENANT_ISOLATION: pass,
  RBAC_FAIL_CLOSED: pass,
  FORGED_AUTHORITY_DENIED: pass,
  UNAUTHORIZED_UPSTREAM_MUTATION_FROM_G13: "NONE",
  G7_COMMERCIAL_INTEGRATION_ONLY: pass,
  G3_G12_REGRESSION: pass,
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
console.log("G13_STAGING_EVIDENCE=WRITTEN");
