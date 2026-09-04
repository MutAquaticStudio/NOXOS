import type { QualityControlErrorCode } from "./contracts.js";

export class QualityControlProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: QualityControlErrorCode,
    message: string
  ) {
    super(message);
  }
}
