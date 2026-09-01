import type {
  CreateLocationRequest,
  CreateLotRequest,
  CreateReservationRequest,
  InventoryCommandContext,
  InventoryLocation,
  InventoryTrace,
  MaterialLot,
  MovementCommandRequest,
  StockMovement,
  StockReservation,
  UpdateLocationRequest,
  UpdateLotRequest
} from "./contracts.js";
import type { InventoryMaterialSource, InventoryStore } from "./persistence.js";
import { InventoryProblem } from "./problem.js";

function date(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value);
}

export class InventoryApplication {
  constructor(
    readonly store: InventoryStore,
    private readonly materials: InventoryMaterialSource
  ) {}

  listLocations(tenantId: string): Promise<InventoryLocation[]> {
    return this.store.listLocations(tenantId);
  }

  createLocation(context: InventoryCommandContext, input: CreateLocationRequest) {
    return this.store.createLocation({
      ...context,
      locationCode: input.locationCode,
      name: input.name,
      description: input.description ?? null
    });
  }

  async updateLocation(
    context: InventoryCommandContext,
    locationId: string,
    input: UpdateLocationRequest
  ): Promise<InventoryLocation> {
    const value = await this.store.updateLocation({ ...context, locationId, ...input });
    if (!value) throw new InventoryProblem(404, "LOCATION_NOT_FOUND", "Location was not found.");
    return value;
  }

  archiveLocation(context: InventoryCommandContext, locationId: string) {
    return this.store.archiveLocation({ ...context, locationId });
  }

  listLots(tenantId: string): Promise<MaterialLot[]> {
    return this.store.listLots(tenantId);
  }

  async requireLot(tenantId: string, lotId: string): Promise<MaterialLot> {
    const value = await this.store.findLot(tenantId, lotId);
    if (!value) throw new InventoryProblem(404, "LOT_NOT_FOUND", "Material Lot was not found.");
    return value;
  }

  async createLot(context: InventoryCommandContext, input: CreateLotRequest): Promise<MaterialLot> {
    const material = await this.materials.findTenantAccessibleMaterial(
      context.tenantId,
      input.materialId
    );
    if (!material)
      throw new InventoryProblem(
        404,
        "MATERIAL_NOT_FOUND",
        "Tenant-accessible Material not found."
      );
    return this.store.createLot({
      ...context,
      material,
      lotCode: input.lotCode,
      supplierLotCode: input.supplierLotCode ?? null,
      manufacturedAt: date(input.manufacturedAt) ?? null,
      expiresAt: date(input.expiresAt) ?? null,
      retestAt: date(input.retestAt) ?? null,
      notes: input.notes ?? null
    });
  }

  async updateLot(
    context: InventoryCommandContext,
    lotId: string,
    input: UpdateLotRequest
  ): Promise<MaterialLot> {
    const material = input.materialId
      ? await this.materials.findTenantAccessibleMaterial(context.tenantId, input.materialId)
      : undefined;
    if (input.materialId && !material)
      throw new InventoryProblem(
        404,
        "MATERIAL_NOT_FOUND",
        "Tenant-accessible Material not found."
      );
    return this.store.updateLot({
      ...context,
      lotId,
      ...(material ? { material } : {}),
      ...(input.lotCode === undefined ? {} : { lotCode: input.lotCode }),
      ...(input.supplierLotCode === undefined ? {} : { supplierLotCode: input.supplierLotCode }),
      ...(input.manufacturedAt === undefined ? {} : { manufacturedAt: date(input.manufacturedAt) }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: date(input.expiresAt) }),
      ...(input.retestAt === undefined ? {} : { retestAt: date(input.retestAt) }),
      ...(input.notes === undefined ? {} : { notes: input.notes })
    });
  }

  setLotHold(context: InventoryCommandContext, lotId: string, hold: boolean) {
    return this.store.setLotHold({ ...context, lotId, hold });
  }

  closeLot(context: InventoryCommandContext, lotId: string) {
    return this.store.closeLot({ ...context, lotId });
  }

  createMovement(
    context: InventoryCommandContext,
    lotId: string,
    input: MovementCommandRequest
  ): Promise<StockMovement> {
    return this.store.createManualMovement({
      ...context,
      lotId,
      movementType: input.movementType,
      quantityMg: input.quantityMg,
      fromLocationId: input.fromLocationId ?? null,
      toLocationId: input.toLocationId ?? null,
      reasonCode: input.reasonCode ?? null,
      operationKey: input.operationKey
    });
  }

  listLotMovements(tenantId: string, lotId: string) {
    return this.store.listLotMovements(tenantId, lotId);
  }

  createReservation(
    context: InventoryCommandContext,
    lotId: string,
    input: CreateReservationRequest
  ): Promise<StockReservation> {
    return this.store.createManualReservation({
      ...context,
      lotId,
      locationId: input.locationId,
      quantityMg: input.quantityMg,
      sourceReferenceId: input.sourceReferenceId ?? null,
      operationKey: input.operationKey
    });
  }

  transitionReservation(
    context: InventoryCommandContext,
    reservationId: string,
    transition: "RELEASED" | "CANCELLED" | "CONSUMED",
    operationKey: string
  ) {
    return this.store.transitionManualReservation({
      ...context,
      reservationId,
      transition,
      operationKey
    });
  }

  listLotReservations(tenantId: string, lotId: string) {
    return this.store.listLotReservations(tenantId, lotId);
  }

  traceTrial(tenantId: string, trialId: string): Promise<InventoryTrace> {
    return this.store.traceTrial(tenantId, trialId);
  }
}
