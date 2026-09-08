import {
  ReleaseReadinessProblem,
  type ReleaseAssessment,
  type ReleaseReadinessStore
} from "@nox-os/release-readiness";

export class InMemoryReleaseReadinessStore implements ReleaseReadinessStore {
  readonly assessments = new Map<string, ReleaseAssessment>();
  readonly auditActions: string[] = [];
  private sequence = 1;
  private readonly commands = new Map<string, { intent: string; result: ReleaseAssessment }>();

  async listAssessments(tenantId: string): Promise<ReleaseAssessment[]> {
    return [...this.assessments.values()]
      .filter((item) => item.tenantId === tenantId)
      .map((item) => structuredClone(item));
  }

  async findAssessment(
    tenantId: string,
    assessmentId: string
  ): Promise<ReleaseAssessment | undefined> {
    const value = this.assessments.get(assessmentId);
    return value?.tenantId === tenantId ? structuredClone(value) : undefined;
  }

  async createFinalAssessment(
    input: Parameters<ReleaseReadinessStore["createFinalAssessment"]>[0]
  ): Promise<ReleaseAssessment> {
    const key =
      input.context.idempotencyKey &&
      JSON.stringify([
        input.context.tenantId,
        input.context.actorUserId,
        input.context.idempotencyKey
      ]);
    const profile = input.releaseProfile;
    const intent = JSON.stringify([
      profile.formulaVersionId,
      profile.applicationKey,
      profile.dosagePct,
      profile.policyKey,
      input.supersedesAssessmentId
    ]);
    const prior = key && this.commands.get(key);
    if (prior) {
      if (prior.intent !== intent)
        throw new ReleaseReadinessProblem(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Command key payload changed."
        );
      return structuredClone(prior.result);
    }
    const suffix = String(this.sequence++).padStart(12, "0");
    const now = new Date(`2026-09-01T00:00:${suffix.slice(-2)}.000Z`);
    const value: ReleaseAssessment = {
      id: `96000000-0000-4000-8000-${suffix}`,
      tenantId: input.context.tenantId,
      formulaVersionId: input.formulaVersionId,
      formulaBundleHash: input.formulaBundleHash,
      policyKey: "g6-known-limit-v1",
      policyVersion: "1",
      releaseProfile: structuredClone(input.releaseProfile),
      evidenceSnapshot: structuredClone(input.evidenceSnapshot),
      decision: input.decision,
      createdByUserId: input.context.actorUserId,
      assessedByUserId: input.context.actorUserId,
      supersedesAssessmentId: input.supersedesAssessmentId,
      createdAt: now,
      assessedAt: now,
      checks: structuredClone(input.checks)
    };
    this.assessments.set(value.id, value);
    this.auditActions.push(input.auditAction);
    if (key) this.commands.set(key, { intent, result: structuredClone(value) });
    return structuredClone(value);
  }
}
