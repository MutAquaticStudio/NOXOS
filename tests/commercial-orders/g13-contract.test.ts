import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commercialLineSchema, createOrderSchema } from "@nox-os/commercial-orders";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260905090000_g13_commercial_orders.sql"),
  "utf8"
);
const parentImmutabilityFix = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260905093000_g13_fix_parent_immutability.sql"),
  "utf8"
);

describe("G13 Commercial Orders contract", () => {
  it("creates exactly the eight authorized commercial tables and no finance truth", () => {
    expect([...migration.matchAll(/create table commercial\./g)].length).toBe(8);
    for (const table of [
      "quotes",
      "quote_lines",
      "orders",
      "order_lines",
      "order_allocations",
      "fulfillments",
      "fulfillment_lines",
      "shipments"
    ])
      expect(migration).toContain(`create table commercial.${table}`);
    expect(migration).not.toMatch(
      /create table commercial\.(?:invoices|payments|ledger|tax|finished_goods)/i
    );
  });

  it("keeps Commercial provenance a narrow G7 extension", () => {
    expect(migration).toContain("'COMMERCIAL'");
    expect(migration).not.toMatch(/create table inventory\./i);
    expect(migration).toContain("stock_movements_source_reference_check");
    expect(migration).toContain("stock_reservations_source_reference_check");
  });

  it("retains required historic transition timestamps after terminal transitions", () => {
    expect(migration).toContain("status not in ('ISSUED','ACCEPTED','DECLINED')");
    expect(migration).toContain("status not in ('CONFIRMED','CLOSED')");
    expect(migration).toContain("status not in ('SHIPPED','DELIVERED')");
    expect(migration).not.toContain("(status = 'ISSUED') = (issued_at is not null)");
    expect(migration).not.toContain("(status = 'SHIPPED') = (shipped_at is not null)");
  });

  it("enforces lifecycle and Draft-line mutability in PostgreSQL", () => {
    for (const guard of [
      "commercial_quote_lifecycle",
      "commercial_order_lifecycle",
      "commercial_fulfillment_lifecycle",
      "commercial_allocation_lifecycle",
      "commercial_fulfillment_lines_guard",
      "commercial_shipment_lifecycle"
    ])
      expect(migration).toContain(guard);
    expect(migration).toContain(
      "grant delete on commercial.quote_lines, commercial.order_lines, commercial.fulfillment_lines"
    );
  });

  it("accepts only exact source shapes and integer minor-unit inputs", () => {
    expect(
      commercialLineSchema.safeParse({
        lineOrder: 1,
        lineKind: "MATERIAL",
        titleSnapshot: "Material",
        materialId: "11111111-1111-4111-8111-111111111111",
        quantityValue: "1000",
        unitPriceMinor: "1250",
        priceBasisQuantity: "1000"
      }).success
    ).toBe(true);
    expect(
      commercialLineSchema.safeParse({
        lineOrder: 1,
        lineKind: "MATERIAL",
        titleSnapshot: "Invalid",
        materialId: "11111111-1111-4111-8111-111111111111",
        formulaVersionId: "22222222-2222-4222-8222-222222222222",
        quantityValue: "1.5",
        unitPriceMinor: "1.2",
        priceBasisQuantity: "1"
      }).success
    ).toBe(false);
  });

  it("does not accept browser-supplied tenant, actor or calculated total", () => {
    expect(
      createOrderSchema.safeParse({
        orderNumber: "CO-1",
        customerId: "11111111-1111-4111-8111-111111111111",
        currencyCode: "USD",
        lines: [],
        tenantId: "22222222-2222-4222-8222-222222222222",
        commercialAmountMinor: "999999"
      }).success
    ).toBe(false);
  });

  it("uses the actual G9 completion timestamp when selecting a released batch for acceptance", () => {
    const verifier = readFileSync(
      resolve(process.cwd(), "scripts/verify/staging-g3-material-intelligence.ts"),
      "utf8"
    );
    expect(verifier).toContain("order by batch.completed_at desc, batch.id desc limit 1");
    expect(verifier).not.toContain("order by batch.created_at desc limit 1");
  });

  it("keeps quote-line and order-line trigger fields in separate PL/pgSQL branches", () => {
    expect(parentImmutabilityFix).toContain("elsif tg_table_name = 'order_lines' then");
    expect(parentImmutabilityFix).toContain(
      "elsif tg_table_name = 'order_lines' and new.order_id is distinct from old.order_id"
    );
    expect(parentImmutabilityFix).not.toContain("or (tg_table_name = 'order_lines'");
  });
});
