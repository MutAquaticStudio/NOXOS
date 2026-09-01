export type BrowserReleaseAssessment = {
  id: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  policyKey: string;
  policyVersion: string;
  releaseProfile: {
    formulaVersionId: string;
    applicationKey: string;
    dosagePct: number;
    policyKey: string;
  };
  evidenceSnapshot: {
    approvalState: string;
    approvalTrace: { verified: boolean };
  };
  decision: "READY" | "REVIEW_REQUIRED" | "BLOCKED";
  supersedesAssessmentId: string | null;
  assessedAt: string;
  checks: Array<{
    checkKey: string;
    subjectType: "FORMULA" | "MATERIAL";
    materialId: string | null;
    result: "PASS" | "REVIEW" | "BLOCK";
    evidence: Record<string, unknown>;
    message: string;
  }>;
};
