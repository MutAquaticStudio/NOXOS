import type { ErrorCode } from "@nox-os/contracts";

export type InventoryProblemCode = Extract<
  ErrorCode,
  | "MATERIAL_NOT_FOUND"
  | "MATERIAL_ACCESS_DENIED"
  | "LOCATION_NOT_FOUND"
  | "LOCATION_ARCHIVED"
  | "LOCATION_NOT_EMPTY"
  | "LOT_NOT_FOUND"
  | "LOT_CLOSED"
  | "LOT_ON_HOLD"
  | "LOT_EXPIRED"
  | "LOT_IDENTITY_IMMUTABLE"
  | "LOT_NOT_EMPTY"
  | "INSUFFICIENT_STOCK"
  | "INSUFFICIENT_AVAILABLE_STOCK"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_NOT_ACTIVE"
  | "RESERVATION_ALREADY_TERMINAL"
  | "RESERVATION_EXCEEDS_AVAILABLE_STOCK"
  | "INVALID_MOVEMENT"
  | "INVALID_MOVEMENT_DIRECTION"
  | "INVALID_QUANTITY"
  | "IDEMPOTENCY_CONFLICT"
  | "TENANT_ACCESS_DENIED"
  | "PERMISSION_DENIED"
>;

export class InventoryProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: InventoryProblemCode,
    message: string
  ) {
    super(message);
  }
}
