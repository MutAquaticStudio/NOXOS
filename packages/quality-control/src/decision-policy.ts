import type { ProductionReadinessResolution, QualityJudgement } from "./contracts.js";
import { QualityControlProblem } from "./problem.js";

export function inspectionOutcome(judgements: readonly QualityJudgement[]): QualityJudgement {
  if (judgements.includes("FAIL")) return "FAIL";
  if (judgements.includes("REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  return "PASS";
}

export function requireReleaseEligibility(
  inspection: { status: string; outcome: QualityJudgement | null } | undefined,
  readiness: ProductionReadinessResolution
): Extract<ProductionReadinessResolution, { status: "RESOLVED" }> {
  if (!inspection || inspection.status !== "FINAL" || inspection.outcome !== "PASS") {
    throw new QualityControlProblem(
      409,
      "QC_RELEASE_REQUIRES_PASS",
      "Release requires a current FINAL PASS inspection."
    );
  }
  if (readiness.status === "MISSING") {
    throw new QualityControlProblem(
      409,
      "QC_RELEASE_READINESS_MISSING",
      "Current G6 release readiness is missing."
    );
  }
  if (readiness.status === "AMBIGUOUS") {
    throw new QualityControlProblem(
      409,
      "QC_RELEASE_READINESS_AMBIGUOUS",
      "Current G6 release readiness is ambiguous."
    );
  }
  if (readiness.decision !== "READY") {
    throw new QualityControlProblem(
      409,
      "QC_RELEASE_NOT_READY",
      "Formula is not currently G6 READY."
    );
  }
  return readiness;
}
