import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createReservationSchema,
  movementCommandSchema,
  quantityMgSchema
} from "@nox-os/inventory";

const migration = readFileSync(
  "supabase/migrations/20260901155903_g7_inventory_lot_traceability.sql",
  "utf8"
);
const api = readFileSync("packages/inventory/src/api.ts", "utf8");
const trialStore = readFileSync("packages/database/src/trial-sensory-store.ts", "utf8");
const inventoryStore = readFileSync("packages/database/src/inventory-store.ts", "utf8");

describe("Gate 7 inventory security and authority boundary", () => {
  it("creates exactly four private G7 tables without mutable balance truth", () => {
    const tables = [...migration.matchAll(/create table inventory\.([a-z_]+)/g)].map(
      (match) => match[1]
    );
    expect(tables).toEqual(["locations", "material_lots", "stock_movements", "stock_reservations"]);
    expect(migration).not.toMatch(/create table inventory\.(?:stock_)?balances?/i);
    expect(migration).not.toMatch(/current_quantity|on_hand_balance|stock_balance/i);
    expect(migration).toContain("revoke all on schema inventory from public");
    expect(migration).toContain("force row level security");
    expect(migration).toContain(
      "revoke all on all tables in schema inventory from anon, authenticated"
    );
  });

  it("enforces ledger, tenant-safe references, provenance, and terminal state at the database", () => {
    expect(migration).toContain("stock_movements_append_only");
    expect(migration).toContain("STOCK_MOVEMENT_APPEND_ONLY");
    expect(migration).toContain("foreign key (tenant_id, lot_id, material_id)");
    expect(migration).toContain("unique (tenant_id, operation_key)");
    expect(migration).toContain("RESERVATION_ALREADY_TERMINAL");
    expect(migration).toContain("CONSUMED_MOVEMENT_INVALID");
    expect(migration).toContain("LOT_IDENTITY_IMMUTABLE");
    expect(migration).toContain("LOCATION_NOT_EMPTY");
    expect(migration).toContain("LOT_NOT_EMPTY");
  });

  it("rejects forged provenance fields at every generic browser schema", () => {
    expect(
      movementCommandSchema.safeParse({
        movementType: "CONSUMPTION",
        quantityMg: "100",
        fromLocationId: crypto.randomUUID(),
        operationKey: "forged",
        sourceModule: "TRIAL"
      }).success
    ).toBe(false);
    expect(
      createReservationSchema.safeParse({
        locationId: crypto.randomUUID(),
        quantityMg: "100",
        operationKey: "forged",
        sourceModule: "PRODUCTION"
      }).success
    ).toBe(false);
    expect(api).not.toContain("sourceModule: request.body");
    expect(api).not.toContain('sourceModule: "TRIAL"');
    expect(api).not.toContain('sourceModule: "PROCUREMENT"');
    expect(api).not.toContain('sourceModule: "PRODUCTION"');
  });

  it("keeps canonical quantities as positive integer milligram strings", () => {
    expect(quantityMgSchema.safeParse("1").success).toBe(true);
    expect(quantityMgSchema.safeParse("1000000000000").success).toBe(true);
    for (const value of ["0", "-1", "1.5", "1e3", 1000]) {
      expect(quantityMgSchema.safeParse(value).success).toBe(false);
    }
    expect(migration).toContain("quantity_mg bigint not null check (quantity_mg > 0)");
  });

  it("binds Trial PREPARED and inventory consumption to the same database transaction", () => {
    expect(trialStore).toContain("consumeTrialReservationsInTransaction(tx");
    expect(trialStore.indexOf("consumeTrialReservationsInTransaction(tx")).toBeLessThan(
      trialStore.indexOf("status = 'PREPARED'")
    );
    expect(trialStore).toContain("cancelDraftTrialReservationsInTransaction(tx");
    expect(inventoryStore).toContain('sourceModule: "TRIAL"');
    expect(inventoryStore).toContain("sourceReferenceId: input.trialId");
    expect(inventoryStore).toContain("trial:${input.trialId}:reservation:${item.id}:consume");
  });
});
