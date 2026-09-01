import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260901180209_g8_procurement_supplier_operations.sql",
  "utf8"
);
const procurementStore = readFileSync("packages/database/src/procurement-store.ts", "utf8");
const inventoryStore = readFileSync("packages/database/src/inventory-store.ts", "utf8");
const api = readFileSync("packages/procurement/src/api.ts", "utf8");

describe("Gate 8 Procurement security and Inventory authority boundary", () => {
  it("creates exactly six private G8 tables and no duplicate stock truth", () => {
    expect(
      [...migration.matchAll(/create table procurement\.([a-z_]+)/g)].map((item) => item[1])
    ).toEqual([
      "suppliers",
      "supplier_material_offers",
      "purchase_orders",
      "purchase_order_lines",
      "goods_receipts",
      "goods_receipt_lines"
    ]);
    expect(migration).not.toMatch(/create table procurement\.(?:stock|inventory|balance)/i);
    expect(migration).not.toMatch(/purchase_order_lines[\s\S]{0,500}received_quantity_mg/i);
    expect(migration).toContain("force row level security");
    expect(migration).toContain(
      "revoke all on all tables in schema procurement from anon, authenticated"
    );
  });

  it("binds G8 POST and the canonical G7 receipt operation to one transaction", () => {
    expect(procurementStore).toContain("this.sql.begin(async (tx)");
    expect(procurementStore).toContain("receiveProcurementLotInTransaction(tx");
    expect(procurementStore).toContain("for update");
    expect(procurementStore).toContain('"OVER_RECEIPT_NOT_ALLOWED"');
    expect(procurementStore).toContain("procurement:receipt-line:${line.id}");
    expect(inventoryStore).toContain("export async function receiveProcurementLotInTransaction");
    expect(inventoryStore).toContain('sourceModule: "PROCUREMENT"');
    expect(inventoryStore).toContain("sourceReferenceId: input.procurementReceiptId");
  });

  it("keeps Procurement provenance and Inventory references server authoritative", () => {
    expect(api).not.toContain("sourceModule: request.body");
    expect(api).not.toContain("inventoryLotId: request.body");
    expect(api).not.toContain("inventoryMovementId: request.body");
    expect(migration).toContain("POSTED_RECEIPT_IMMUTABLE");
    expect(migration).toContain("APPROVED_PO_COMMERCIAL_IMMUTABLE");
    expect(migration).toContain("SUPPLIER_HISTORY_IMMUTABLE");
    expect(migration).toContain("unique (tenant_id, inventory_movement_id)");
  });

  it("enforces tenant-safe references and allows pending Material procurement", () => {
    expect(migration).toContain("foreign key (tenant_id, supplier_id)");
    expect(migration).toContain("foreign key (tenant_id, purchase_order_id)");
    expect(migration).toContain("foreign key (tenant_id, destination_location_id)");
    expect(migration).toContain("material.scope = 'PLATFORM'");
    expect(migration).not.toMatch(
      /approval_status\s*=\s*'APPROVED'[\s\S]{0,200}assert_material_access/
    );
  });
});
