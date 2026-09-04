import { z } from "zod";

export const commercialUuidSchema = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const integer = (name: string, minimum = 0n) =>
  z.string().refine((value) => /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) >= minimum, name);

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "COMMERCIAL_CURRENCY_INVALID");
export const quoteStatusSchema = z.enum(["DRAFT", "ISSUED", "ACCEPTED", "DECLINED", "CANCELLED"]);
export const orderStatusSchema = z.enum(["DRAFT", "CONFIRMED", "CANCELLED", "CLOSED"]);
export const lineKindSchema = z.enum(["MATERIAL", "SERVICE_SCOPE", "MANUFACTURED_PRODUCT"]);
export const allocationTypeSchema = z.enum(["MATERIAL_LOT", "RELEASED_BATCH"]);
export const allocationStateSchema = z.enum(["ACTIVE", "RELEASED", "CONSUMED"]);
export const fulfillmentStatusSchema = z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]);
export const shipmentStatusSchema = z.enum(["DRAFT", "SHIPPED", "DELIVERED", "CANCELLED"]);
export type CommercialLineKind = z.infer<typeof lineKindSchema>;
export type CommercialCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

const lineBase = z.object({
  lineOrder: z.number().int().positive(),
  lineKind: lineKindSchema,
  titleSnapshot: text(300),
  descriptionSnapshot: optionalText(4000),
  quantityValue: integer("COMMERCIAL_LINE_INVALID", 1n),
  unitPriceMinor: integer("COMMERCIAL_MONEY_INVALID"),
  priceBasisQuantity: integer("COMMERCIAL_MONEY_INVALID", 1n),
  discountMinor: integer("COMMERCIAL_MONEY_INVALID").optional().default("0"),
  notes: optionalText(4000)
});

export const commercialLineSchema = z.discriminatedUnion("lineKind", [
  lineBase.extend({
    lineKind: z.literal("MATERIAL"),
    materialId: commercialUuidSchema,
    serviceOrderLineId: z.null().optional(),
    formulaVersionId: z.null().optional()
  }),
  lineBase.extend({
    lineKind: z.literal("SERVICE_SCOPE"),
    materialId: z.null().optional(),
    serviceOrderLineId: commercialUuidSchema,
    formulaVersionId: z.null().optional(),
    quantityValue: z.literal("1"),
    priceBasisQuantity: z.literal("1")
  }),
  lineBase.extend({
    lineKind: z.literal("MANUFACTURED_PRODUCT"),
    materialId: z.null().optional(),
    serviceOrderLineId: z.null().optional(),
    formulaVersionId: commercialUuidSchema
  })
]);
export type CommercialLineInput = z.infer<typeof commercialLineSchema>;

const header = {
  customerId: commercialUuidSchema,
  customerContactId: commercialUuidSchema.nullable().optional(),
  sourceServiceOrderId: commercialUuidSchema.nullable().optional(),
  sourceProjectId: commercialUuidSchema.nullable().optional(),
  currencyCode: currencyCodeSchema,
  commercialTerms: optionalText(4000),
  paymentTermsText: optionalText(4000),
  shippingTermsText: optionalText(4000),
  shipToSnapshot: z.record(z.string(), z.unknown()).nullable().optional()
};
export const createQuoteSchema = z
  .object({
    quoteNumber: text(80),
    validUntil: z.string().datetime().nullable().optional(),
    lines: z.array(commercialLineSchema).min(1).max(100),
    ...header
  })
  .strict();
export const updateQuoteSchema = z
  .object({
    validUntil: z.string().datetime().nullable().optional(),
    lines: z.array(commercialLineSchema).min(1).max(100).optional(),
    commercialTerms: optionalText(4000),
    paymentTermsText: optionalText(4000),
    shippingTermsText: optionalText(4000),
    shipToSnapshot: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "COMMERCIAL_QUOTE_NOT_EDITABLE");
export const createOrderSchema = z
  .object({
    orderNumber: text(80),
    lines: z.array(commercialLineSchema).min(1).max(100),
    ...header
  })
  .strict();
export const updateOrderSchema = z
  .object({
    lines: z.array(commercialLineSchema).min(1).max(100).optional(),
    commercialTerms: optionalText(4000),
    paymentTermsText: optionalText(4000),
    shippingTermsText: optionalText(4000),
    shipToSnapshot: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "COMMERCIAL_ORDER_NOT_EDITABLE");
export const reasonSchema = z.object({ reason: text(2000) }).strict();
export const allocationSchema = z.discriminatedUnion("allocationType", [
  z
    .object({
      allocationType: z.literal("MATERIAL_LOT"),
      orderLineId: commercialUuidSchema,
      materialLotId: commercialUuidSchema,
      locationId: commercialUuidSchema,
      quantityValue: integer("COMMERCIAL_ALLOCATION_INVALID", 1n)
    })
    .strict(),
  z
    .object({
      allocationType: z.literal("RELEASED_BATCH"),
      orderLineId: commercialUuidSchema,
      productionBatchId: commercialUuidSchema,
      quantityValue: integer("COMMERCIAL_ALLOCATION_INVALID", 1n)
    })
    .strict()
]);
export const createFulfillmentSchema = z
  .object({ fulfillmentNumber: text(80), notes: optionalText(4000) })
  .strict();
export const fulfillmentLinesSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            orderLineId: commercialUuidSchema,
            allocationId: commercialUuidSchema.nullable().optional(),
            quantityValue: integer("COMMERCIAL_FULFILLMENT_EXCEEDS_ORDER", 1n)
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict();
export const updateFulfillmentSchema = z.object({ notes: optionalText(4000) }).strict();
export const createShipmentSchema = z
  .object({
    shipmentNumber: text(80),
    shipToSnapshot: z.record(z.string(), z.unknown()),
    carrierName: optionalText(240),
    serviceLevel: optionalText(240),
    trackingNumber: optionalText(240),
    notes: optionalText(4000)
  })
  .strict();
export const updateShipmentSchema = z
  .object({
    carrierName: optionalText(240),
    serviceLevel: optionalText(240),
    trackingNumber: optionalText(240),
    notes: optionalText(4000)
  })
  .strict();
export const commercialOperationSchema = z.object({ operationKey: text(240) }).strict();

export type CommercialCustomer = {
  id: string;
  status: "PROSPECT" | "ACTIVE" | "ON_HOLD" | "ARCHIVED";
  customerCode: string;
  displayName: string;
  legalName: string | null;
  taxIdentifier: string | null;
  countryCode: string | null;
  contact: Record<string, unknown> | null;
};
export type CommercialServiceLine = {
  serviceOrderId: string;
  serviceOrderStatus: string;
  customerId: string;
  lineId: string;
  title: string;
  scopeDescription: string | null;
};
export type CommercialFormula = {
  formulaVersionId: string;
  compositionKind: string;
  status: string;
  approvalState: string;
};
export type CommercialBatch = {
  batchId: string;
  formulaVersionId: string;
  actualOutputMassMg: string;
  disposition: string;
  decisionId: string | null;
};
export type CommercialProject = {
  projectId: string;
  projectType: string;
  status: string;
  sourceServiceOrderId: string | null;
};
export type CommercialAnalyticsOrder = {
  orderId: string;
  orderNumber: string;
  customerId: string;
  currencyCode: string;
  commercialStatus: "DRAFT" | "CONFIRMED" | "CANCELLED" | "CLOSED";
  fulfillmentStatus: "NOT_STARTED" | "PARTIAL" | "FULFILLED";
  shippingStatus: string;
  commercialAmountMinor: string;
  confirmedAt: string | null;
  closedAt: string | null;
  sourceProjectId: string | null;
};
export interface CommercialAnalyticsSource {
  listCommercialOrders(input: {
    tenantId: string;
    from?: string;
    to?: string;
  }): Promise<readonly CommercialAnalyticsOrder[]>;
}
