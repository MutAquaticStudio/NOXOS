import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationDirectory = resolve("supabase/migrations");
const migrationNames = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql"));
const forbidden =
  /\b(drop\s+(table|schema|database|type|extension|function|view|materialized\s+view)|truncate(?:\s+table)?|alter\s+table[\s\S]{0,300}?\bdrop\s+column)\b/i;

for (const name of migrationNames) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) {
    throw new Error("Invalid migration name: " + name);
  }
  const source = readFileSync(resolve(migrationDirectory, name), "utf8");
  if (forbidden.test(source)) {
    throw new Error("Destructive-first migration is forbidden: " + name);
  }
}

const g4Enhancement = readFileSync(
  resolve(migrationDirectory, "20260831150000_g3_g4_enhancements.sql"),
  "utf8"
);

const forbiddenUnqualifiedG4References = [
  /\balter\s+table\s+(?!material_intelligence\.)material_properties\b/i,
  /\breferences\s+(?!material_intelligence\.)materials\s*\(/i,
  /\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+(?!material_intelligence\.)carrier_solvents\b/i,
  /\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+(?!scientific_runtime\.)scientific_artifacts\b/i
];

if (forbiddenUnqualifiedG4References.some((pattern) => pattern.test(g4Enhancement))) {
  throw new Error("Gate 4 migration contains an unqualified bounded-context table reference");
}

for (const qualifiedName of [
  "material_intelligence.material_properties",
  "material_intelligence.carrier_solvents",
  "material_intelligence.material_formulation_guidance",
  "scientific_runtime.scientific_artifacts"
]) {
  if (!g4Enhancement.includes(qualifiedName)) {
    throw new Error(`Gate 4 migration is missing canonical object: ${qualifiedName}`);
  }
}

for (const duplicateScalar of [
  "vapor_pressure_mmhg",
  "boiling_point_c",
  "flash_point_c",
  "logp_val"
]) {
  if (g4Enhancement.includes(duplicateScalar)) {
    throw new Error(`Gate 4 migration duplicates G3 measurement truth: ${duplicateScalar}`);
  }
}

const designStudioMigration = readFileSync(
  resolve(migrationDirectory, "20260831160000_g4_design_studio.sql"),
  "utf8"
);
const declaredDesignStudioTables = [
  ...designStudioMigration.matchAll(/create\s+table\s+design_studio\.([a-z_]+)/gi)
].map((match) => match[1]);
const canonicalDesignStudioTables = [
  "projects",
  "design_briefs",
  "formulas",
  "formula_versions",
  "formula_lines",
  "formula_frozen_snapshots"
];

if (
  declaredDesignStudioTables.length !== canonicalDesignStudioTables.length ||
  canonicalDesignStudioTables.some((table) => !declaredDesignStudioTables.includes(table))
) {
  throw new Error(
    `Gate 4 must create exactly the six canonical Design Studio tables; found ${declaredDesignStudioTables.join(",")}`
  );
}

for (const requiredBoundary of [
  "enable row level security",
  "force row level security",
  "FROZEN_FORMULA_VERSION_IMMUTABLE",
  "formula_frozen_snapshots"
]) {
  if (!designStudioMigration.includes(requiredBoundary)) {
    throw new Error(`Gate 4 persistence boundary missing: ${requiredBoundary}`);
  }
}

const trialSensoryMigration = readFileSync(
  resolve(migrationDirectory, "20260831190719_g5_trial_sensory.sql"),
  "utf8"
);
const declaredTrialSensoryTables = [
  ...trialSensoryMigration.matchAll(/create\s+table\s+trial_sensory\.([a-z_]+)/gi)
].map((match) => match[1]);
const canonicalTrialSensoryTables = [
  "trials",
  "trial_lines",
  "sensory_evaluations",
  "sensory_deltas"
];

if (
  declaredTrialSensoryTables.length !== canonicalTrialSensoryTables.length ||
  canonicalTrialSensoryTables.some((table) => !declaredTrialSensoryTables.includes(table))
) {
  throw new Error(
    `Gate 5 must create exactly the four canonical Trial and Sensory tables; found ${declaredTrialSensoryTables.join(",")}`
  );
}

for (const forbiddenTable of [
  "sensory_panels",
  "panel_members",
  "material_sensory_scores",
  "trial_sessions",
  "sensory_predictions",
  "revision_jobs",
  "approval_records",
  "formula_copies",
  "trial_formula_versions",
  "material_failures"
]) {
  if (
    new RegExp(`create\\s+table\\s+trial_sensory\\.${forbiddenTable}\\b`, "i").test(
      trialSensoryMigration
    )
  ) {
    throw new Error(`Gate 5 forbidden persistence table: ${forbiddenTable}`);
  }
}

for (const requiredBoundary of [
  "force row level security",
  "FORMULA_VERSION_NOT_FROZEN_OR_LINEAGE_MISMATCH",
  "TRIAL_FORMULA_TOTAL_INVALID",
  "FINAL_EVALUATION_IMMUTABLE",
  "references design_studio.formula_lines"
]) {
  if (!trialSensoryMigration.includes(requiredBoundary)) {
    throw new Error(`Gate 5 persistence boundary missing: ${requiredBoundary}`);
  }
}

const releaseReadinessMigration = readFileSync(
  resolve(migrationDirectory, "20260901121537_g6_release_readiness.sql"),
  "utf8"
);
const declaredReleaseReadinessTables = [
  ...releaseReadinessMigration.matchAll(/create\s+table\s+release_readiness\.([a-z_]+)/gi)
].map((match) => match[1]);
const canonicalReleaseReadinessTables = ["assessments", "checks"];

if (
  declaredReleaseReadinessTables.length !== canonicalReleaseReadinessTables.length ||
  canonicalReleaseReadinessTables.some((table) => !declaredReleaseReadinessTables.includes(table))
) {
  throw new Error(
    `Gate 6 must create exactly assessments and checks; found ${declaredReleaseReadinessTables.join(",")}`
  );
}

for (const requiredBoundary of [
  "source_composition_kind is distinct from 'FULL_FORMULA'",
  "source_approval is distinct from 'APPROVED'",
  "FINAL_RELEASE_ASSESSMENT_IMMUTABLE",
  "RELEASE_ASSESSMENT_CHECK_IMMUTABLE",
  "RELEASE_ASSESSMENT_CHECK_SET_INCOMPLETE",
  "RELEASE_ASSESSMENT_DECISION_MISMATCH",
  "RELEASE_CHECK_MATERIAL_NOT_IN_FORMULA",
  "deferrable initially deferred",
  "force row level security",
  "grant select, insert on release_readiness.assessments"
]) {
  if (!releaseReadinessMigration.includes(requiredBoundary)) {
    throw new Error(`Gate 6 persistence boundary missing: ${requiredBoundary}`);
  }
}

const inventoryMigration = readFileSync(
  resolve(migrationDirectory, "20260901155903_g7_inventory_lot_traceability.sql"),
  "utf8"
);
const declaredInventoryTables = [
  ...inventoryMigration.matchAll(/create\s+table\s+inventory\.([a-z_]+)/gi)
].map((match) => match[1]);
const canonicalInventoryTables = [
  "locations",
  "material_lots",
  "stock_movements",
  "stock_reservations"
];
if (
  declaredInventoryTables.length !== canonicalInventoryTables.length ||
  canonicalInventoryTables.some((table) => !declaredInventoryTables.includes(table))
) {
  throw new Error(
    `Gate 7 must create exactly the four canonical Inventory tables; found ${declaredInventoryTables.join(",")}`
  );
}
for (const forbiddenTruth of ["current_quantity", "on_hand_balance", "stock_balance"]) {
  if (inventoryMigration.includes(forbiddenTruth))
    throw new Error(`Gate 7 migration contains mutable balance truth: ${forbiddenTruth}`);
}
for (const requiredBoundary of [
  "quantity_mg bigint not null check (quantity_mg > 0)",
  "STOCK_MOVEMENT_APPEND_ONLY",
  "RESERVATION_ALREADY_TERMINAL",
  "CONSUMED_MOVEMENT_INVALID",
  "LOT_IDENTITY_IMMUTABLE",
  "force row level security",
  "revoke all on all tables in schema inventory from anon, authenticated"
]) {
  if (!inventoryMigration.includes(requiredBoundary))
    throw new Error(`Gate 7 persistence boundary missing: ${requiredBoundary}`);
}

const labServicesMigration = readFileSync(
  resolve(migrationDirectory, "20260904102903_g11_lab_service_orders_customer_tracking.sql"),
  "utf8"
);
const declaredLabServicesTables = [
  ...labServicesMigration.matchAll(/create\s+table\s+lab_services\.([a-z_]+)/gi)
].map((match) => match[1]);
const canonicalLabServicesTables = [
  "customers",
  "customer_contacts",
  "service_orders",
  "service_order_lines",
  "customer_interactions"
];
if (
  declaredLabServicesTables.length !== canonicalLabServicesTables.length ||
  canonicalLabServicesTables.some((table) => !declaredLabServicesTables.includes(table))
) {
  throw new Error(
    `Gate 11 must create exactly the five canonical Lab Services tables; found ${declaredLabServicesTables.join(",")}`
  );
}
for (const requiredBoundary of [
  "customer_contacts_one_active_primary",
  "LAB_CUSTOMER_HAS_OPEN_ORDERS",
  "LAB_SERVICE_ORDER_LINES_REQUIRED",
  "LAB_SERVICE_ORDER_SCOPE_IMMUTABLE",
  "LAB_INTERACTION_ORDER_MISMATCH",
  "force row level security",
  "revoke all on all tables in schema lab_services from public, anon, authenticated"
]) {
  if (!labServicesMigration.includes(requiredBoundary))
    throw new Error(`Gate 11 persistence boundary missing: ${requiredBoundary}`);
}

console.log("MIGRATION_STATIC_VALIDATION=PASS");
