import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactTypeSchema,
  createProjectSchema,
  phaseKeySchema
} from "../../packages/project-operations/src/contracts.js";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260904123249_g12_project_operations.sql"),
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
});
