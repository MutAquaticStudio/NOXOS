import { z } from "zod";

export const RELEASE_READINESS_POLICY_KEY = "g6-known-limit-v1" as const;
export const RELEASE_READINESS_POLICY_VERSION = "1" as const;

export const releaseDecisionSchema = z.enum(["READY", "REVIEW_REQUIRED", "BLOCKED"]);
export type ReleaseDecision = z.infer<typeof releaseDecisionSchema>;

export const releaseCheckResultSchema = z.enum(["PASS", "REVIEW", "BLOCK"]);
export type ReleaseCheckResultValue = z.infer<typeof releaseCheckResultSchema>;

export const releaseProfileSchema = z.object({
  formulaVersionId: z.string().uuid(),
  applicationKey: z.string().trim().min(1).max(120),
  dosagePct: z.number().finite().positive().max(100),
  policyKey: z.literal(RELEASE_READINESS_POLICY_KEY)
});
export type ReleaseProfile = z.infer<typeof releaseProfileSchema>;

export type ApprovalTraceEvidence = {
  verified: boolean;
  sourceTrialId: string | null;
  sourceEvaluationId: string | null;
  decision: "READY_FOR_APPROVAL" | null;
  finalizedAt: string | null;
};

export type RegulatoryMaterialEvidence = {
  materialId: string;
  displayName: string;
  materialType: string;
  approvalStatus: string;
  tenantAccessible: boolean;
  frozenSnapshotHash: string;
  frozenSourceMaterialUpdatedAt: string;
  currentSourceMaterialUpdatedAt: string;
  activeAromaticMassMg: string;
  carrierSolventMassMg: string;
  ifraRestricted: boolean;
  ifraCat4MaxPct: string | number | null;
  ifraLimits: Record<string, string | number | boolean | null>;
  ifraAmendment: string | null;
  ifraSourceReference: string | null;
  sourceReference: string | null;
  euAllergens: readonly unknown[];
};

export type RegulatoryEvidenceSnapshot = {
  resolvedAt: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  compositionKind: string;
  formulaStatus: string;
  approvalState: string;
  referenceFormulaMassMg: string;
  formulaLineCount: number;
  approvalTrace: ApprovalTraceEvidence;
  materials: readonly RegulatoryMaterialEvidence[];
};

export type ReleaseCheckResult = {
  checkKey: string;
  subjectType: "FORMULA" | "MATERIAL";
  materialId: string | null;
  result: ReleaseCheckResultValue;
  evidence: Record<string, unknown>;
  message: string;
};

export type ReleaseAssessment = {
  id: string;
  tenantId: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  policyKey: typeof RELEASE_READINESS_POLICY_KEY;
  policyVersion: typeof RELEASE_READINESS_POLICY_VERSION;
  releaseProfile: ReleaseProfile;
  evidenceSnapshot: RegulatoryEvidenceSnapshot;
  decision: ReleaseDecision;
  createdByUserId: string;
  assessedByUserId: string;
  supersedesAssessmentId: string | null;
  createdAt: Date;
  assessedAt: Date;
  checks: readonly ReleaseCheckResult[];
};

export type ReleaseAssessmentInput = {
  profile: ReleaseProfile;
  evidence: RegulatoryEvidenceSnapshot;
};

export interface ReleaseReadinessPolicy {
  readonly key: string;
  readonly version: string;
  evaluate(input: ReleaseAssessmentInput): ReleaseCheckResult[];
}

export function aggregateReleaseDecision(checks: readonly ReleaseCheckResult[]): ReleaseDecision {
  if (checks.some((check) => check.result === "BLOCK")) return "BLOCKED";
  if (checks.some((check) => check.result === "REVIEW")) return "REVIEW_REQUIRED";
  return "READY";
}
