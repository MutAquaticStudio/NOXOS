import { randomUUID } from "node:crypto";
import type { SensoryEvaluation, Trial, TrialSensoryStore } from "@nox-os/trial-sensory";

function cloneTrial(value: Trial): Trial {
  return {
    ...value,
    preparation: { ...value.preparation },
    lines: value.lines.map((line) => ({ ...line }))
  };
}

function cloneEvaluation(value: SensoryEvaluation): SensoryEvaluation {
  return {
    ...value,
    context: { ...value.context },
    deltas: value.deltas.map((delta) => ({ ...delta }))
  };
}

export class InMemoryTrialSensoryStore implements TrialSensoryStore {
  readonly trials = new Map<string, Trial>();
  readonly evaluations = new Map<string, SensoryEvaluation>();
  readonly auditEvents: Array<{
    action: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }> = [];

  async createTrial(input: Parameters<TrialSensoryStore["createTrial"]>[0]): Promise<Trial> {
    const now = new Date();
    const value: Trial = {
      id: randomUUID(),
      tenantId: input.tenantId,
      formulaVersionId: input.formulaVersionId,
      formulaBundleHash: input.formulaBundleHash,
      compositionKind: input.compositionKind,
      taxonomySource: input.taxonomySource,
      taxonomyVersion: input.taxonomyVersion,
      preparation: { ...input.preparation },
      scalingPolicyVersion: input.scalingPolicyVersion,
      status: "DRAFT",
      createdByUserId: input.actorUserId,
      preparedByUserId: null,
      cancelledByUserId: null,
      createdAt: now,
      updatedAt: now,
      preparedAt: null,
      cancelledAt: null,
      lines: []
    };
    this.trials.set(value.id, value);
    this.auditEvents.push({ action: "trial.created", resourceId: value.id });
    return cloneTrial(value);
  }

  async listTrials(tenantId: string): Promise<Trial[]> {
    return [...this.trials.values()].filter((value) => value.tenantId === tenantId).map(cloneTrial);
  }

  async findTrial(tenantId: string, trialId: string): Promise<Trial | undefined> {
    const value = this.trials.get(trialId);
    return value?.tenantId === tenantId ? cloneTrial(value) : undefined;
  }

  async prepareTrial(
    input: Parameters<TrialSensoryStore["prepareTrial"]>[0]
  ): Promise<Trial | undefined> {
    const value = this.trials.get(input.trialId);
    if (!value || value.tenantId !== input.tenantId || value.status !== "DRAFT") return undefined;
    const next: Trial = {
      ...value,
      status: "PREPARED",
      preparedByUserId: input.actorUserId,
      preparedAt: new Date(),
      updatedAt: new Date(),
      lines: input.lines.map((line) => ({ ...line }))
    };
    this.trials.set(next.id, next);
    this.auditEvents.push({ action: "trial.prepared", resourceId: next.id });
    return cloneTrial(next);
  }

  async cancelTrial(
    input: Parameters<TrialSensoryStore["cancelTrial"]>[0]
  ): Promise<Trial | undefined> {
    const value = this.trials.get(input.trialId);
    if (
      !value ||
      value.tenantId !== input.tenantId ||
      !["DRAFT", "PREPARED"].includes(value.status)
    )
      return undefined;
    const next: Trial = {
      ...value,
      status: "CANCELLED",
      cancelledByUserId: input.actorUserId,
      cancelledAt: new Date(),
      updatedAt: new Date()
    };
    this.trials.set(next.id, next);
    this.auditEvents.push({ action: "trial.cancelled", resourceId: next.id });
    return cloneTrial(next);
  }

  async createEvaluation(
    input: Parameters<TrialSensoryStore["createEvaluation"]>[0]
  ): Promise<SensoryEvaluation> {
    const existing = [...this.evaluations.values()].find(
      (value) => value.tenantId === input.tenantId && value.trialId === input.trialId
    );
    if (existing) throw new Error("EVALUATION_ALREADY_EXISTS");
    const now = new Date();
    const value: SensoryEvaluation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      trialId: input.trialId,
      status: "DRAFT",
      context: { ...input.context },
      evaluationText: input.evaluationText,
      diagnosticNote: input.diagnosticNote,
      decision: null,
      evaluatedByUserId: input.actorUserId,
      finalizedByUserId: null,
      createdAt: now,
      updatedAt: now,
      finalizedAt: null,
      deltas: []
    };
    this.evaluations.set(value.id, value);
    this.auditEvents.push({ action: "evaluation.created", resourceId: value.id });
    return cloneEvaluation(value);
  }

  async findEvaluation(
    tenantId: string,
    trialId: string,
    evaluationId: string
  ): Promise<SensoryEvaluation | undefined> {
    const value = this.evaluations.get(evaluationId);
    return value?.tenantId === tenantId && value.trialId === trialId
      ? cloneEvaluation(value)
      : undefined;
  }

  async findEvaluationForTrial(
    tenantId: string,
    trialId: string
  ): Promise<SensoryEvaluation | undefined> {
    const value = [...this.evaluations.values()].find(
      (item) => item.tenantId === tenantId && item.trialId === trialId
    );
    return value ? cloneEvaluation(value) : undefined;
  }

  async updateDraftEvaluation(
    input: Parameters<TrialSensoryStore["updateDraftEvaluation"]>[0]
  ): Promise<SensoryEvaluation | undefined> {
    const value = this.evaluations.get(input.evaluationId);
    if (
      !value ||
      value.tenantId !== input.tenantId ||
      value.trialId !== input.trialId ||
      value.status !== "DRAFT"
    )
      return undefined;
    const next: SensoryEvaluation = {
      ...value,
      context: { ...input.context },
      evaluationText: input.evaluationText,
      diagnosticNote: input.diagnosticNote,
      deltas: input.deltas.map((delta) => ({
        ...delta,
        proposedDelta: delta.proposedDelta ?? null,
        confirmedDelta: delta.confirmedDelta ?? null,
        proposalConfidence: delta.proposalConfidence ?? null,
        interpreterVersion: delta.interpreterVersion ?? null,
        confirmedAt: delta.confirmedDelta == null ? null : new Date()
      })),
      updatedAt: new Date()
    };
    this.evaluations.set(next.id, next);
    this.auditEvents.push({ action: "evaluation.updated", resourceId: next.id });
    return cloneEvaluation(next);
  }

  async finalizeEvaluation(
    input: Parameters<TrialSensoryStore["finalizeEvaluation"]>[0]
  ): Promise<SensoryEvaluation | undefined> {
    const value = this.evaluations.get(input.evaluationId);
    const trial = this.trials.get(input.trialId);
    if (!value || !trial || value.status !== "DRAFT" || trial.status !== "PREPARED")
      return undefined;
    const now = new Date();
    const next: SensoryEvaluation = {
      ...value,
      status: "FINAL",
      decision: input.decision,
      finalizedByUserId: input.actorUserId,
      finalizedAt: now,
      updatedAt: now,
      deltas: input.deltas.map((delta) => ({
        ...delta,
        proposedDelta: delta.proposedDelta ?? null,
        confirmedDelta: delta.confirmedDelta ?? null,
        proposalConfidence: delta.proposalConfidence ?? null,
        interpreterVersion: delta.interpreterVersion ?? null,
        confirmedAt: now
      }))
    };
    this.evaluations.set(next.id, next);
    this.trials.set(trial.id, { ...trial, status: "COMPLETED", updatedAt: now });
    this.auditEvents.push({ action: "evaluation.finalized", resourceId: next.id });
    return cloneEvaluation(next);
  }

  async recordAudit(input: Parameters<TrialSensoryStore["recordAudit"]>[0]): Promise<void> {
    this.auditEvents.push({
      action: input.action,
      resourceId: input.resourceId,
      metadata: input.metadata
    });
  }
}
