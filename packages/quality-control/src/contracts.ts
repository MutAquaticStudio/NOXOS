import { z } from "zod";
import type { QuantityMg } from "@nox-os/production";

export type { QuantityMg } from "@nox-os/production";

export const uuidSchema = z.string().uuid();
export const decimalStringSchema = z
  .string()
  .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, "INVALID_DECIMAL");
export const specificationStatusSchema = z.enum(["DRAFT", "ACTIVE", "RETIRED"]);
export const specificationItemTypeSchema = z.enum(["NUMERIC_RANGE", "BOOLEAN", "QUALITATIVE"]);
export const inspectionStatusSchema = z.enum(["DRAFT", "FINAL", "CANCELLED"]);
export const judgementSchema = z.enum(["PASS", "REVIEW_REQUIRED", "FAIL"]);
export const batchDispositionSchema = z.enum(["PENDING_QC", "HOLD", "RELEASED", "REJECTED"]);

export type SpecificationStatus = z.infer<typeof specificationStatusSchema>;
export type SpecificationItemType = z.infer<typeof specificationItemTypeSchema>;
export type InspectionStatus = z.infer<typeof inspectionStatusSchema>;
export type QualityJudgement = z.infer<typeof judgementSchema>;
export type BatchDisposition = z.infer<typeof batchDispositionSchema>;

const itemBase = z.object({
  itemOrder: z.number().int().positive(),
  checkKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(200),
  methodReference: z.string().trim().max(500).nullable().optional()
});

export const specificationItemInputSchema = z.discriminatedUnion("checkType", [
  itemBase
    .extend({
      checkType: z.literal("NUMERIC_RANGE"),
      unitCode: z.string().trim().min(1).max(40),
      minValue: decimalStringSchema.nullable().optional(),
      maxValue: decimalStringSchema.nullable().optional(),
      expectedBoolean: z.null().optional(),
      acceptanceCriteriaText: z.string().trim().max(1000).nullable().optional()
    })
    .refine((value) => value.minValue != null || value.maxValue != null, {
      message: "A numeric range requires at least one bound."
    }),
  itemBase.extend({
    checkType: z.literal("BOOLEAN"),
    unitCode: z.null().optional(),
    minValue: z.null().optional(),
    maxValue: z.null().optional(),
    expectedBoolean: z.boolean(),
    acceptanceCriteriaText: z.string().trim().max(1000).nullable().optional()
  }),
  itemBase.extend({
    checkType: z.literal("QUALITATIVE"),
    unitCode: z.null().optional(),
    minValue: z.null().optional(),
    maxValue: z.null().optional(),
    expectedBoolean: z.null().optional(),
    acceptanceCriteriaText: z.string().trim().min(1).max(1000)
  })
]);
export type SpecificationItemInput = z.infer<typeof specificationItemInputSchema>;

export const createSpecificationSchema = z
  .object({
    specificationCode: z.string().trim().min(1).max(80),
    versionNumber: z.number().int().positive(),
    formulaVersionId: uuidSchema,
    formulaBundleHash: z.string().regex(/^[a-f0-9]{64}$/),
    supersedesSpecificationId: uuidSchema.nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict();
export const updateSpecificationSchema = z
  .object({ notes: z.string().trim().max(4000).nullable() })
  .strict();
export const replaceSpecificationItemsSchema = z
  .object({ items: z.array(specificationItemInputSchema).min(1).max(100) })
  .strict();

export const createInspectionSchema = z
  .object({
    batchId: uuidSchema,
    specificationId: uuidSchema,
    sampleReference: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict();
export const updateInspectionSchema = z
  .object({
    sampleReference: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const reinspectionSchema = z
  .object({ retestReason: z.string().trim().min(1).max(2000) })
  .strict();

const resultBase = z.object({
  specificationItemId: uuidSchema,
  notes: z.string().trim().max(2000).nullable().optional()
});
export const inspectionResultInputSchema = z.discriminatedUnion("checkType", [
  resultBase.extend({
    checkType: z.literal("NUMERIC_RANGE"),
    observedNumericValue: decimalStringSchema,
    observedBooleanValue: z.null().optional(),
    observedText: z.null().optional(),
    judgement: z.never().optional()
  }),
  resultBase.extend({
    checkType: z.literal("BOOLEAN"),
    observedNumericValue: z.null().optional(),
    observedBooleanValue: z.boolean(),
    observedText: z.null().optional(),
    judgement: z.never().optional()
  }),
  resultBase.extend({
    checkType: z.literal("QUALITATIVE"),
    observedNumericValue: z.null().optional(),
    observedBooleanValue: z.null().optional(),
    observedText: z.string().trim().min(1).max(4000),
    judgement: judgementSchema
  })
]);
export type InspectionResultInput = z.infer<typeof inspectionResultInputSchema>;
export const replaceInspectionResultsSchema = z
  .object({ results: z.array(inspectionResultInputSchema).min(1).max(100) })
  .strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();

export type QualityCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

export type BatchSpecificationItem = SpecificationItemInput & {
  id: string;
  tenantId: string;
  specificationId: string;
  createdAt: Date;
  updatedAt: Date;
};
export type BatchSpecification = {
  id: string;
  tenantId: string;
  specificationCode: string;
  versionNumber: number;
  formulaVersionId: string;
  formulaBundleHash: string;
  status: SpecificationStatus;
  supersedesSpecificationId: string | null;
  notes: string | null;
  createdByUserId: string;
  activatedByUserId: string | null;
  retiredByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  retiredAt: Date | null;
  items: readonly BatchSpecificationItem[];
};
export type BatchInspectionResult = {
  id: string;
  tenantId: string;
  inspectionId: string;
  specificationItemId: string;
  observedNumericValue: string | null;
  observedBooleanValue: boolean | null;
  observedText: string | null;
  judgement: QualityJudgement;
  measuredByUserId: string;
  measuredAt: Date;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type BatchInspection = {
  id: string;
  tenantId: string;
  inspectionNumber: string;
  batchId: string;
  specificationId: string;
  status: InspectionStatus;
  outcome: QualityJudgement | null;
  supersedesInspectionId: string | null;
  sampleReference: string | null;
  retestReason: string | null;
  notes: string | null;
  createdByUserId: string;
  finalizedByUserId: string | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
  cancelledAt: Date | null;
  results: readonly BatchInspectionResult[];
};
export type BatchReleaseDecision = {
  id: string;
  tenantId: string;
  batchId: string;
  decision: Exclude<BatchDisposition, "PENDING_QC">;
  basisInspectionId: string | null;
  releaseReadinessAssessmentId: string | null;
  supersedesDecisionId: string | null;
  reason: string | null;
  decidedByUserId: string;
  decidedAt: Date;
};
export type QualityBatchAllocation = {
  materialId: string;
  inventoryLotId: string;
  inventoryLocationId: string;
  consumedMassMg: QuantityMg;
  inventoryConsumptionMovementId: string;
};
export type QualityBatchReference = {
  batchId: string;
  tenantId: string;
  batchNumber: string;
  productionOrderId: string;
  productionOrderStatus: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  releaseReadinessAssessmentId: string;
  startReadinessAssessmentId: string;
  targetMassMg: QuantityMg;
  actualOutputMassMg: QuantityMg | null;
  completedAt: Date | null;
  abortedAt: Date | null;
  allocations: readonly QualityBatchAllocation[];
};
export type QualityBatchView = {
  batch: QualityBatchReference;
  currentInspection: BatchInspection | null;
  disposition: BatchDisposition;
  currentDecision: BatchReleaseDecision | null;
  currentReadiness: ProductionReadinessResolution;
};

export type ProductionReadinessResolution =
  | { status: "RESOLVED"; assessmentId: string; decision: "READY" | "REVIEW_REQUIRED" | "BLOCKED" }
  | { status: "MISSING" }
  | { status: "AMBIGUOUS" };
export interface QualityFormulaSource {
  resolveApprovedFrozenFullFormula(input: {
    tenantId: string;
    formulaVersionId: string;
    formulaBundleHash: string;
  }): Promise<"VALID" | "MISSING" | "INVALID">;
}
export interface QualityBatchSource {
  findBatchForQuality(
    tenantId: string,
    batchId: string
  ): Promise<QualityBatchReference | undefined>;
}
export interface QualityReadinessSource {
  resolveCurrentForFormula(input: {
    tenantId: string;
    formulaVersionId: string;
    formulaBundleHash: string;
  }): Promise<ProductionReadinessResolution>;
}
export interface BatchReleaseSource {
  resolveCurrentDisposition(
    tenantId: string,
    batchId: string
  ): Promise<{
    disposition: BatchDisposition;
    effectiveDecisionId: string | null;
    effectiveInspectionId: string | null;
    releaseReadinessAssessmentId: string | null;
    batchId: string;
    productionOrderId: string;
    formulaVersionId: string;
    formulaBundleHash: string;
    actualOutputMassMg: QuantityMg;
  }>;
}

export interface QualityControlStore extends BatchReleaseSource {
  listBatchViews(tenantId: string): Promise<QualityBatchView[]>;
  findBatchView(tenantId: string, batchId: string): Promise<QualityBatchView | undefined>;
  listSpecifications(tenantId: string): Promise<BatchSpecification[]>;
  findSpecification(
    tenantId: string,
    specificationId: string
  ): Promise<BatchSpecification | undefined>;
  createSpecification(
    context: QualityCommandContext & z.infer<typeof createSpecificationSchema>
  ): Promise<BatchSpecification>;
  updateSpecification(
    context: QualityCommandContext & { specificationId: string } & z.infer<
        typeof updateSpecificationSchema
      >
  ): Promise<BatchSpecification>;
  replaceSpecificationItems(
    context: QualityCommandContext & {
      specificationId: string;
      items: readonly SpecificationItemInput[];
    }
  ): Promise<BatchSpecification>;
  activateSpecification(
    context: QualityCommandContext & { specificationId: string }
  ): Promise<BatchSpecification>;
  retireSpecification(
    context: QualityCommandContext & { specificationId: string }
  ): Promise<BatchSpecification>;
  createInspection(
    context: QualityCommandContext & z.infer<typeof createInspectionSchema>
  ): Promise<BatchInspection>;
  findInspection(tenantId: string, inspectionId: string): Promise<BatchInspection | undefined>;
  updateInspection(
    context: QualityCommandContext & { inspectionId: string } & z.infer<
        typeof updateInspectionSchema
      >
  ): Promise<BatchInspection>;
  replaceInspectionResults(
    context: QualityCommandContext & {
      inspectionId: string;
      results: readonly InspectionResultInput[];
    }
  ): Promise<BatchInspection>;
  finalizeInspection(
    context: QualityCommandContext & { inspectionId: string }
  ): Promise<BatchInspection>;
  cancelInspection(
    context: QualityCommandContext & { inspectionId: string }
  ): Promise<BatchInspection>;
  createReinspection(
    context: QualityCommandContext & { inspectionId: string; retestReason: string }
  ): Promise<BatchInspection>;
  holdBatch(
    context: QualityCommandContext & { batchId: string; reason: string }
  ): Promise<BatchReleaseDecision>;
  releaseBatch(context: QualityCommandContext & { batchId: string }): Promise<BatchReleaseDecision>;
  rejectBatch(
    context: QualityCommandContext & { batchId: string; reason: string }
  ): Promise<BatchReleaseDecision>;
}

export type QualityControlErrorCode =
  | "QC_SPECIFICATION_NOT_FOUND"
  | "QC_SPECIFICATION_NOT_EDITABLE"
  | "QC_SPECIFICATION_NOT_ACTIVATABLE"
  | "QC_SPECIFICATION_ALREADY_ACTIVE"
  | "QC_SPECIFICATION_FORMULA_MISMATCH"
  | "QC_SPECIFICATION_ITEM_INVALID"
  | "QC_BATCH_NOT_FOUND"
  | "QC_BATCH_NOT_COMPLETED"
  | "QC_BATCH_ABORTED"
  | "QC_BATCH_ALREADY_TERMINAL"
  | "QC_INSPECTION_NOT_FOUND"
  | "QC_INSPECTION_NOT_EDITABLE"
  | "QC_INSPECTION_NOT_FINALIZABLE"
  | "QC_INSPECTION_ALREADY_FINAL"
  | "QC_INSPECTION_RESULT_INVALID"
  | "QC_INSPECTION_INCOMPLETE"
  | "QC_REINSPECTION_CONFLICT"
  | "QC_RELEASE_REQUIRES_PASS"
  | "QC_RELEASE_READINESS_MISSING"
  | "QC_RELEASE_READINESS_AMBIGUOUS"
  | "QC_RELEASE_NOT_READY"
  | "QC_RELEASE_ALREADY_TERMINAL"
  | "QC_REJECT_REQUIRES_FAIL"
  | "QC_DECISION_CONFLICT"
  | "INVALID_DECIMAL"
  | "INVALID_UNIT"
  | "TENANT_ACCESS_DENIED"
  | "PERMISSION_DENIED";
