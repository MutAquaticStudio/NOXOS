import type { ErrorCode } from "@nox-os/contracts";

export type ReleaseReadinessProblemCode = Extract<
  ErrorCode,
  | "FORMULA_VERSION_NOT_FROZEN"
  | "UNSUPPORTED_COMPOSITION_KIND"
  | "APPROVAL_EVIDENCE_REQUIRED"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "TENANT_ACCESS_DENIED"
>;

export class ReleaseReadinessProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ReleaseReadinessProblemCode,
    message: string
  ) {
    super(message);
  }
}
