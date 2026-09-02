import type { ProductionErrorCode } from "./contracts.js";
export class ProductionProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ProductionErrorCode,
    message: string
  ) {
    super(message);
  }
}
