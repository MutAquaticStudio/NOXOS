export type DesignStudioProblemCode =
  | "HUMAN_CONFIRMATION_REQUIRED"
  | "INVALID_TAXONOMY_TERM"
  | "MATERIAL_INELIGIBLE"
  | "TENANT_ACCESS_DENIED"
  | "DILUTION_RESOLUTION_FAILED"
  | "FORMULA_TOTAL_INVALID"
  | "INVALID_FORMULA_CANDIDATE"
  | "ACCORD_ACTION_NOT_CONFIRMED"
  | "ACCORD_NOT_FOUND"
  | "FORMULA_FROZEN_SNAPSHOT_SCHEMA_MISSING";

export class DesignStudioProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: DesignStudioProblemCode,
    message: string
  ) {
    super(message);
  }
}
