import { z } from "zod";
import type { QuantityMg, MaterialLot, StockReservation, StockMovement } from "@nox-os/inventory";
export type { QuantityMg } from "@nox-os/inventory";
export const productionOrderStatusSchema = z.enum([
  "DRAFT",
  "RELEASED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "ABORTED"
]);
export type ProductionOrderStatus = z.infer<typeof productionOrderStatusSchema>;
export const uuidSchema = z.string().uuid();
export const createProductionOrderSchema = z
  .object({
    orderNumber: z.string().trim().min(1).max(80),
    formulaVersionId: uuidSchema,
    targetMassMg: z.string().regex(/^[1-9][0-9]*$/),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict();
export type CreateProductionOrderRequest = z.infer<typeof createProductionOrderSchema>;
export const updateProductionOrderSchema = z
  .object({
    targetMassMg: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type UpdateProductionOrderRequest = z.infer<typeof updateProductionOrderSchema>;
export const allocationInputSchema = z
  .object({
    productionOrderLineId: uuidSchema,
    lotId: uuidSchema,
    locationId: uuidSchema,
    allocatedMassMg: z.string().regex(/^[1-9][0-9]*$/)
  })
  .strict();
export const updateAllocationsSchema = z
  .object({ allocations: z.array(allocationInputSchema).max(500) })
  .strict();
export type AllocationInput = z.infer<typeof allocationInputSchema>;
export const completeBatchSchema = z
  .object({
    actualOutputMassMg: z.string().regex(/^[1-9][0-9]*$/),
    processNotes: z.string().trim().max(4000).nullable().optional()
  })
  .strict();
export const abortBatchSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
export type ProductionCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};
export type ProductionOrderLine = {
  id: string;
  tenantId: string;
  productionOrderId: string;
  formulaLineOrder: number;
  materialId: string;
  requiredMassMg: QuantityMg;
  materialSnapshotHash: string;
  createdAt: Date;
};
export type ProductionMaterialAllocation = {
  id: string;
  tenantId: string;
  productionOrderId: string;
  productionOrderLineId: string;
  materialId: string;
  inventoryLotId: string;
  inventoryLocationId: string;
  allocatedMassMg: QuantityMg;
  inventoryReservationId: string | null;
  inventoryConsumptionMovementId: string | null;
  reservationOperationKey: string;
  consumptionOperationKey: string;
  createdByUserId: string;
  createdAt: Date;
};
export type ProductionOrder = {
  id: string;
  tenantId: string;
  orderNumber: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  targetMassMg: QuantityMg;
  status: ProductionOrderStatus;
  releaseReadinessAssessmentId: string | null;
  notes: string | null;
  createdByUserId: string;
  releasedByUserId: string | null;
  cancelledByUserId: string | null;
  completedByUserId: string | null;
  abortedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  releasedAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  abortedAt: Date | null;
  lines: readonly ProductionOrderLine[];
  allocations: readonly ProductionMaterialAllocation[];
};
export type ProductionBatch = {
  id: string;
  tenantId: string;
  batchNumber: string;
  productionOrderId: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  releaseReadinessAssessmentId: string;
  startReadinessAssessmentId: string;
  targetMassMg: QuantityMg;
  actualOutputMassMg: QuantityMg | null;
  processNotes: string | null;
  abortReason: string | null;
  startedByUserId: string;
  completedByUserId: string | null;
  abortedByUserId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  abortedAt: Date | null;
  allocations: readonly ProductionMaterialAllocation[];
};
export type ProductionReadinessResolution =
  | { status: "RESOLVED"; assessmentId: string; decision: "READY" | "REVIEW_REQUIRED" | "BLOCKED" }
  | { status: "MISSING" }
  | { status: "AMBIGUOUS" };
export interface ProductionReadinessSource {
  resolveCurrentForFormula(input: {
    tenantId: string;
    formulaVersionId: string;
    formulaBundleHash: string;
  }): Promise<ProductionReadinessResolution>;
}
export interface ProductionInventoryOperations {
  getLotAvailability(input: { tenantId: string; materialId: string }): Promise<MaterialLot[]>;
  reserveLot(
    input: import("@nox-os/inventory").ProductionReservationInput
  ): Promise<StockReservation>;
  releaseReservation(
    input: import("@nox-os/inventory").ProductionReservationTransitionInput
  ): Promise<StockReservation>;
  consumeReservation(
    input: import("@nox-os/inventory").ProductionReservationTransitionInput
  ): Promise<StockReservation>;
}
export interface ProductionStore {
  listOrders(tenantId: string): Promise<ProductionOrder[]>;
  findOrder(tenantId: string, orderId: string): Promise<ProductionOrder | undefined>;
  createOrder(
    context: ProductionCommandContext & CreateProductionOrderRequest
  ): Promise<ProductionOrder>;
  updateOrder(
    context: ProductionCommandContext & { orderId: string } & UpdateProductionOrderRequest
  ): Promise<ProductionOrder>;
  updateAllocations(
    context: ProductionCommandContext & { orderId: string; allocations: readonly AllocationInput[] }
  ): Promise<ProductionOrder>;
  releaseOrder(context: ProductionCommandContext & { orderId: string }): Promise<ProductionOrder>;
  cancelOrder(context: ProductionCommandContext & { orderId: string }): Promise<ProductionOrder>;
  startOrder(context: ProductionCommandContext & { orderId: string }): Promise<ProductionBatch>;
  completeBatch(
    context: ProductionCommandContext & {
      batchId: string;
      actualOutputMassMg: QuantityMg;
      processNotes?: string | null;
    }
  ): Promise<ProductionBatch>;
  abortBatch(
    context: ProductionCommandContext & { batchId: string; reason: string }
  ): Promise<ProductionBatch>;
  findBatch(tenantId: string, batchId: string): Promise<ProductionBatch | undefined>;
  findBatchForOrder(tenantId: string, orderId: string): Promise<ProductionBatch | undefined>;
}
export type ProductionErrorCode =
  | "PRODUCTION_ORDER_NOT_FOUND"
  | "PRODUCTION_ORDER_NOT_EDITABLE"
  | "PRODUCTION_ORDER_NOT_RELEASABLE"
  | "PRODUCTION_ORDER_ALREADY_RELEASED"
  | "PRODUCTION_ORDER_ALREADY_STARTED"
  | "PRODUCTION_ORDER_ALREADY_TERMINAL"
  | "PRODUCTION_ORDER_NOT_RELEASED"
  | "PRODUCTION_BATCH_NOT_FOUND"
  | "PRODUCTION_BATCH_NOT_IN_PROGRESS"
  | "PRODUCTION_FORMULA_NOT_APPROVED"
  | "PRODUCTION_FORMULA_NOT_FULL"
  | "PRODUCTION_FORMULA_NOT_FOUND"
  | "PRODUCTION_READINESS_MISSING"
  | "PRODUCTION_READINESS_AMBIGUOUS"
  | "PRODUCTION_NOT_READY"
  | "PRODUCTION_ALLOCATION_MISMATCH"
  | "PRODUCTION_ALLOCATION_INELIGIBLE"
  | "PRODUCTION_SHORTAGE"
  | "PRODUCTION_BELOW_WEIGHABLE_RESOLUTION"
  | "PRODUCTION_ABORT_REASON_REQUIRED"
  | "PRODUCTION_OUTPUT_INVALID"
  | "PRODUCTION_IDEMPOTENCY_CONFLICT";
