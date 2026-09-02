import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scaleFormulaMasses, findBelowWeighableResolution } from "@nox-os/design-studio";
import { productionOrderStatusSchema, allocationInputSchema } from "@nox-os/production";

describe("G9 production boundaries", () => {
  it("defines only the six allowed order states and positive allocation masses", () => {
    expect(productionOrderStatusSchema.options).toEqual([
      "DRAFT",
      "RELEASED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
      "ABORTED"
    ]);
    expect(
      allocationInputSchema.safeParse({
        productionOrderLineId: "bad",
        lotId: "bad",
        locationId: "bad",
        allocatedMassMg: "0"
      }).success
    ).toBe(false);
  });
  it("uses the shared G4 scaler and rejects below-weighable requirements", () => {
    const lines = scaleFormulaMasses(
      [
        { materialId: "00000000-0000-0000-0000-000000000001", normalizedMassMg: "500000" },
        { materialId: "00000000-0000-0000-0000-000000000002", normalizedMassMg: "500000" }
      ],
      "1"
    );
    expect(findBelowWeighableResolution(lines)).toHaveLength(1);
  });
  it("keeps G9 persistence free of QC and finished-goods authority", () => {
    const migration = readFileSync(
      "supabase/migrations/20260902140000_g9_production_batch_manufacturing.sql",
      "utf8"
    );
    expect(migration.match(/create table if not exists production\./g)).toHaveLength(4);
    expect(migration).not.toMatch(/create table[^;]*(qc|finished|audit|event)/i);
    expect(readFileSync("packages/database/src/inventory-store.ts", "utf8")).toContain(
      'sourceModule: "PRODUCTION"'
    );
  });
});
