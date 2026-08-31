import { z } from "zod";
import {
  compositionKindSchema,
  massMgSchema,
  osmoTaxonomyAssignmentTypeSchema,
  positiveMassMgSchema,
  type CompositionKind,
  type MassMg,
  type OsmoTaxonomyAssignmentType,
  type SensoryPhase
} from "@nox-os/design-studio";

export const TRIAL_SENSORY_TAXONOMY_SOURCE = "OSMO" as const;
export const TRIAL_SENSORY_TAXONOMY_VERSION = "osmo_v1.2" as const;
export const TRIAL_SCALING_POLICY_VERSION = "g4-largest-remainder-v1" as const;

export const trialStatusSchema = z.enum(["DRAFT", "PREPARED", "COMPLETED", "CANCELLED"]);
export type TrialStatus = z.infer<typeof trialStatusSchema>;

export const evaluationStatusSchema = z.enum(["DRAFT", "FINAL"]);
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

export const finalEvaluationDecisionSchema = z.enum(["REVISION_REQUIRED", "READY_FOR_APPROVAL"]);
export type FinalEvaluationDecision = z.infer<typeof finalEvaluationDecisionSchema>;

export const preparationModeSchema = z.enum(["CONCENTRATE", "FINISHED_APPLICATION"]);
export type PreparationMode = z.infer<typeof preparationModeSchema>;

export const evaluationMediumSchema = z.enum(["BLOTTER", "SKIN", "PRODUCT", "OTHER"]);
export type EvaluationMedium = z.infer<typeof evaluationMediumSchema>;

export const sensoryPhaseSchema = z.enum(["TOP", "MID", "BASE", "CROSS_PHASE"]);
export const sensoryDeltaValueSchema = z.number().int().min(-5).max(5);

export const supportedTrialCompositionKindSchema = compositionKindSchema;
export type SupportedTrialCompositionKind = CompositionKind;

export const trialPreparationContextSchema = z.object({
  preparationMode: preparationModeSchema,
  applicationKey: z.string().trim().min(1).max(120),
  dosagePct: z.number().finite().positive().max(100),
  carrierOrBaseReference: z.string().trim().min(1).max(240).nullable().optional(),
  targetMassMg: positiveMassMgSchema
});
export type TrialPreparationContext = z.infer<typeof trialPreparationContextSchema>;

export const sensoryEvaluationContextSchema = z.object({
  evaluationMedium: evaluationMediumSchema,
  sampleAgeMinutes: z.number().int().nonnegative(),
  temperatureC: z.number().finite().nullable().optional(),
  humidityPct: z.number().finite().min(0).max(100).nullable().optional()
});
export type SensoryEvaluationContext = z.infer<typeof sensoryEvaluationContextSchema>;

export const sensoryDeltaDraftSchema = z.object({
  phase: sensoryPhaseSchema,
  assignmentType: osmoTaxonomyAssignmentTypeSchema,
  taxonomyTerm: z.string().trim().min(1).max(160),
  proposedDelta: sensoryDeltaValueSchema.nullable().optional(),
  confirmedDelta: sensoryDeltaValueSchema.nullable().optional(),
  proposalConfidence: z.number().finite().min(0).max(1).nullable().optional(),
  interpreterVersion: z.string().trim().min(1).max(120).nullable().optional()
});
export type SensoryDeltaDraft = z.infer<typeof sensoryDeltaDraftSchema>;

export const createTrialSchema = z.object({
  formulaVersionId: z.string().uuid(),
  ...trialPreparationContextSchema.shape
});
export type CreateTrialRequest = z.infer<typeof createTrialSchema>;

export const createEvaluationSchema = z.object({
  ...sensoryEvaluationContextSchema.shape,
  evaluationText: z.string().max(20_000).default(""),
  diagnosticNote: z.string().max(10_000).nullable().optional()
});
export type CreateEvaluationRequest = z.infer<typeof createEvaluationSchema>;

export const updateEvaluationSchema = createEvaluationSchema.extend({
  deltas: z.array(sensoryDeltaDraftSchema).max(160).default([])
});
export type UpdateEvaluationRequest = z.infer<typeof updateEvaluationSchema>;

export const finalizeEvaluationSchema = z.object({
  decision: finalEvaluationDecisionSchema,
  deltas: z.array(sensoryDeltaDraftSchema).max(160)
});
export type FinalizeEvaluationRequest = z.infer<typeof finalizeEvaluationSchema>;

export type TrialLine = {
  materialId: string;
  lineOrder: number;
  scaledMassMg: MassMg;
  materialSnapshotHash: string;
};

export type Trial = {
  id: string;
  tenantId: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  compositionKind: SupportedTrialCompositionKind;
  taxonomySource: typeof TRIAL_SENSORY_TAXONOMY_SOURCE;
  taxonomyVersion: typeof TRIAL_SENSORY_TAXONOMY_VERSION;
  preparation: TrialPreparationContext;
  scalingPolicyVersion: typeof TRIAL_SCALING_POLICY_VERSION;
  status: TrialStatus;
  createdByUserId: string;
  preparedByUserId: string | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  preparedAt: Date | null;
  cancelledAt: Date | null;
  lines: readonly TrialLine[];
};

export type SensoryDelta = {
  phase: SensoryPhase;
  assignmentType: OsmoTaxonomyAssignmentType;
  taxonomyTerm: string;
  proposedDelta: number | null;
  confirmedDelta: number | null;
  proposalConfidence: number | null;
  interpreterVersion: string | null;
  confirmedAt: Date | null;
};

export type SensoryEvaluation = {
  id: string;
  tenantId: string;
  trialId: string;
  status: EvaluationStatus;
  context: SensoryEvaluationContext;
  evaluationText: string;
  diagnosticNote: string | null;
  decision: FinalEvaluationDecision | null;
  evaluatedByUserId: string;
  finalizedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
  deltas: readonly SensoryDelta[];
};

export { massMgSchema };
