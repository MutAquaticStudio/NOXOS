import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactTypeSchema,
  createProjectSchema,
  phaseKeySchema,
  phasePlansSchema
} from "../../packages/project-operations/src/contracts.js";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260904123249_g12_project_operations.sql"),
  "utf8"
);
const application = readFileSync(resolve(root, "apps/nox-os/src/app.tsx"), "utf8");
const shellStyles = readFileSync(resolve(root, "packages/ui/src/styles.css"), "utf8");
const projectOperationsStore = readFileSync(
  resolve(root, "packages/database/src/project-operations-store.ts"),
  "utf8"
);
const taskTriggerRepair = readFileSync(
  resolve(root, "supabase/migrations/20260905004500_g12_task_trigger_scope.sql"),
  "utf8"
);
const stagingAcceptance = readFileSync(
  resolve(root, "scripts/verify/staging-g3-material-intelligence.ts"),
  "utf8"
);

describe("G12 Project Operations contract", () => {
  it("owns exactly six G12 tables and no mutable phase truth", () => {
    expect((migration.match(/create table project_operations\./g) ?? []).length).toBe(6);
    expect(migration).not.toMatch(/project_phase_status|current_phase_status|percent_complete/);
    expect(migration).toContain("projects_one_client_source_unique");
  });
  it("fails closed for malformed project source shape and unknown phase/artifact types", () => {
    expect(
      createProjectSchema.safeParse({
        projectType: "CLIENT_SERVICE",
        projectCode: "OP-1",
        name: "x",
        ownerUserId: "00000000-0000-0000-0000-000000000000"
      }).success
    ).toBe(false);
    expect(phaseKeySchema.safeParse("G13_COMMERCIAL").success).toBe(false);
    expect(artifactTypeSchema.safeParse("BATCH_RELEASE_STATUS").success).toBe(false);
  });
  it("rejects ambiguous phase-plan identity before a DRAFT plan can be replaced", () => {
    expect(
      phasePlansSchema.safeParse({
        phases: [
          { phaseKey: "DESIGN", phaseOrder: 1, required: true },
          { phaseKey: "DESIGN", phaseOrder: 2, required: false }
        ]
      }).success
    ).toBe(false);
    expect(
      phasePlansSchema.safeParse({
        phases: [
          { phaseKey: "DESIGN", phaseOrder: 1, required: true },
          { phaseKey: "TRIAL", phaseOrder: 1, required: false }
        ]
      }).success
    ).toBe(false);
  });
  it("uses database guards for append-only link and update history", () => {
    expect(migration).toContain("project_operations.enforce_artifact_link_history");
    expect(migration).toContain("PROJECT_ARTIFACT_LINK_DELETE_FORBIDDEN");
    expect(migration).toContain("project_operations.enforce_update_history");
    expect(migration).toContain("PROJECT_UPDATE_APPEND_ONLY");
  });
  it("grants only the runtime role the narrowly required DRAFT cleanup capability", () => {
    expect(migration).toContain(
      "grant select, insert, update, delete on all tables in schema project_operations to nox_app_runtime;"
    );
    expect(migration).toContain(
      "revoke all on all tables in schema project_operations from public, anon, authenticated;"
    );
  });
  it("routes the Project Operations workspace through its single route authority", () => {
    expect(application).toContain('path="/project-operations/*"');
    expect(application).toContain('definition.descriptor.id !== "project-operations"');
  });
  it("keeps tenant selection usable on the compact operational workspace", () => {
    expect(shellStyles).toContain(
      ".nox-system-actions > :not(:first-child):not(.nox-tenant-selector)"
    );
  });
  it("refreshes the G12 actor token after G4 signs the fixture out", () => {
    const g4Acceptance = stagingAcceptance.indexOf(
      "await runG4Acceptance(page, tenantA, tenantB);"
    );
    const refreshedToken = stagingAcceptance.indexOf('await refreshToken("B");', g4Acceptance);
    const g12Acceptance = stagingAcceptance.indexOf(
      "await runG12StagingAcceptance(page, tenantA, tenantB);",
      refreshedToken
    );
    expect(g4Acceptance).toBeGreaterThanOrEqual(0);
    expect(refreshedToken).toBeGreaterThan(g4Acceptance);
    expect(g12Acceptance).toBeGreaterThan(refreshedToken);
  });
  it("probes immutable G4 FormulaVersion fields without assuming a mutable timestamp", () => {
    const upstreamAuthorityProbe = stagingAcceptance.slice(
      stagingAcceptance.indexOf("const upstreamBefore"),
      stagingAcceptance.indexOf(
        "const orderAfter",
        stagingAcceptance.indexOf("const upstreamBefore")
      )
    );
    const formulaVersionProjection = "select id,status,bundle_hash,frozen_at,created_at";
    expect(upstreamAuthorityProbe).toContain(formulaVersionProjection);
    expect(upstreamAuthorityProbe.split(formulaVersionProjection)).toHaveLength(3);
    expect(upstreamAuthorityProbe).toContain(
      "from design_studio.formula_versions where tenant_id=${tenantA}"
    );
    expect(upstreamAuthorityProbe).not.toContain(
      "select id,status,updated_at from design_studio.formula_versions"
    );
  });
  it("waits for the semantic Project Operations detail heading in Staging", () => {
    expect(stagingAcceptance).toContain('await expectHeading(page, "Tasks & Milestones");');
    expect(stagingAcceptance).not.toContain('await expectVisible(page, "Operational Project");');
  });
  it("filters typed artifact lookups through an unambiguous derived relation", () => {
    expect(projectOperationsStore).toContain(
      "select * from (${query}) artifact where artifact.tenant_id=$1 and artifact.id=$2"
    );
    expect(projectOperationsStore).not.toContain("${query} where tenant_id=$1 and id=$2");
  });
  it("resolves an artifact link on the transaction that protects the mutation", () => {
    expect(projectOperationsStore).toContain("this.resolveArtifactFrom(tx, {");
    expect(projectOperationsStore).not.toContain("const artifact = await this.resolveArtifact({");
  });
  it("keeps the task trigger's project type resolution unambiguous", () => {
    expect(taskTriggerRepair).toContain("resolved_project_type text;");
    expect(taskTriggerRepair).toContain("select p.status, p.project_type");
    expect(taskTriggerRepair).toContain("resolved_project_type <> 'CLIENT_SERVICE'");
  });
});
