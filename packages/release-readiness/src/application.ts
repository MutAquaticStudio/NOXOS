import type { FrozenFormulaVersion } from "@nox-os/design-studio";
import {
  RELEASE_READINESS_POLICY_KEY,
  RELEASE_READINESS_POLICY_VERSION,
  aggregateReleaseDecision,
  type ReleaseAssessment,
  type ReleaseProfile,
  type ReleaseReadinessPolicy
} from "./contracts.js";
import type {
  ApprovalTraceResolver,
  RegulatoryEvidenceResolver,
  ReleaseCommandContext,
  ReleaseFormulaSource,
  ReleaseReadinessStore
} from "./persistence.js";
import { ReleaseReadinessProblem } from "./problem.js";

function assertEligible(
  formula: FrozenFormulaVersion | undefined
): asserts formula is FrozenFormulaVersion {
  if (!formula) {
    throw new ReleaseReadinessProblem(404, "NOT_FOUND", "FormulaVersion was not found.");
  }
  if (formula.status !== "FROZEN") {
    throw new ReleaseReadinessProblem(
      409,
      "FORMULA_VERSION_NOT_FROZEN",
      "Release assessment requires a FROZEN FormulaVersion."
    );
  }
  if (formula.compositionKind !== "FULL_FORMULA") {
    throw new ReleaseReadinessProblem(
      409,
      "UNSUPPORTED_COMPOSITION_KIND",
      "Release assessment accepts only FULL_FORMULA composition."
    );
  }
  if (formula.approvalState !== "APPROVED") {
    throw new ReleaseReadinessProblem(
      409,
      "APPROVAL_EVIDENCE_REQUIRED",
      "Release assessment requires an APPROVED FormulaVersion."
    );
  }
  if (!/^[a-f0-9]{64}$/.test(formula.bundleHash) || formula.candidate.lines.length === 0) {
    throw new ReleaseReadinessProblem(
      409,
      "FORMULA_VERSION_NOT_FROZEN",
      "Frozen Formula bundle lineage is incomplete."
    );
  }
}

export class ReleaseReadinessApplication {
  constructor(
    readonly store: ReleaseReadinessStore,
    private readonly formulas: ReleaseFormulaSource,
    private readonly regulatoryEvidence: RegulatoryEvidenceResolver,
    private readonly approvalTrace: ApprovalTraceResolver,
    private readonly policy: ReleaseReadinessPolicy
  ) {
    if (
      policy.key !== RELEASE_READINESS_POLICY_KEY ||
      policy.version !== RELEASE_READINESS_POLICY_VERSION
    ) {
      throw new Error("UNSUPPORTED_RELEASE_READINESS_POLICY");
    }
  }

  list(tenantId: string): Promise<ReleaseAssessment[]> {
    return this.store.listAssessments(tenantId);
  }

  async requireAssessment(tenantId: string, assessmentId: string): Promise<ReleaseAssessment> {
    const assessment = await this.store.findAssessment(tenantId, assessmentId);
    if (!assessment)
      throw new ReleaseReadinessProblem(404, "NOT_FOUND", "Release assessment was not found.");
    return assessment;
  }

  async assess(
    context: ReleaseCommandContext,
    profile: ReleaseProfile,
    supersedesAssessmentId: string | null = null
  ): Promise<ReleaseAssessment> {
    const formula = await this.formulas.findFrozenFormulaVersion(
      context.tenantId,
      profile.formulaVersionId
    );
    assertEligible(formula);

    if (supersedesAssessmentId) {
      const previous = await this.requireAssessment(context.tenantId, supersedesAssessmentId);
      if (previous.formulaVersionId !== formula.formulaVersionId) {
        throw new ReleaseReadinessProblem(
          404,
          "NOT_FOUND",
          "Assessment lineage does not match the FormulaVersion."
        );
      }
    }

    const [snapshot, trace] = await Promise.all([
      this.regulatoryEvidence.resolve({ tenantId: context.tenantId, formula }),
      this.approvalTrace.resolveApprovalTrace({
        tenantId: context.tenantId,
        formulaVersionId: formula.formulaVersionId
      })
    ]);
    const evidence = { ...snapshot, approvalTrace: trace };
    const checks = this.policy.evaluate({ profile, evidence });
    const decision = aggregateReleaseDecision(checks);
    return this.store.createFinalAssessment({
      context,
      formulaVersionId: formula.formulaVersionId,
      formulaBundleHash: formula.bundleHash,
      releaseProfile: profile,
      evidenceSnapshot: evidence,
      decision,
      checks,
      supersedesAssessmentId,
      auditAction: supersedesAssessmentId
        ? "release-readiness.reassessed"
        : "release-readiness.assessed"
    });
  }

  async reassess(context: ReleaseCommandContext, assessmentId: string): Promise<ReleaseAssessment> {
    const previous = await this.requireAssessment(context.tenantId, assessmentId);
    return this.assess(context, previous.releaseProfile, previous.id);
  }
}
