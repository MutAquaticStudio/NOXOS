import { z } from "zod";

export const quantityMgSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/, "Quantity must be a positive integer milligram string.");
export type QuantityMg = z.infer<typeof quantityMgSchema>;

export const locationStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export type LocationStatus = z.infer<typeof locationStatusSchema>;

export const lotLifecycleStatusSchema = z.enum(["OPEN", "CLOSED"]);
export type LotLifecycleStatus = z.infer<typeof lotLifecycleStatusSchema>;

export const lotAvailabilityStatusSchema = z.enum(["AVAILABLE", "HOLD"]);
export type LotAvailabilityStatus = z.infer<typeof lotAvailabilityStatusSchema>;

export const movementTypeSchema = z.enum([
  "RECEIPT",
  "TRANSFER",
  "CONSUMPTION",
  "RETURN_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "DISPOSAL"
]);
export type MovementType = z.infer<typeof movementTypeSchema>;

export const movementSourceModuleSchema = z.enum(["MANUAL", "TRIAL", "PROCUREMENT", "PRODUCTION"]);
export type MovementSourceModule = z.infer<typeof movementSourceModuleSchema>;

export const reservationSourceModuleSchema = z.enum(["MANUAL", "TRIAL", "PRODUCTION"]);
export type ReservationSourceModule = z.infer<typeof reservationSourceModuleSchema>;

export const reservationStatusSchema = z.enum(["ACTIVE", "RELEASED", "CONSUMED", "CANCELLED"]);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

const operationKeySchema = z.string().trim().min(1).max(240);
const uuid = z.string().uuid();
const nullableTimestamp = z.string().datetime({ offset: true }).nullable().optional();

export const createLocationSchema = z
  .object({
    locationCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).nullable().optional()
  })
  .strict();
export type CreateLocationRequest = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object({
    locationCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/)
      .optional(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one location field is required.");
export type UpdateLocationRequest = z.infer<typeof updateLocationSchema>;

export const createLotSchema = z
  .object({
    materialId: uuid,
    lotCode: z.string().trim().min(1).max(120),
    supplierLotCode: z.string().trim().max(120).nullable().optional(),
    manufacturedAt: nullableTimestamp,
    expiresAt: nullableTimestamp,
    retestAt: nullableTimestamp,
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict();
export type CreateLotRequest = z.infer<typeof createLotSchema>;

export const updateLotSchema = z
  .object({
    materialId: uuid.optional(),
    lotCode: z.string().trim().min(1).max(120).optional(),
    supplierLotCode: z.string().trim().max(120).nullable().optional(),
    manufacturedAt: nullableTimestamp,
    expiresAt: nullableTimestamp,
    retestAt: nullableTimestamp,
    notes: z.string().trim().max(4000).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one lot field is required.");
export type UpdateLotRequest = z.infer<typeof updateLotSchema>;

export const movementCommandSchema = z
  .object({
    movementType: movementTypeSchema,
    quantityMg: quantityMgSchema,
    fromLocationId: uuid.nullable().optional(),
    toLocationId: uuid.nullable().optional(),
    reasonCode: z.string().trim().max(120).nullable().optional(),
    operationKey: operationKeySchema
  })
  .strict();
export type MovementCommandRequest = z.infer<typeof movementCommandSchema>;

export const createReservationSchema = z
  .object({
    locationId: uuid,
    quantityMg: quantityMgSchema,
    sourceReferenceId: z.string().trim().max(240).nullable().optional(),
    operationKey: operationKeySchema
  })
  .strict();
export type CreateReservationRequest = z.infer<typeof createReservationSchema>;

export const reservationTransitionSchema = z.object({ operationKey: operationKeySchema }).strict();
export type ReservationTransitionRequest = z.infer<typeof reservationTransitionSchema>;

export type InventoryLocation = {
  id: string;
  tenantId: string;
  locationCode: string;
  name: string;
  description: string | null;
  status: LocationStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type InventoryBalance = {
  lotId: string;
  locationId: string;
  onHandMg: QuantityMg | "0";
  reservedMg: QuantityMg | "0";
  availableMg: QuantityMg | "0";
};

export type MaterialLot = {
  id: string;
  tenantId: string;
  materialId: string;
  materialDisplayName: string;
  materialApprovalStatus: "PENDING_REVIEW" | "APPROVED";
  lotCode: string;
  supplierLotCode: string | null;
  manufacturedAt: Date | null;
  expiresAt: Date | null;
  retestAt: Date | null;
  lifecycleStatus: LotLifecycleStatus;
  availabilityStatus: LotAvailabilityStatus;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  lastMovementAt: Date | null;
  closedAt: Date | null;
  closedByUserId: string | null;
  balances: readonly InventoryBalance[];
};

export type StockMovement = {
  id: string;
  tenantId: string;
  lotId: string;
  materialId: string;
  movementType: MovementType;
  quantityMg: QuantityMg;
  fromLocationId: string | null;
  toLocationId: string | null;
  sourceModule: MovementSourceModule;
  sourceReferenceId: string | null;
  reasonCode: string | null;
  operationKey: string;
  createdByUserId: string;
  createdAt: Date;
};

export type StockReservation = {
  id: string;
  tenantId: string;
  lotId: string;
  materialId: string;
  locationId: string;
  quantityMg: QuantityMg;
  sourceModule: ReservationSourceModule;
  sourceReferenceId: string | null;
  operationKey: string;
  status: ReservationStatus;
  createdByUserId: string;
  createdAt: Date;
  releasedAt: Date | null;
  consumedAt: Date | null;
  cancelledAt: Date | null;
  consumedMovementId: string | null;
};

export type InventoryMaterialReference = {
  materialId: string;
  displayName: string;
  materialType: "SINGLE_MOLECULE" | "NATURAL" | "MIXTURE" | "DILUTION";
  approvalStatus: "PENDING_REVIEW" | "APPROVED";
  tenantAccessible: true;
};

export type InventoryCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

export type InventoryTrace = {
  trialId: string;
  movements: readonly StockMovement[];
};
