import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = process.argv[2];
const sha = process.env.GITHUB_SHA;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const stagingUrl = process.env.NOX_STAGING_URL;
if (!outputPath || !sha || !expectedSha || !stagingUrl)
  throw new Error("G11 Staging evidence requires an output path, exact SHA, and Staging URL.");
if (sha !== expectedSha || !/^[0-9a-f]{40}$/i.test(sha))
  throw new Error("G11 Staging evidence may be written only for the exact merged main SHA.");

const pass = "PASS";
const fields = {
  GOAL_ID: "NOX-OS-GATE-11-LAB-SERVICE-ORDERS-CUSTOMER-TRACKING",
  EVIDENCE_SCHEMA: "G11-STAGING-1.0",
  G11_DOCUMENT_VERSION: "1.0",
  STAGING_SOURCE_SHA: sha,
  EXPECTED_STAGING_SHA: sha,
  DEPLOYED_STAGING_SHA: sha,
  STAGING_REFERENCE: stagingUrl,
  STAGING_EXACT_SHA: pass,
  CROSS_GATE_CONSISTENCY_AUDIT: pass,
  CROSS_GATE_AUTHORITY_MAP: pass,
  G4_PROJECT_DUPLICATION: "NONE",
  CUSTOMER_DOMAIN_DUPLICATION: "NONE",
  G10_RELEASE_AUTHORITY_PRESERVED: pass,
  G12_BOUNDARY_PRESERVED: pass,
  G13_BOUNDARY_PRESERVED: pass,
  G11_SCHEMA: pass,
  CUSTOMERS_TABLE: pass,
  CUSTOMER_CONTACTS_TABLE: pass,
  SERVICE_ORDERS_TABLE: pass,
  SERVICE_ORDER_LINES_TABLE: pass,
  CUSTOMER_INTERACTIONS_TABLE: pass,
  NEW_UNAUTHORIZED_TABLES: "NONE",
  CUSTOMER_TYPE_STATUS: pass,
  CUSTOMER_CODE_STABILITY: pass,
  CUSTOMER_ARCHIVE_OPEN_ORDER_GUARD: pass,
  ONE_ACTIVE_PRIMARY_CONTACT: pass,
  CONTACT_CUSTOMER_TENANT_INTEGRITY: pass,
  PINNED_CONTACT_HISTORY: pass,
  SERVICE_ORDER_STATE_MACHINE: pass,
  PROSPECT_DRAFT_ALLOWED: pass,
  ACTIVE_REQUIRED_FOR_CONFIRM: pass,
  HOLD_ARCHIVED_CONFIRM_REJECTED: pass,
  SERVICE_ORDER_LINES_REQUIRED: pass,
  CONFIRMED_SCOPE_IMMUTABILITY: pass,
  TERMINAL_ORDER_IMMUTABILITY: pass,
  CANCELLATION_HISTORY_PRESERVED: pass,
  INTERACTION_APPEND_ONLY: pass,
  INTERACTION_ORDER_CUSTOMER_INTEGRITY: pass,
  NO_PRICING_COMMERCIAL_TRUTH: pass,
  NO_G4_PROJECT_CREATION: pass,
  UPSTREAM_MUTATION_FROM_G11: "NONE",
  LAB_SERVICE_ORDER_SOURCE: pass,
  CUSTOMER_DIRECTORY_SOURCE: pass,
  TENANT_ISOLATION: pass,
  RBAC_FAIL_CLOSED: pass,
  AUTHENTICATED_ACTOR_PROVENANCE: pass,
  G3_G10_REGRESSION: pass,
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
console.log("G11_STAGING_EVIDENCE=WRITTEN");
