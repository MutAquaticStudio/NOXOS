import {
  findBelowWeighableResolution,
  scaleFormulaMasses,
  trialContextSchema,
  type FormulaApprovalEvidence,
  type FormulaApprovalEvidenceReader,
  type FormulaRevisionContext,
  type FormulaRevisionContextReader,
  type FrozenFormulaVersion
} from "@nox-os/design-studio";
import { OsmoTaxonomyRegistry } from "@nox-os/material-intelligence";
import {
  TRIAL_SCALING_POLICY_VERSION,
  TRIAL_SENSORY_TAXONOMY_SOURCE,
  TRIAL_SENSORY_TAXONOMY_VERSION,
  sensoryDeltaDraftSchema,
  type CreateEvaluationRequest,
  type CreateTrialRequest,
  type FinalizeEvaluationRequest,
  type SensoryDeltaDraft,
  type SensoryEvaluation,
  type Trial,
  type UpdateEvaluationRequest
} from "./contracts.js";
import { TrialSensoryProblem } from "./problem.js";
import type { TrialSensoryStore } from "./persistence.js";

export type TrialSensoryFormulaSource = {
  findFrozenFormulaVersion(
    tenantId: string,
    formulaVersionId: string
  ): Promise<FrozenFormulaVersion | undefined>;
};

export type TrialSensoryCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

const taxonomy = new OsmoTaxonomyRegistry();

function validateDeltas(deltas: readonly SensoryDeltaDraft[], requireConfirmed: boolean): void {
  const seen = new Set<string>();
  for (const value of deltas) {
    const parsed = sensoryDeltaDraftSchema.safeParse(value);
    if (!parsed.success || (requireConfirmed && parsed.data.confirmedDelta == null)) {
      throw new TrialSensoryProblem(
        400,
        "INVALID_SENSORY_DELTA",
        "Sensory delta must be a confirmed integer from -5 through +5."
      );
    }
    const key = `${parsed.data.phase}:${parsed.data.assignmentType}:${parsed.data.taxonomyTerm}`;
    if (seen.has(key)) {
      throw new TrialSensoryProblem(400, "INVALID_SENSORY_DELTA", "Sensory delta is duplicated.");
    }
    seen.add(key);
    try {
      taxonomy.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: parsed.data.assignmentType,
          taxonomyTerm: parsed.data.taxonomyTerm,
          intensity: null
        }
      ]);
    } catch {
      throw new TrialSensoryProblem(
        400,
        "INVALID_TAXONOMY_TERM",
        "Sensory delta taxonomy term is not canonical for the frozen taxonomy version."
      );
    }
  }
}

function ensureDraftTrial(trial: Trial): void {
  if (trial.status === "CANCELLED")
    throw new TrialSensoryProblem(409, "TRIAL_CANCELLED", "Trial is cancelled.");
  if (trial.status === "COMPLETED")
    throw new TrialSensoryProblem(409, "TRIAL_ALREADY_COMPLETED", "Trial is completed.");
  if (trial.status !== "DRAFT")
    throw new TrialSensoryProblem(409, "TRIAL_ALREADY_PREPARED", "Trial is already prepared.");
}

function ensurePreparedTrial(trial: Trial): void {
  if (trial.status === "CANCELLED")
    throw new TrialSensoryProblem(409, "TRIAL_CANCELLED", "Trial is cancelled.");
  if (trial.status === "COMPLETED")
    throw new TrialSensoryProblem(409, "TRIAL_ALREADY_COMPLETED", "Trial is completed.");
  if (trial.status !== "PREPARED")
    throw new TrialSensoryProblem(409, "TRIAL_NOT_PREPARED", "Trial must be prepared first.");
}

export class TrialSensoryApplication
  implements FormulaRevisionContextReader, FormulaApprovalEvidenceReader
{
  constructor(
    readonly store: TrialSensoryStore,
    private readonly formulas: TrialSensoryFormulaSource
  ) {}

  async createTrial(
    context: TrialSensoryCommandContext,
    input: CreateTrialRequest
  ): Promise<Trial> {
    const formula = await this.formulas.findFrozenFormulaVersion(
      context.tenantId,
      input.formulaVersionId
    );
    if (!formula || formula.status !== "FROZEN") {
      throw new TrialSensoryProblem(
        409,
        "FORMULA_VERSION_NOT_FROZEN",
        "A Trial requires a tenant-accessible FROZEN FormulaVersion."
      );
    }
    if (!(["FULL_FORMULA", "ACCORD_FORMULATION"] as const).includes(formula.compositionKind)) {
      throw new TrialSensoryProblem(
        409,
        "UNSUPPORTED_COMPOSITION_KIND",
        "Composition kind cannot be prepared as a Trial."
      );
    }
    if (
      formula.candidate.taxonomySource !== TRIAL_SENSORY_TAXONOMY_SOURCE ||
      formula.candidate.taxonomyVersion !== TRIAL_SENSORY_TAXONOMY_VERSION
    ) {
      throw new TrialSensoryProblem(
        409,
        "REVISION_CONTEXT_INVALID",
        "Formula taxonomy lineage is unsupported."
      );
    }
    return this.store.createTrial({
      ...context,
      formulaVersionId: formula.formulaVersionId,
      formulaBundleHash: formula.bundleHash,
      compositionKind: formula.compositionKind,
      taxonomySource: TRIAL_SENSORY_TAXONOMY_SOURCE,
      taxonomyVersion: TRIAL_SENSORY_TAXONOMY_VERSION,
      preparation: {
        preparationMode: input.preparationMode,
        applicationKey: input.applicationKey,
        dosagePct: input.dosagePct,
        carrierOrBaseReference: input.carrierOrBaseReference ?? null,
        targetMassMg: input.targetMassMg
      },
      scalingPolicyVersion: TRIAL_SCALING_POLICY_VERSION
    });
  }

  listTrials(tenantId: string): Promise<Trial[]> {
    return this.store.listTrials(tenantId);
  }

  async requireTrial(tenantId: string, trialId: string): Promise<Trial> {
    const trial = await this.store.findTrial(tenantId, trialId);
    if (!trial) throw new TrialSensoryProblem(404, "TRIAL_NOT_FOUND", "Trial was not found.");
    return trial;
  }

  findFormulaForTrial(tenantId: string, trial: Trial): Promise<FrozenFormulaVersion | undefined> {
    return this.formulas.findFrozenFormulaVersion(tenantId, trial.formulaVersionId);
  }

  async prepareTrial(context: TrialSensoryCommandContext, trialId: string): Promise<Trial> {
    const trial = await this.requireTrial(context.tenantId, trialId);
    ensureDraftTrial(trial);
    const formula = await this.formulas.findFrozenFormulaVersion(
      context.tenantId,
      trial.formulaVersionId
    );
    if (
      !formula ||
      formula.bundleHash !== trial.formulaBundleHash ||
      formula.compositionKind !== trial.compositionKind
    ) {
      throw new TrialSensoryProblem(
        409,
        "FORMULA_VERSION_NOT_FROZEN",
        "Trial lineage no longer matches its FROZEN FormulaVersion."
      );
    }
    const scaled = scaleFormulaMasses(
      formula.candidate.lines.map((line) => ({
        materialId: line.materialId,
        normalizedMassMg: line.normalizedMassMg
      })),
      trial.preparation.targetMassMg
    );
    const belowResolution = findBelowWeighableResolution(scaled);
    if (belowResolution.length > 0) {
      throw new TrialSensoryProblem(
        409,
        "BELOW_WEIGHABLE_RESOLUTION",
        "At least one Formula line is below the 1 mg balance resolution."
      );
    }
    const snapshots = new Map(
      formula.candidate.lines.map((line) => [line.materialId, line.materialSnapshot.snapshotHash])
    );
    const lines = scaled.map((line, index) => ({
      materialId: line.materialId,
      lineOrder: index + 1,
      scaledMassMg: line.scaledMassMg,
      materialSnapshotHash: snapshots.get(line.materialId) ?? ""
    }));
    const total = lines.reduce((sum, line) => sum + BigInt(line.scaledMassMg), 0n);
    if (total !== BigInt(trial.preparation.targetMassMg)) {
      throw new TrialSensoryProblem(409, "FORMULA_TOTAL_INVALID", "Scaled Trial total is invalid.");
    }
    const prepared = await this.store.prepareTrial({
      ...context,
      trialId,
      formulaVersionId: trial.formulaVersionId,
      targetMassMg: trial.preparation.targetMassMg,
      lines
    });
    if (!prepared)
      throw new TrialSensoryProblem(409, "TRIAL_ALREADY_PREPARED", "Trial was prepared already.");
    return prepared;
  }

  async cancelTrial(context: TrialSensoryCommandContext, trialId: string): Promise<Trial> {
    const trial = await this.requireTrial(context.tenantId, trialId);
    if (trial.status === "CANCELLED")
      throw new TrialSensoryProblem(409, "TRIAL_CANCELLED", "Trial is already cancelled.");
    if (trial.status === "COMPLETED")
      throw new TrialSensoryProblem(
        409,
        "TRIAL_ALREADY_COMPLETED",
        "Completed Trial cannot cancel."
      );
    const cancelled = await this.store.cancelTrial({ ...context, trialId });
    if (!cancelled) throw new TrialSensoryProblem(409, "TRIAL_CANCELLED", "Trial cannot cancel.");
    return cancelled;
  }

  async createEvaluation(
    context: TrialSensoryCommandContext,
    trialId: string,
    input: CreateEvaluationRequest
  ): Promise<SensoryEvaluation> {
    ensurePreparedTrial(await this.requireTrial(context.tenantId, trialId));
    return this.store.createEvaluation({
      ...context,
      trialId,
      context: {
        evaluationMedium: input.evaluationMedium,
        sampleAgeMinutes: input.sampleAgeMinutes,
        temperatureC: input.temperatureC ?? null,
        humidityPct: input.humidityPct ?? null
      },
      evaluationText: input.evaluationText,
      diagnosticNote: input.diagnosticNote ?? null
    });
  }

  async requireEvaluation(
    tenantId: string,
    trialId: string,
    evaluationId: string
  ): Promise<SensoryEvaluation> {
    const value = await this.store.findEvaluation(tenantId, trialId, evaluationId);
    if (!value)
      throw new TrialSensoryProblem(404, "EVALUATION_NOT_FOUND", "Evaluation was not found.");
    return value;
  }

  findEvaluationForTrial(
    tenantId: string,
    trialId: string
  ): Promise<SensoryEvaluation | undefined> {
    return this.store.findEvaluationForTrial(tenantId, trialId);
  }

  async updateEvaluation(
    context: TrialSensoryCommandContext,
    trialId: string,
    evaluationId: string,
    input: UpdateEvaluationRequest
  ): Promise<SensoryEvaluation> {
    const evaluation = await this.requireEvaluation(context.tenantId, trialId, evaluationId);
    if (evaluation.status === "FINAL")
      throw new TrialSensoryProblem(409, "EVALUATION_ALREADY_FINAL", "Evaluation is FINAL.");
    validateDeltas(input.deltas, false);
    const updated = await this.store.updateDraftEvaluation({
      ...context,
      trialId,
      evaluationId,
      context: {
        evaluationMedium: input.evaluationMedium,
        sampleAgeMinutes: input.sampleAgeMinutes,
        temperatureC: input.temperatureC ?? null,
        humidityPct: input.humidityPct ?? null
      },
      evaluationText: input.evaluationText,
      diagnosticNote: input.diagnosticNote ?? null,
      deltas: input.deltas
    });
    if (!updated)
      throw new TrialSensoryProblem(409, "EVALUATION_ALREADY_FINAL", "Evaluation is FINAL.");
    return updated;
  }

  async finalizeEvaluation(
    context: TrialSensoryCommandContext,
    trialId: string,
    evaluationId: string,
    input: FinalizeEvaluationRequest
  ): Promise<SensoryEvaluation> {
    ensurePreparedTrial(await this.requireTrial(context.tenantId, trialId));
    const evaluation = await this.requireEvaluation(context.tenantId, trialId, evaluationId);
    if (evaluation.status === "FINAL")
      throw new TrialSensoryProblem(409, "EVALUATION_ALREADY_FINAL", "Evaluation is FINAL.");
    if (!evaluation.evaluationText.trim()) {
      throw new TrialSensoryProblem(
        400,
        "EVALUATION_NOT_FINAL",
        "Raw sensory evaluation text is required."
      );
    }
    validateDeltas(input.deltas, true);
    if (
      input.decision === "REVISION_REQUIRED" &&
      !input.deltas.some((delta) => (delta.confirmedDelta ?? 0) !== 0)
    ) {
      throw new TrialSensoryProblem(
        400,
        "INVALID_SENSORY_DELTA",
        "Revision requires at least one non-zero confirmed sensory delta."
      );
    }
    const finalized = await this.store.finalizeEvaluation({
      ...context,
      trialId,
      evaluationId,
      decision: input.decision,
      deltas: input.deltas
    });
    if (!finalized)
      throw new TrialSensoryProblem(409, "EVALUATION_ALREADY_FINAL", "Evaluation is FINAL.");
    return finalized;
  }

  interpret(): never {
    throw new TrialSensoryProblem(
      503,
      "INTERPRETER_UNAVAILABLE",
      "Sensory interpreter is unavailable; manual taxonomy mapping remains available."
    );
  }

  async findRevisionContext(input: {
    tenantId: string;
    sourceTrialId: string;
    sourceEvaluationId: string;
  }): Promise<FormulaRevisionContext | undefined> {
    const trial = await this.store.findTrial(input.tenantId, input.sourceTrialId);
    const evaluation = trial
      ? await this.store.findEvaluation(
          input.tenantId,
          input.sourceTrialId,
          input.sourceEvaluationId
        )
      : undefined;
    if (
      !trial ||
      !evaluation ||
      trial.status !== "COMPLETED" ||
      evaluation.status !== "FINAL" ||
      evaluation.decision !== "REVISION_REQUIRED"
    ) {
      return undefined;
    }
    const ambientContext =
      evaluation.context.temperatureC == null && evaluation.context.humidityPct == null
        ? undefined
        : {
            ...(evaluation.context.temperatureC == null
              ? {}
              : { temperatureC: evaluation.context.temperatureC }),
            ...(evaluation.context.humidityPct == null
              ? {}
              : { humidityPct: evaluation.context.humidityPct })
          };
    const trialContext = trialContextSchema.parse({
      formulaVersionId: trial.formulaVersionId,
      preparationMode: trial.preparation.preparationMode,
      applicationKey: trial.preparation.applicationKey,
      dosagePct: trial.preparation.dosagePct,
      ...(trial.preparation.carrierOrBaseReference
        ? { carrierOrBaseReference: trial.preparation.carrierOrBaseReference }
        : {}),
      targetMassMg: trial.preparation.targetMassMg,
      evaluationMedium: evaluation.context.evaluationMedium,
      sampleAgeMinutes: evaluation.context.sampleAgeMinutes,
      ...(ambientContext ? { ambientContext } : {})
    });
    return {
      parentFormulaVersionId: trial.formulaVersionId,
      sourceTrialId: trial.id,
      sourceEvaluationId: evaluation.id,
      compositionKind: trial.compositionKind,
      taxonomySource: trial.taxonomySource,
      taxonomyVersion: trial.taxonomyVersion,
      trialContext,
      evaluationText: evaluation.evaluationText,
      confirmedDeltas: evaluation.deltas
        .filter((delta) => delta.confirmedDelta != null)
        .map((delta) => ({
          phase: delta.phase,
          assignmentType: delta.assignmentType,
          taxonomyTerm: delta.taxonomyTerm,
          delta: delta.confirmedDelta!
        }))
    };
  }

  async findApprovalEvidence(input: {
    tenantId: string;
    formulaVersionId: string;
    sourceTrialId: string;
    sourceEvaluationId: string;
  }): Promise<FormulaApprovalEvidence | undefined> {
    const trial = await this.store.findTrial(input.tenantId, input.sourceTrialId);
    const evaluation = trial
      ? await this.store.findEvaluation(
          input.tenantId,
          input.sourceTrialId,
          input.sourceEvaluationId
        )
      : undefined;
    if (
      !trial ||
      !evaluation ||
      trial.formulaVersionId !== input.formulaVersionId ||
      trial.status !== "COMPLETED" ||
      evaluation.status !== "FINAL" ||
      evaluation.decision !== "READY_FOR_APPROVAL" ||
      !evaluation.finalizedAt
    ) {
      return undefined;
    }
    return {
      formulaVersionId: trial.formulaVersionId,
      sourceTrialId: trial.id,
      sourceEvaluationId: evaluation.id,
      compositionKind: trial.compositionKind,
      decision: "READY_FOR_APPROVAL",
      finalizedAt: evaluation.finalizedAt.toISOString(),
      taxonomySource: trial.taxonomySource,
      taxonomyVersion: trial.taxonomyVersion
    };
  }
}
