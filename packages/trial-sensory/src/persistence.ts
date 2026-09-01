import type {
  FinalEvaluationDecision,
  SensoryDeltaDraft,
  SensoryEvaluation,
  SensoryEvaluationContext,
  Trial,
  TrialInventoryAvailability,
  TrialInventoryReservationSet,
  TrialLine,
  TrialLotAllocation,
  TrialPreparationRequirement,
  TrialPreparationContext
} from "./contracts.js";

export interface TrialInventoryPort {
  listAvailability(input: {
    tenantId: string;
    trialId: string;
    requirements: readonly TrialPreparationRequirement[];
  }): Promise<TrialInventoryAvailability>;
  reserve(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
    correlationId: string;
    trialId: string;
    allocations: readonly TrialLotAllocation[];
    operationKey: string;
  }): Promise<TrialInventoryReservationSet>;
  releaseDraftTrialReservations(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
    correlationId: string;
    trialId: string;
    operationKey: string;
  }): Promise<void>;
}

export interface TrialSensoryStore {
  createTrial(input: {
    tenantId: string;
    formulaVersionId: string;
    formulaBundleHash: string;
    compositionKind: Trial["compositionKind"];
    taxonomySource: Trial["taxonomySource"];
    taxonomyVersion: Trial["taxonomyVersion"];
    preparation: TrialPreparationContext;
    scalingPolicyVersion: Trial["scalingPolicyVersion"];
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<Trial>;
  listTrials(tenantId: string): Promise<Trial[]>;
  findTrial(tenantId: string, trialId: string): Promise<Trial | undefined>;
  prepareTrial(input: {
    tenantId: string;
    trialId: string;
    formulaVersionId: string;
    targetMassMg: string;
    lines: readonly TrialLine[];
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<Trial | undefined>;
  cancelTrial(input: {
    tenantId: string;
    trialId: string;
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<Trial | undefined>;
  createEvaluation(input: {
    tenantId: string;
    trialId: string;
    context: SensoryEvaluationContext;
    evaluationText: string;
    diagnosticNote: string | null;
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<SensoryEvaluation>;
  findEvaluation(
    tenantId: string,
    trialId: string,
    evaluationId: string
  ): Promise<SensoryEvaluation | undefined>;
  findEvaluationForTrial(tenantId: string, trialId: string): Promise<SensoryEvaluation | undefined>;
  updateDraftEvaluation(input: {
    tenantId: string;
    trialId: string;
    evaluationId: string;
    context: SensoryEvaluationContext;
    evaluationText: string;
    diagnosticNote: string | null;
    deltas: readonly SensoryDeltaDraft[];
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<SensoryEvaluation | undefined>;
  finalizeEvaluation(input: {
    tenantId: string;
    trialId: string;
    evaluationId: string;
    decision: FinalEvaluationDecision;
    deltas: readonly SensoryDeltaDraft[];
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<SensoryEvaluation | undefined>;
  recordAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    requestId: string;
    correlationId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void>;
}
