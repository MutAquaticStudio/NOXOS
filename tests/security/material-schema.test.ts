import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260829094218_g3_material_intelligence_core.sql",
  "utf8"
);

describe("G3-A Material schema", () => {
  it("creates exactly the eight canonical private Material Intelligence tables", () => {
    expect([...migration.matchAll(/create table material_intelligence\./g)]).toHaveLength(8);
    for (const name of [
      "materials",
      "chemical_entities",
      "material_identifiers",
      "material_properties",
      "material_odor_assignments",
      "material_concentrates",
      "material_components",
      "material_change_requests"
    ])
      expect(migration).toContain(`create table material_intelligence.${name}`);
    expect(migration).not.toMatch(
      /create table material_intelligence\.(material_versions|material_history|material_snapshots|material_events|material_audit)/
    );
  });
  it("keeps Material Intelligence private, tenant-safe, and audit reuse append-only", () => {
    expect(migration).toMatch(
      /revoke all on schema material_intelligence from anon, authenticated/
    );
    expect(migration).toMatch(/grant usage on schema material_intelligence to nox_app_runtime/);
    expect(migration).not.toMatch(/nox_workflow_runtime[^\n]*material_intelligence/i);
    expect(migration).toMatch(/scope = 'PLATFORM' and tenant_id is null/);
    expect(migration).toMatch(/material_type = 'SINGLE_MOLECULE' or chemical_entity_id is null/);
    expect(migration).toMatch(/concentration_pct > 0 and concentration_pct < 100/);
    expect(migration).toMatch(/check \(material_id <> component_material_id\)/);
    expect(migration).toContain("platform.audit_events");
  });
});
