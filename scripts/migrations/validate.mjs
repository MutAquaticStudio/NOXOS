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

console.log("MIGRATION_STATIC_VALIDATION=PASS");
