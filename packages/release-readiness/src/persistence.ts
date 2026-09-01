import type { FrozenFormulaVersion } from "@nox-os/design-studio";
import type {
  ApprovalTraceEvidence,
  RegulatoryEvidenceSnapshot,
  ReleaseAssessment,
  ReleaseCheckResult,
  ReleaseDecision,
  ReleaseProfile
} from "./contracts.js";

export type ReleaseCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

export interface ReleaseFormulaSource {
  findFrozenFormulaVersion(
    tenantId: string,
    formulaVersionId: string
  ): Promise<FrozenFormulaVersion | undefined>;
}

export interface RegulatoryEvidenceResolver {
  resolve(input: {
    tenantId: string;
    formula: FrozenFormulaVersion;
  }): Promise<RegulatoryEvidenceSnapshot>;
}

export interface ApprovalTraceResolver {
  resolveApprovalTrace(input: {
    tenantId: string;
    formulaVersionId: string;
  }): Promise<ApprovalTraceEvidence>;
}

export interface ReleaseReadinessStore {
  listAssessments(tenantId: string): Promise<ReleaseAssessment[]>;
  findAssessment(tenantId: string, assessmentId: string): Promise<ReleaseAssessment | undefined>;
  createFinalAssessment(input: {
    context: ReleaseCommandContext;
    formulaVersionId: string;
    formulaBundleHash: string;
    releaseProfile: ReleaseProfile;
    evidenceSnapshot: RegulatoryEvidenceSnapshot;
    decision: ReleaseDecision;
    checks: readonly ReleaseCheckResult[];
    supersedesAssessmentId: string | null;
    auditAction: "release-readiness.assessed" | "release-readiness.reassessed";
  }): Promise<ReleaseAssessment>;
}
