import type {
  InventoryCommandContext,
  InventoryLocation,
  InventoryMaterialReference,
  InventoryTrace,
  MaterialLot,
  MovementType,
  QuantityMg,
  StockMovement,
  StockReservation
} from "./contracts.js";

export interface InventoryMaterialSource {
  findTenantAccessibleMaterial(
    tenantId: string,
    materialId: string
  ): Promise<InventoryMaterialReference | undefined>;
}

export interface InventoryStore {
  listLocations(tenantId: string): Promise<InventoryLocation[]>;
  createLocation(
    input: InventoryCommandContext & {
      locationCode: string;
      name: string;
      description: string | null;
    }
  ): Promise<InventoryLocation>;
  updateLocation(
    input: InventoryCommandContext & {
      locationId: string;
      locationCode?: string;
      name?: string;
      description?: string | null;
    }
  ): Promise<InventoryLocation | undefined>;
  archiveLocation(
    input: InventoryCommandContext & { locationId: string }
  ): Promise<InventoryLocation>;

  listLots(tenantId: string): Promise<MaterialLot[]>;
  findLot(tenantId: string, lotId: string): Promise<MaterialLot | undefined>;
  createLot(
    input: InventoryCommandContext & {
      material: InventoryMaterialReference;
      lotCode: string;
      supplierLotCode: string | null;
      manufacturedAt: Date | null;
      expiresAt: Date | null;
      retestAt: Date | null;
      notes: string | null;
    }
  ): Promise<MaterialLot>;
  updateLot(
    input: InventoryCommandContext & {
      lotId: string;
      material?: InventoryMaterialReference;
      lotCode?: string;
      supplierLotCode?: string | null;
      manufacturedAt?: Date | null;
      expiresAt?: Date | null;
      retestAt?: Date | null;
      notes?: string | null;
    }
  ): Promise<MaterialLot>;
  setLotHold(
    input: InventoryCommandContext & { lotId: string; hold: boolean }
  ): Promise<MaterialLot>;
  closeLot(input: InventoryCommandContext & { lotId: string }): Promise<MaterialLot>;

  createManualMovement(
    input: InventoryCommandContext & {
      lotId: string;
      movementType: MovementType;
      quantityMg: QuantityMg;
      fromLocationId: string | null;
      toLocationId: string | null;
      reasonCode: string | null;
      operationKey: string;
    }
  ): Promise<StockMovement>;
  listLotMovements(tenantId: string, lotId: string): Promise<StockMovement[]>;

  createManualReservation(
    input: InventoryCommandContext & {
      lotId: string;
      locationId: string;
      quantityMg: QuantityMg;
      sourceReferenceId: string | null;
      operationKey: string;
    }
  ): Promise<StockReservation>;
  transitionManualReservation(
    input: InventoryCommandContext & {
      reservationId: string;
      transition: "RELEASED" | "CANCELLED" | "CONSUMED";
      operationKey: string;
    }
  ): Promise<StockReservation>;
  listLotReservations(tenantId: string, lotId: string): Promise<StockReservation[]>;
  traceTrial(tenantId: string, trialId: string): Promise<InventoryTrace>;
}

export interface InventoryReceiptPort {
  receiveProcurementLot(input: {
    context: InventoryCommandContext;
    procurementReceiptId: string;
    materialId: string;
    lotCode: string;
    supplierLotCode?: string | null;
    manufacturedAt?: Date | null;
    expiresAt?: Date | null;
    retestAt?: Date | null;
    locationId: string;
    quantityMg: QuantityMg;
    operationKey: string;
  }): Promise<StockMovement>;
}

export interface ProductionInventoryPort {
  getLotAvailability(input: { tenantId: string; materialId: string }): Promise<MaterialLot[]>;
  reserveLot(input: unknown): Promise<StockReservation>;
  releaseReservation(input: unknown): Promise<StockReservation>;
  consumeReservation(input: unknown): Promise<StockReservation>;
}
