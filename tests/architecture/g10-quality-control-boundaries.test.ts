import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260904044644_g10_qc_batch_release.sql";

describe("G10 Quality Control boundaries", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const store = readFileSync("packages/database/src/quality-control-store.ts", "utf8");

  it("creates exactly five private, tenant-scoped G10 tables", () => {
    expect(migration.match(/create table quality_control\./g)).toHaveLength(5);
    expect(migration).toContain("create table quality_control.batch_specifications");
    expect(migration).toContain("create table quality_control.batch_specification_items");
    expect(migration).toContain("create table quality_control.batch_inspections");
    expect(migration).toContain("create table quality_control.batch_inspection_results");
    expect(migration).toContain("create table quality_control.batch_release_decisions");
    expect(migration).not.toMatch(
      /create table[^;]*(finished_goods|qc_samples|deviations|capa|recalls)/i
    );
  });

  it("revokes browser roles and forces RLS on every table", () => {
    expect(migration).toContain(
      "revoke all on schema quality_control from public, anon, authenticated"
    );
    expect(migration.match(/force row level security/g)).toHaveLength(5);
    expect(migration).toContain("grant usage on schema quality_control to nox_app_runtime");
    expect(migration).not.toMatch(/grant .* to (anon|authenticated)/i);
  });

  it("keeps G9 and G7 read-only and re-resolves current G6 at release", () => {
    expect(store).toContain("for update of batch");
    expect(store).toContain("resolveCurrentForFormulaInTransaction");
    expect(store).not.toMatch(/(insert into|update|delete from) production\./i);
    expect(store).not.toMatch(/(insert into|update|delete from) inventory\./i);
  });

  it("enforces immutable terminal history and serialized successor guards", () => {
    expect(migration).toContain("quality_control_decision_immutable");
    expect(migration).toContain("quality_control_terminal_decision_idx");
    expect(migration).toContain("quality_control_decision_successor_idx");
    expect(migration).toContain("quality_control_current_inspection_successor_idx");
  });
});
