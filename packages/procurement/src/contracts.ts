import { z } from "zod";
import { quantityMgSchema, type QuantityMg } from "@nox-os/inventory";

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const optionalTimestamp = z.string().datetime({ offset: true }).nullable().optional();
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const nonNegativeDecimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/, "A non-negative exact decimal string is required.");
export const supplierStatusSchema = z.enum(["ACTIVE", "HOLD", "ARCHIVED"]);
export const offerStatusSchema = supplierStatusSchema;
export const purchaseOrderTypeSchema = z.enum(["STANDARD", "SAMPLE"]);
export const purchaseOrderStatusSchema = z.enum([
  "DRAFT",
  "APPROVED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED"
]);
export const goodsReceiptStatusSchema = z.enum(["DRAFT", "POSTED", "CANCELLED"]);

export const createSupplierSchema = z
  .object({
    supplierCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/),
    legalName: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    primaryEmail: optionalText(320),
    primaryPhone: optionalText(80),
    website: optionalText(500),
    taxIdentifier: optionalText(120),
    defaultCurrency: currencyCodeSchema.nullable().optional(),
    defaultIncoterm: optionalText(40),
    notes: optionalText(4000)
  })
  .strict();
export const updateSupplierSchema = createSupplierSchema
  .omit({ supplierCode: true })
  .partial()
  .extend({ status: supplierStatusSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one Supplier field is required.");

export const createSupplierOfferSchema = z
  .object({
    supplierId: uuid,
    materialId: uuid,
    supplierSku: optionalText(120),
    supplierMaterialName: z.string().trim().min(1).max(200),
    packSizeMg: quantityMgSchema.nullable().optional(),
    minimumOrderQuantityMg: quantityMgSchema.nullable().optional(),
    unitPricePerKg: nonNegativeDecimalSchema.nullable().optional(),
    currencyCode: currencyCodeSchema.nullable().optional(),
    leadTimeDays: z.number().int().nonnegative().nullable().optional(),
    lastQuotedAt: optionalTimestamp,
    sourceReference: optionalText(1000)
  })
  .strict();
export const updateSupplierOfferSchema = createSupplierOfferSchema
  .omit({ supplierId: true, materialId: true })
  .partial()
  .extend({ status: offerStatusSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one Offer field is required.");

export const purchaseOrderLineInputSchema = z
  .object({
    materialId: uuid,
    supplierOfferId: uuid.nullable().optional(),
    supplierSkuSnapshot: optionalText(120),
    supplierMaterialNameSnapshot: z.string().trim().min(1).max(200),
    orderedQuantityMg: quantityMgSchema,
    unitPricePerKg: nonNegativeDecimalSchema,
    expectedDeliveryAt: optionalTimestamp,
    notes: optionalText(4000)
  })
  .strict();
export const createPurchaseOrderSchema = z
  .object({
    poNumber: z.string().trim().min(1).max(80),
    supplierId: uuid,
    orderType: purchaseOrderTypeSchema,
    currencyCode: currencyCodeSchema,
    supplierQuoteReference: optionalText(240),
    expectedDeliveryAt: optionalTimestamp,
    incoterm: optionalText(40),
    freightAmount: nonNegativeDecimalSchema.nullable().optional(),
    notes: optionalText(4000),
    lines: z.array(purchaseOrderLineInputSchema).min(1).max(200)
  })
  .strict();
export const updatePurchaseOrderSchema = createPurchaseOrderSchema
  .omit({ poNumber: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one Purchase Order field is required."
  );

export const goodsReceiptLineInputSchema = z
  .object({
    purchaseOrderLineId: uuid,
    materialId: uuid,
    receivedQuantityMg: quantityMgSchema,
    lotCode: z.string().trim().min(1).max(120),
    supplierLotCode: optionalText(120),
    manufacturedAt: optionalTimestamp,
    expiresAt: optionalTimestamp,
    retestAt: optionalTimestamp,
    destinationLocationId: uuid
  })
  .strict();
export const createGoodsReceiptSchema = z
  .object({
    receiptNumber: z.string().trim().min(1).max(80),
    purchaseOrderId: uuid,
    supplierDeliveryReference: optionalText(240),
    receivedAt: z.string().datetime({ offset: true }),
    lines: z.array(goodsReceiptLineInputSchema).min(1).max(200)
  })
  .strict();
export const updateGoodsReceiptSchema = createGoodsReceiptSchema
  .omit({ receiptNumber: true, purchaseOrderId: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one Goods Receipt field is required."
  );

export type SupplierStatus = z.infer<typeof supplierStatusSchema>;
export type OfferStatus = z.infer<typeof offerStatusSchema>;
export type PurchaseOrderType = z.infer<typeof purchaseOrderTypeSchema>;
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;
export type GoodsReceiptStatus = z.infer<typeof goodsReceiptStatusSchema>;
export type CreateSupplierRequest = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierRequest = z.infer<typeof updateSupplierSchema>;
export type CreateSupplierOfferRequest = z.infer<typeof createSupplierOfferSchema>;
export type UpdateSupplierOfferRequest = z.infer<typeof updateSupplierOfferSchema>;
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderRequest = z.infer<typeof updatePurchaseOrderSchema>;
export type GoodsReceiptLineInput = z.infer<typeof goodsReceiptLineInputSchema>;
export type CreateGoodsReceiptRequest = z.infer<typeof createGoodsReceiptSchema>;
export type UpdateGoodsReceiptRequest = z.infer<typeof updateGoodsReceiptSchema>;

export type ProcurementCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

export type ProcurementMaterialReference = {
  materialId: string;
  displayName: string;
  materialType: "SINGLE_MOLECULE" | "NATURAL" | "MIXTURE" | "DILUTION";
  approvalStatus: "PENDING_REVIEW" | "APPROVED";
  tenantAccessible: true;
};

export type Supplier = {
  id: string;
  tenantId: string;
  supplierCode: string;
  legalName: string;
  displayName: string;
  countryCode: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  website: string | null;
  taxIdentifier: string | null;
  defaultCurrency: string | null;
  defaultIncoterm: string | null;
  status: SupplierStatus;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierMaterialOffer = {
  id: string;
  tenantId: string;
  supplierId: string;
  materialId: string;
  materialDisplayName: string;
  materialApprovalStatus: "PENDING_REVIEW" | "APPROVED";
  supplierSku: string | null;
  supplierMaterialName: string;
  packSizeMg: QuantityMg | null;
  minimumOrderQuantityMg: QuantityMg | null;
  unitPricePerKg: string | null;
  currencyCode: string | null;
  leadTimeDays: number | null;
  status: OfferStatus;
  lastQuotedAt: Date | null;
  sourceReference: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderLine = {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  lineOrder: number;
  materialId: string;
  materialDisplayName: string;
  supplierOfferId: string | null;
  supplierSkuSnapshot: string | null;
  supplierMaterialNameSnapshot: string;
  orderedQuantityMg: QuantityMg;
  receivedQuantityMg: string;
  remainingQuantityMg: string;
  unitPricePerKg: string;
  lineAmount: string;
  expectedDeliveryAt: Date | null;
  notes: string | null;
  createdAt: Date;
};

export type PurchaseOrder = {
  id: string;
  tenantId: string;
  poNumber: string;
  supplierId: string;
  supplierDisplayName: string;
  orderType: PurchaseOrderType;
  currencyCode: string;
  status: PurchaseOrderStatus;
  supplierQuoteReference: string | null;
  expectedDeliveryAt: Date | null;
  incoterm: string | null;
  freightAmount: string | null;
  notes: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  lines: readonly PurchaseOrderLine[];
};

export type GoodsReceiptLine = {
  id: string;
  tenantId: string;
  goodsReceiptId: string;
  purchaseOrderLineId: string;
  materialId: string;
  materialDisplayName: string;
  receivedQuantityMg: QuantityMg;
  lotCode: string;
  supplierLotCode: string | null;
  manufacturedAt: Date | null;
  expiresAt: Date | null;
  retestAt: Date | null;
  destinationLocationId: string;
  inventoryLotId: string | null;
  inventoryMovementId: string | null;
  createdAt: Date;
};

export type GoodsReceipt = {
  id: string;
  tenantId: string;
  receiptNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierDisplayName: string;
  supplierDeliveryReference: string | null;
  status: GoodsReceiptStatus;
  receivedAt: Date;
  createdByUserId: string;
  postedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  postedAt: Date | null;
  cancelledAt: Date | null;
  lines: readonly GoodsReceiptLine[];
};
