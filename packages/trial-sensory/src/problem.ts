import type { ErrorCode } from "@nox-os/contracts";

export type TrialSensoryProblemCode = Extract<
  ErrorCode,
  | "FORMULA_VERSION_NOT_FROZEN"
  | "UNSUPPORTED_COMPOSITION_KIND"
  | "TRIAL_NOT_FOUND"
  | "TRIAL_ALREADY_PREPARED"
  | "TRIAL_NOT_PREPARED"
  | "TRIAL_ALREADY_COMPLETED"
  | "TRIAL_CANCELLED"
  | "FORMULA_TOTAL_INVALID"
  | "BELOW_WEIGHABLE_RESOLUTION"
  | "EVALUATION_NOT_FOUND"
  | "EVALUATION_ALREADY_FINAL"
  | "EVALUATION_NOT_FINAL"
  | "INVALID_SENSORY_DELTA"
  | "INVALID_TAXONOMY_TERM"
  | "INTERPRETER_UNAVAILABLE"
  | "REVISION_NOT_ALLOWED"
  | "REVISION_CONTEXT_INVALID"
  | "APPROVAL_EVIDENCE_REQUIRED"
  | "APPROVAL_EVIDENCE_INVALID"
  | "PERMISSION_DENIED"
  | "TENANT_ACCESS_DENIED"
>;

export class TrialSensoryProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: TrialSensoryProblemCode,
    message: string
  ) {
    super(message);
  }
}
