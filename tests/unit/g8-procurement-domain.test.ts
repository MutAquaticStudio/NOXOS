import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  createGoodsReceiptSchema,
  createPurchaseOrderSchema,
  createSupplierOfferSchema,
  multiplyPricePerKgByMassMg,
  nonNegativeDecimalSchema
} from "@nox-os/procurement";

const supplierId = "10000000-0000-4000-8000-000000000001";
const materialId = "10000000-0000-4000-8000-000000000002";
const lineId = "10000000-0000-4000-8000-000000000003";
const locationId = "10000000-0000-4000-8000-000000000004";

describe("Gate 8 exact quantity and commercial contracts", () => {
  it("uses positive integer mg and deterministic exact decimal money", () => {
    expect(canonicalDecimal("12.3400")).toBe("12.34");
    expect(multiplyPricePerKgByMassMg("12.34", "25000000")).toBe("308.5");
    expect(multiplyPricePerKgByMassMg("0.000001", "1")).toBe("0.000000000001");
    for (const value of ["-1", "1e3", "01", "NaN", 1])
      expect(nonNegativeDecimalSchema.safeParse(value).success).toBe(false);
  });

  it("allows a zero-priced SAMPLE and PENDING_REVIEW offer identity", () => {
    expect(
      createSupplierOfferSchema.safeParse({
        supplierId,
        materialId,
        supplierSku: "SAMPLE-1",
        supplierMaterialName: "Pending evaluation sample",
        packSizeMg: "1000",
        minimumOrderQuantityMg: "1000",
        unitPricePerKg: "0",
        currencyCode: "USD",
        leadTimeDays: 0,
        lastQuotedAt: null,
        sourceReference: null
      }).success
    ).toBe(true);
    expect(
      createPurchaseOrderSchema.safeParse({
        poNumber: "PO-SAMPLE-1",
        supplierId,
        orderType: "SAMPLE",
        currencyCode: "USD",
        supplierQuoteReference: null,
        expectedDeliveryAt: null,
        incoterm: null,
        freightAmount: "0",
        notes: null,
        lines: [
          {
            materialId,
            supplierOfferId: null,
            supplierSkuSnapshot: "SAMPLE-1",
            supplierMaterialNameSnapshot: "Pending evaluation sample",
            orderedQuantityMg: "1000",
            unitPricePerKg: "0",
            expectedDeliveryAt: null,
            notes: null
          }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects browser-forged inventory authority on a draft Receipt", () => {
    const base = {
      receiptNumber: "GR-1",
      purchaseOrderId: supplierId,
      supplierDeliveryReference: null,
      receivedAt: new Date().toISOString(),
      lines: [
        {
          purchaseOrderLineId: lineId,
          materialId,
          receivedQuantityMg: "1000",
          lotCode: "LOT-1",
          supplierLotCode: null,
          manufacturedAt: null,
          expiresAt: null,
          retestAt: null,
          destinationLocationId: locationId
        }
      ]
    };
    expect(createGoodsReceiptSchema.safeParse(base).success).toBe(true);
    expect(
      createGoodsReceiptSchema.safeParse({
        ...base,
        lines: [
          {
            ...base.lines[0],
            inventoryLotId: crypto.randomUUID(),
            inventoryMovementId: crypto.randomUUID(),
            sourceModule: "PROCUREMENT"
          }
        ]
      }).success
    ).toBe(false);
  });
});
