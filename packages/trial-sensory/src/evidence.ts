import type { SensoryEvaluation, Trial } from "./contracts.js";

/** Shared by G5 readers and the database's commit-time G4/G5 seam. */
export function isFinalTrialEvidence(
  trial: Pick<Trial, "id" | "tenantId" | "status" | "formulaVersionId">,
  evaluation: Pick<
    SensoryEvaluation,
    "tenantId" | "trialId" | "status" | "decision" | "finalizedAt"
  >,
  decision: "READY_FOR_APPROVAL" | "REVISION_REQUIRED",
  formulaVersionId = trial.formulaVersionId
): boolean {
  return (
    trial.status === "COMPLETED" &&
    trial.formulaVersionId === formulaVersionId &&
    evaluation.tenantId === trial.tenantId &&
    evaluation.trialId === trial.id &&
    evaluation.status === "FINAL" &&
    evaluation.decision === decision &&
    evaluation.finalizedAt != null
  );
}
