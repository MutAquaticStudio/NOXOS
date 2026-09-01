import type { Sql, TransactionSql } from "postgres";
import {
  InventoryProblem,
  type InventoryBalance,
  type InventoryCommandContext,
  type InventoryLocation,
  type InventoryMaterialReference,
  type InventoryMaterialSource,
  type InventoryReceiptPort,
  type InventoryStore,
  type InventoryTrace,
  type MaterialLot,
  type MovementSourceModule,
  type MovementType,
  type ProductionInventoryPort,
  type QuantityMg,
  type StockMovement,
  type StockReservation
} from "@nox-os/inventory";
import { canReadMaterial } from "@nox-os/material-intelligence";
import type {
  TrialInventoryAvailability,
  TrialInventoryPort,
  TrialInventoryReservationSet,
  TrialLine,
  TrialPreparationRequirement
} from "@nox-os/trial-sensory";
import { TrialSensoryProblem } from "@nox-os/trial-sensory";
import { createPostgresMaterialStore } from "./material-store.js";

type SqlExecutor = Sql | TransactionSql;

type LocationRow = {
  id: string;
  tenant_id: string;
  location_code: string;
  name: string;
  description: string | null;
  status: InventoryLocation["status"];
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

type LotRow = {
  id: string;
  tenant_id: string;
  material_id: string;
  display_name: string;
  approval_status: MaterialLot["materialApprovalStatus"];
  lot_code: string;
  supplier_lot_code: string | null;
  manufactured_at: Date | null;
  expires_at: Date | null;
  retest_at: Date | null;
  lifecycle_status: MaterialLot["lifecycleStatus"];
  availability_status: MaterialLot["availabilityStatus"];
  notes: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  last_movement_at: Date | null;
  closed_at: Date | null;
  closed_by_user_id: string | null;
};

type MovementRow = {
  id: string;
  tenant_id: string;
  lot_id: string;
  material_id: string;
  movement_type: MovementType;
  quantity_mg: bigint | string;
  from_location_id: string | null;
  to_location_id: string | null;
  source_module: MovementSourceModule;
  source_reference_id: string | null;
  reason_code: string | null;
  operation_key: string;
  created_by_user_id: string;
  created_at: Date;
};

type ReservationRow = {
  id: string;
  tenant_id: string;
  lot_id: string;
  material_id: string;
  location_id: string;
  quantity_mg: bigint | string;
  source_module: StockReservation["sourceModule"];
  source_reference_id: string | null;
  operation_key: string;
  status: StockReservation["status"];
  created_by_user_id: string;
  created_at: Date;
  released_at: Date | null;
  consumed_at: Date | null;
  cancelled_at: Date | null;
  consumed_movement_id: string | null;
};

type BalanceRow = {
  location_id: string;
  on_hand_mg: bigint | string;
  reserved_mg: bigint | string;
};

function quantity(value: bigint | string): QuantityMg | "0" {
  return String(value) as QuantityMg | "0";
}

function location(row: LocationRow): InventoryLocation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    locationCode: row.location_code,
    name: row.name,
    description: row.description,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function movement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lotId: row.lot_id,
    materialId: row.material_id,
    movementType: row.movement_type,
    quantityMg: quantity(row.quantity_mg) as QuantityMg,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    sourceModule: row.source_module,
    sourceReferenceId: row.source_reference_id,
    reasonCode: row.reason_code,
    operationKey: row.operation_key,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at
  };
}

function reservation(row: ReservationRow): StockReservation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lotId: row.lot_id,
    materialId: row.material_id,
    locationId: row.location_id,
    quantityMg: quantity(row.quantity_mg) as QuantityMg,
    sourceModule: row.source_module,
    sourceReferenceId: row.source_reference_id,
    operationKey: row.operation_key,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    releasedAt: row.released_at,
    consumedAt: row.consumed_at,
    cancelledAt: row.cancelled_at,
    consumedMovementId: row.consumed_movement_id
  };
}

async function audit(
  sql: SqlExecutor,
  input: InventoryCommandContext & {
    action: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }
): Promise<void> {
  await sql`
    insert into platform.audit_events (
      tenant_id, actor_user_id, action, resource_type, resource_id,
      request_id, correlation_id, metadata
    ) values (
      ${input.tenantId}, ${input.actorUserId}, ${input.action}, ${input.resourceType},
      ${input.resourceId}, ${input.requestId}, ${input.correlationId},
      ${sql.json(input.metadata ?? {})}
    )
  `;
}

async function loadBalances(
  sql: SqlExecutor,
  tenantId: string,
  lotId: string
): Promise<InventoryBalance[]> {
  const rows = await sql<BalanceRow[]>`
    with referenced_locations as (
      select from_location_id as location_id
      from inventory.stock_movements
      where tenant_id = ${tenantId} and lot_id = ${lotId} and from_location_id is not null
      union
      select to_location_id
      from inventory.stock_movements
      where tenant_id = ${tenantId} and lot_id = ${lotId} and to_location_id is not null
      union
      select location_id
      from inventory.stock_reservations
      where tenant_id = ${tenantId} and lot_id = ${lotId}
    )
    select reference.location_id,
      coalesce((
        select sum(case
          when movement.to_location_id = reference.location_id then movement.quantity_mg
          when movement.from_location_id = reference.location_id then -movement.quantity_mg
          else 0 end)
        from inventory.stock_movements as movement
        where movement.tenant_id = ${tenantId} and movement.lot_id = ${lotId}
      ), 0)::bigint as on_hand_mg,
      coalesce((
        select sum(item.quantity_mg)
        from inventory.stock_reservations as item
        where item.tenant_id = ${tenantId} and item.lot_id = ${lotId}
          and item.location_id = reference.location_id and item.status = 'ACTIVE'
      ), 0)::bigint as reserved_mg
    from referenced_locations as reference
    where reference.location_id is not null
    order by reference.location_id
  `;
  return rows.map((row) => {
    const onHand = BigInt(row.on_hand_mg);
    const reserved = BigInt(row.reserved_mg);
    return {
      lotId,
      locationId: row.location_id,
      onHandMg: quantity(onHand),
      reservedMg: quantity(reserved),
      availableMg: quantity(onHand - reserved)
    };
  });
}

async function loadLot(
  sql: SqlExecutor,
  tenantId: string,
  lotId: string
): Promise<MaterialLot | undefined> {
  const rows = await sql<LotRow[]>`
    select lot.id, lot.tenant_id, lot.material_id, material.display_name,
      material.approval_status, lot.lot_code, lot.supplier_lot_code,
      lot.manufactured_at, lot.expires_at, lot.retest_at, lot.lifecycle_status,
      lot.availability_status, lot.notes, lot.created_by_user_id, lot.created_at,
      lot.updated_at,
      (
        select max(movement.created_at)
        from inventory.stock_movements as movement
        where movement.tenant_id = lot.tenant_id and movement.lot_id = lot.id
      ) as last_movement_at,
      lot.closed_at, lot.closed_by_user_id
    from inventory.material_lots as lot
    join material_intelligence.materials as material on material.id = lot.material_id
    where lot.tenant_id = ${tenantId} and lot.id = ${lotId}
  `;
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    materialId: row.material_id,
    materialDisplayName: row.display_name,
    materialApprovalStatus: row.approval_status,
    lotCode: row.lot_code,
    supplierLotCode: row.supplier_lot_code,
    manufacturedAt: row.manufactured_at,
    expiresAt: row.expires_at,
    retestAt: row.retest_at,
    lifecycleStatus: row.lifecycle_status,
    availabilityStatus: row.availability_status,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMovementAt: row.last_movement_at,
    closedAt: row.closed_at,
    closedByUserId: row.closed_by_user_id,
    balances: await loadBalances(sql, tenantId, lotId)
  };
}

async function requireLockedLot(
  sql: SqlExecutor,
  tenantId: string,
  lotId: string
): Promise<{
  material_id: string;
  lifecycle_status: string;
  availability_status: string;
  expires_at: Date | null;
}> {
  const rows = await sql<
    {
      material_id: string;
      lifecycle_status: string;
      availability_status: string;
      expires_at: Date | null;
    }[]
  >`
    select material_id, lifecycle_status, availability_status, expires_at
    from inventory.material_lots
    where tenant_id = ${tenantId} and id = ${lotId}
    for update
  `;
  if (!rows[0]) throw new InventoryProblem(404, "LOT_NOT_FOUND", "Material Lot was not found.");
  return rows[0];
}

async function requireActiveLocation(
  sql: SqlExecutor,
  tenantId: string,
  locationId: string
): Promise<void> {
  const rows = await sql<{ status: string }[]>`
    select status from inventory.locations
    where tenant_id = ${tenantId} and id = ${locationId}
    for update
  `;
  if (!rows[0]) throw new InventoryProblem(404, "LOCATION_NOT_FOUND", "Location was not found.");
  if (rows[0].status !== "ACTIVE")
    throw new InventoryProblem(409, "LOCATION_ARCHIVED", "Location is archived.");
}

async function balanceAt(
  sql: SqlExecutor,
  tenantId: string,
  lotId: string,
  locationId: string
): Promise<{ onHand: bigint; reserved: bigint; available: bigint }> {
  const balances = await loadBalances(sql, tenantId, lotId);
  const found = balances.find((item) => item.locationId === locationId);
  const onHand = BigInt(found?.onHandMg ?? "0");
  const reserved = BigInt(found?.reservedMg ?? "0");
  return { onHand, reserved, available: onHand - reserved };
}

function movementMatches(
  row: MovementRow,
  input: {
    lotId: string;
    movementType: MovementType;
    quantityMg: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    sourceModule: MovementSourceModule;
    sourceReferenceId: string | null;
    reasonCode: string | null;
  }
): boolean {
  return (
    row.lot_id === input.lotId &&
    row.movement_type === input.movementType &&
    String(row.quantity_mg) === input.quantityMg &&
    row.from_location_id === input.fromLocationId &&
    row.to_location_id === input.toLocationId &&
    row.source_module === input.sourceModule &&
    row.source_reference_id === input.sourceReferenceId &&
    row.reason_code === input.reasonCode
  );
}

async function findMovementByOperation(
  sql: SqlExecutor,
  tenantId: string,
  operationKey: string
): Promise<MovementRow | undefined> {
  const rows = await sql<MovementRow[]>`
    select * from inventory.stock_movements
    where tenant_id = ${tenantId} and operation_key = ${operationKey}
  `;
  return rows[0];
}

async function insertMovement(
  sql: SqlExecutor,
  input: InventoryCommandContext & {
    lotId: string;
    movementType: MovementType;
    quantityMg: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    sourceModule: MovementSourceModule;
    sourceReferenceId: string | null;
    reasonCode: string | null;
    operationKey: string;
    protectedReservationMg?: string;
  }
): Promise<StockMovement> {
  const directionIsValid = (["RECEIPT", "RETURN_IN", "ADJUSTMENT_IN"] as MovementType[]).includes(
    input.movementType
  )
    ? input.fromLocationId === null && input.toLocationId !== null
    : input.movementType === "TRANSFER"
      ? input.fromLocationId !== null &&
        input.toLocationId !== null &&
        input.fromLocationId !== input.toLocationId
      : input.fromLocationId !== null && input.toLocationId === null;
  if (!directionIsValid)
    throw new InventoryProblem(
      400,
      "INVALID_MOVEMENT_DIRECTION",
      "Movement locations do not match its direction."
    );
  const existing = await findMovementByOperation(sql, input.tenantId, input.operationKey);
  if (existing) {
    if (!movementMatches(existing, input))
      throw new InventoryProblem(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Operation key was already used for a different Movement."
      );
    return movement(existing);
  }
  const lot = await requireLockedLot(sql, input.tenantId, input.lotId);
  if (lot.lifecycle_status !== "OPEN")
    throw new InventoryProblem(409, "LOT_CLOSED", "Material Lot is closed.");
  if (input.fromLocationId) await requireActiveLocation(sql, input.tenantId, input.fromLocationId);
  if (input.toLocationId) await requireActiveLocation(sql, input.tenantId, input.toLocationId);
  if (input.movementType === "CONSUMPTION") {
    if (lot.availability_status !== "AVAILABLE")
      throw new InventoryProblem(409, "LOT_ON_HOLD", "Material Lot is on hold.");
    if (lot.expires_at && lot.expires_at <= new Date())
      throw new InventoryProblem(409, "LOT_EXPIRED", "Material Lot is expired.");
  }
  if (input.fromLocationId) {
    const current = await balanceAt(sql, input.tenantId, input.lotId, input.fromLocationId);
    const needed = BigInt(input.quantityMg);
    if (needed > current.onHand)
      throw new InventoryProblem(
        409,
        "INSUFFICIENT_STOCK",
        "Movement exceeds physical on-hand stock."
      );
    const protectedReservation = BigInt(input.protectedReservationMg ?? "0");
    if (needed > current.available + protectedReservation)
      throw new InventoryProblem(
        409,
        "INSUFFICIENT_AVAILABLE_STOCK",
        "Movement would consume stock reserved by another operation."
      );
  }
  const rows = await sql<MovementRow[]>`
    insert into inventory.stock_movements (
      tenant_id, lot_id, material_id, movement_type, quantity_mg,
      from_location_id, to_location_id, source_module, source_reference_id,
      reason_code, operation_key, created_by_user_id
    ) values (
      ${input.tenantId}, ${input.lotId}, ${lot.material_id}, ${input.movementType},
      ${input.quantityMg}, ${input.fromLocationId}, ${input.toLocationId},
      ${input.sourceModule}, ${input.sourceReferenceId}, ${input.reasonCode},
      ${input.operationKey}, ${input.actorUserId}
    ) returning *
  `;
  return movement(rows[0]);
}

function movementAuditAction(type: MovementType): string {
  return (
    {
      RECEIPT: "inventory.stock.received",
      RETURN_IN: "inventory.stock.received",
      TRANSFER: "inventory.stock.transferred",
      CONSUMPTION: "inventory.stock.consumed",
      ADJUSTMENT_IN: "inventory.stock.adjusted",
      ADJUSTMENT_OUT: "inventory.stock.adjusted",
      DISPOSAL: "inventory.stock.disposed"
    } satisfies Record<MovementType, string>
  )[type];
}

export class PostgresInventoryMaterialSource implements InventoryMaterialSource {
  constructor(private readonly sql: Sql) {}

  async findTenantAccessibleMaterial(
    tenantId: string,
    materialId: string
  ): Promise<InventoryMaterialReference | undefined> {
    const aggregate = await createPostgresMaterialStore(this.sql).findMaterialAggregate(
      materialId,
      false
    );
    if (!aggregate || !canReadMaterial({ tenantId, platformAuthority: false }, aggregate.material))
      return undefined;
    return {
      materialId: aggregate.material.id,
      displayName: aggregate.material.displayName,
      materialType: aggregate.material.materialType,
      approvalStatus: aggregate.material.approvalStatus,
      tenantAccessible: true
    };
  }
}

export class PostgresInventoryStore implements InventoryStore {
  constructor(private readonly sql: Sql) {}

  async listLocations(tenantId: string): Promise<InventoryLocation[]> {
    const rows = await this.sql<
      LocationRow[]
    >`select * from inventory.locations where tenant_id = ${tenantId} order by location_code`;
    return rows.map(location);
  }

  async createLocation(
    input: Parameters<InventoryStore["createLocation"]>[0]
  ): Promise<InventoryLocation> {
    const row = await this.sql.begin(async (tx) => {
      const rows = await tx<LocationRow[]>`
        insert into inventory.locations (tenant_id, location_code, name, description, created_by_user_id)
        values (${input.tenantId}, ${input.locationCode}, ${input.name}, ${input.description}, ${input.actorUserId}) returning *
      `;
      await audit(tx, {
        ...input,
        action: "inventory.location.created",
        resourceType: "InventoryLocation",
        resourceId: rows[0].id
      });
      return rows[0];
    });
    return location(row);
  }

  async updateLocation(
    input: Parameters<InventoryStore["updateLocation"]>[0]
  ): Promise<InventoryLocation | undefined> {
    const row = await this.sql.begin(async (tx) => {
      const current = await tx<
        LocationRow[]
      >`select * from inventory.locations where tenant_id = ${input.tenantId} and id = ${input.locationId} for update`;
      if (!current[0]) return undefined;
      const next = {
        locationCode: input.locationCode ?? current[0].location_code,
        name: input.name ?? current[0].name,
        description: input.description === undefined ? current[0].description : input.description
      };
      if (
        next.locationCode === current[0].location_code &&
        next.name === current[0].name &&
        next.description === current[0].description
      )
        return current[0];
      const rows = await tx<LocationRow[]>`
        update inventory.locations set location_code = ${next.locationCode}, name = ${next.name},
          description = ${next.description}, updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.locationId} returning *
      `;
      await audit(tx, {
        ...input,
        action: "inventory.location.updated",
        resourceType: "InventoryLocation",
        resourceId: input.locationId
      });
      return rows[0];
    });
    return row ? location(row) : undefined;
  }

  async archiveLocation(
    input: Parameters<InventoryStore["archiveLocation"]>[0]
  ): Promise<InventoryLocation> {
    const row = await this.sql.begin(async (tx) => {
      const rows = await tx<
        LocationRow[]
      >`select * from inventory.locations where tenant_id = ${input.tenantId} and id = ${input.locationId} for update`;
      if (!rows[0])
        throw new InventoryProblem(404, "LOCATION_NOT_FOUND", "Location was not found.");
      if (rows[0].status === "ARCHIVED") return rows[0];
      const balances = await tx<{ on_hand_mg: bigint | string; reserved_mg: bigint | string }[]>`
        select
          coalesce(sum(case when movement.to_location_id = ${input.locationId} then movement.quantity_mg when movement.from_location_id = ${input.locationId} then -movement.quantity_mg else 0 end), 0)::bigint as on_hand_mg,
          coalesce((select sum(quantity_mg) from inventory.stock_reservations where tenant_id = ${input.tenantId} and location_id = ${input.locationId} and status = 'ACTIVE'), 0)::bigint as reserved_mg
        from inventory.stock_movements movement
        where movement.tenant_id = ${input.tenantId}
      `;
      if (
        BigInt(balances[0]?.on_hand_mg ?? 0) !== 0n ||
        BigInt(balances[0]?.reserved_mg ?? 0) !== 0n
      )
        throw new InventoryProblem(
          409,
          "LOCATION_NOT_EMPTY",
          "Location must have zero stock and no active reservations before archive."
        );
      const updated = await tx<
        LocationRow[]
      >`update inventory.locations set status = 'ARCHIVED', updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.locationId} returning *`;
      await audit(tx, {
        ...input,
        action: "inventory.location.archived",
        resourceType: "InventoryLocation",
        resourceId: input.locationId
      });
      return updated[0];
    });
    return location(row);
  }

  async listLots(tenantId: string): Promise<MaterialLot[]> {
    const rows = await this.sql<
      { id: string }[]
    >`select id from inventory.material_lots where tenant_id = ${tenantId} order by updated_at desc, id`;
    return (await Promise.all(rows.map((row) => loadLot(this.sql, tenantId, row.id)))).filter(
      (value): value is MaterialLot => Boolean(value)
    );
  }

  findLot(tenantId: string, lotId: string): Promise<MaterialLot | undefined> {
    return loadLot(this.sql, tenantId, lotId);
  }

  async createLot(input: Parameters<InventoryStore["createLot"]>[0]): Promise<MaterialLot> {
    const id = await this.sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        insert into inventory.material_lots (
          tenant_id, material_id, lot_code, supplier_lot_code, manufactured_at,
          expires_at, retest_at, notes, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.material.materialId}, ${input.lotCode}, ${input.supplierLotCode},
          ${input.manufacturedAt}, ${input.expiresAt}, ${input.retestAt}, ${input.notes}, ${input.actorUserId}
        ) returning id
      `;
      await audit(tx, {
        ...input,
        action: "inventory.lot.created",
        resourceType: "MaterialLot",
        resourceId: rows[0].id,
        metadata: { materialId: input.material.materialId, lotCode: input.lotCode }
      });
      return rows[0].id;
    });
    return (await loadLot(this.sql, input.tenantId, id))!;
  }

  async updateLot(input: Parameters<InventoryStore["updateLot"]>[0]): Promise<MaterialLot> {
    const id = await this.sql.begin(async (tx) => {
      const rows = await tx<LotRow[]>`
        select lot.*, material.display_name, material.approval_status
        from inventory.material_lots lot join material_intelligence.materials material on material.id = lot.material_id
        where lot.tenant_id = ${input.tenantId} and lot.id = ${input.lotId} for update
      `;
      const current = rows[0];
      if (!current) throw new InventoryProblem(404, "LOT_NOT_FOUND", "Material Lot was not found.");
      const values = {
        materialId: input.material?.materialId ?? current.material_id,
        lotCode: input.lotCode ?? current.lot_code,
        supplierLotCode:
          input.supplierLotCode === undefined ? current.supplier_lot_code : input.supplierLotCode,
        manufacturedAt:
          input.manufacturedAt === undefined ? current.manufactured_at : input.manufacturedAt,
        expiresAt: input.expiresAt === undefined ? current.expires_at : input.expiresAt,
        retestAt: input.retestAt === undefined ? current.retest_at : input.retestAt,
        notes: input.notes === undefined ? current.notes : input.notes
      };
      const references = await tx<{ exists: boolean }[]>`
        select exists(select 1 from inventory.stock_movements where tenant_id = ${input.tenantId} and lot_id = ${input.lotId}) as exists
      `;
      if (
        references[0]?.exists &&
        (values.materialId !== current.material_id ||
          values.lotCode !== current.lot_code ||
          values.supplierLotCode !== current.supplier_lot_code ||
          values.manufacturedAt?.getTime() !== current.manufactured_at?.getTime() ||
          values.expiresAt?.getTime() !== current.expires_at?.getTime() ||
          values.retestAt?.getTime() !== current.retest_at?.getTime())
      )
        throw new InventoryProblem(
          409,
          "LOT_IDENTITY_IMMUTABLE",
          "Lot identity is immutable after its first Movement."
        );
      await tx`
        update inventory.material_lots set material_id = ${values.materialId}, lot_code = ${values.lotCode},
          supplier_lot_code = ${values.supplierLotCode}, manufactured_at = ${values.manufacturedAt},
          expires_at = ${values.expiresAt}, retest_at = ${values.retestAt}, notes = ${values.notes}, updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.lotId}
      `;
      await audit(tx, {
        ...input,
        action: "inventory.lot.updated",
        resourceType: "MaterialLot",
        resourceId: input.lotId
      });
      return input.lotId;
    });
    return (await loadLot(this.sql, input.tenantId, id))!;
  }

  async setLotHold(input: Parameters<InventoryStore["setLotHold"]>[0]): Promise<MaterialLot> {
    await this.sql.begin(async (tx) => {
      const rows = await tx<
        { availability_status: string }[]
      >`select availability_status from inventory.material_lots where tenant_id = ${input.tenantId} and id = ${input.lotId} for update`;
      if (!rows[0]) throw new InventoryProblem(404, "LOT_NOT_FOUND", "Material Lot was not found.");
      const status = input.hold ? "HOLD" : "AVAILABLE";
      if (rows[0].availability_status === status) return;
      await tx`update inventory.material_lots set availability_status = ${status}, updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.lotId}`;
      await audit(tx, {
        ...input,
        action: input.hold ? "inventory.lot.held" : "inventory.lot.hold_released",
        resourceType: "MaterialLot",
        resourceId: input.lotId
      });
    });
    return (await loadLot(this.sql, input.tenantId, input.lotId))!;
  }

  async closeLot(input: Parameters<InventoryStore["closeLot"]>[0]): Promise<MaterialLot> {
    await this.sql.begin(async (tx) => {
      const rows = await tx<
        { lifecycle_status: string }[]
      >`select lifecycle_status from inventory.material_lots where tenant_id = ${input.tenantId} and id = ${input.lotId} for update`;
      if (!rows[0]) throw new InventoryProblem(404, "LOT_NOT_FOUND", "Material Lot was not found.");
      if (rows[0].lifecycle_status === "CLOSED") return;
      const balances = await loadBalances(tx, input.tenantId, input.lotId);
      if (balances.some((item) => BigInt(item.onHandMg) !== 0n || BigInt(item.reservedMg) !== 0n))
        throw new InventoryProblem(
          409,
          "LOT_NOT_EMPTY",
          "Lot must have zero stock and no active reservations before close."
        );
      await tx`update inventory.material_lots set lifecycle_status = 'CLOSED', closed_at = now(), closed_by_user_id = ${input.actorUserId}, updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.lotId}`;
      await audit(tx, {
        ...input,
        action: "inventory.lot.closed",
        resourceType: "MaterialLot",
        resourceId: input.lotId
      });
    });
    return (await loadLot(this.sql, input.tenantId, input.lotId))!;
  }

  async createManualMovement(
    input: Parameters<InventoryStore["createManualMovement"]>[0]
  ): Promise<StockMovement> {
    return this.sql.begin(async (tx) => {
      const value = await insertMovement(tx, {
        ...input,
        sourceModule: "MANUAL",
        sourceReferenceId: null
      });
      await audit(tx, {
        ...input,
        action: movementAuditAction(input.movementType),
        resourceType: "StockMovement",
        resourceId: value.id,
        metadata: {
          lotId: value.lotId,
          materialId: value.materialId,
          quantityMg: value.quantityMg,
          operationKey: value.operationKey
        }
      });
      return value;
    });
  }

  async listLotMovements(tenantId: string, lotId: string): Promise<StockMovement[]> {
    const rows = await this.sql<
      MovementRow[]
    >`select * from inventory.stock_movements where tenant_id = ${tenantId} and lot_id = ${lotId} order by created_at desc, id`;
    return rows.map(movement);
  }

  async createManualReservation(
    input: Parameters<InventoryStore["createManualReservation"]>[0]
  ): Promise<StockReservation> {
    return this.sql.begin(async (tx) => {
      const existing = await tx<
        ReservationRow[]
      >`select * from inventory.stock_reservations where tenant_id = ${input.tenantId} and operation_key = ${input.operationKey}`;
      if (existing[0]) {
        if (
          existing[0].lot_id !== input.lotId ||
          existing[0].location_id !== input.locationId ||
          String(existing[0].quantity_mg) !== input.quantityMg ||
          existing[0].source_module !== "MANUAL" ||
          existing[0].source_reference_id !== input.sourceReferenceId
        )
          throw new InventoryProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Operation key was already used for a different Reservation."
          );
        return reservation(existing[0]);
      }
      const lot = await requireLockedLot(tx, input.tenantId, input.lotId);
      if (lot.lifecycle_status !== "OPEN")
        throw new InventoryProblem(409, "LOT_CLOSED", "Material Lot is closed.");
      if (lot.availability_status !== "AVAILABLE")
        throw new InventoryProblem(409, "LOT_ON_HOLD", "Material Lot is on hold.");
      if (lot.expires_at && lot.expires_at <= new Date())
        throw new InventoryProblem(409, "LOT_EXPIRED", "Material Lot is expired.");
      await requireActiveLocation(tx, input.tenantId, input.locationId);
      const available = await balanceAt(tx, input.tenantId, input.lotId, input.locationId);
      if (BigInt(input.quantityMg) > available.available)
        throw new InventoryProblem(
          409,
          "RESERVATION_EXCEEDS_AVAILABLE_STOCK",
          "Reservation exceeds available stock."
        );
      const rows = await tx<ReservationRow[]>`
        insert into inventory.stock_reservations (
          tenant_id, lot_id, material_id, location_id, quantity_mg, source_module,
          source_reference_id, operation_key, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.lotId}, ${lot.material_id}, ${input.locationId},
          ${input.quantityMg}, 'MANUAL', ${input.sourceReferenceId}, ${input.operationKey}, ${input.actorUserId}
        ) returning *
      `;
      await audit(tx, {
        ...input,
        action: "inventory.reservation.created",
        resourceType: "StockReservation",
        resourceId: rows[0].id,
        metadata: {
          lotId: input.lotId,
          materialId: lot.material_id,
          locationId: input.locationId,
          quantityMg: input.quantityMg,
          operationKey: input.operationKey
        }
      });
      return reservation(rows[0]);
    });
  }

  async transitionManualReservation(
    input: Parameters<InventoryStore["transitionManualReservation"]>[0]
  ): Promise<StockReservation> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        ReservationRow[]
      >`select * from inventory.stock_reservations where tenant_id = ${input.tenantId} and id = ${input.reservationId} for update`;
      const current = rows[0];
      if (!current)
        throw new InventoryProblem(404, "RESERVATION_NOT_FOUND", "Reservation was not found.");
      if (current.source_module !== "MANUAL")
        throw new InventoryProblem(
          403,
          "PERMISSION_DENIED",
          "Generic inventory routes cannot transition internal reservations."
        );
      if (current.status !== "ACTIVE")
        throw new InventoryProblem(
          409,
          "RESERVATION_ALREADY_TERMINAL",
          "Reservation is already terminal."
        );
      let consumedMovementId: string | null = null;
      if (input.transition === "CONSUMED") {
        const value = await insertMovement(tx, {
          ...input,
          lotId: current.lot_id,
          movementType: "CONSUMPTION",
          quantityMg: String(current.quantity_mg),
          fromLocationId: current.location_id,
          toLocationId: null,
          sourceModule: "MANUAL",
          sourceReferenceId: current.source_reference_id,
          reasonCode: "RESERVATION_CONSUMED",
          operationKey: input.operationKey,
          protectedReservationMg: String(current.quantity_mg)
        });
        consumedMovementId = value.id;
      }
      const updated = await tx<ReservationRow[]>`
        update inventory.stock_reservations set status = ${input.transition},
          released_at = ${input.transition === "RELEASED" ? new Date() : null},
          cancelled_at = ${input.transition === "CANCELLED" ? new Date() : null},
          consumed_at = ${input.transition === "CONSUMED" ? new Date() : null},
          consumed_movement_id = ${consumedMovementId}
        where tenant_id = ${input.tenantId} and id = ${input.reservationId} returning *
      `;
      const suffix =
        input.transition === "RELEASED"
          ? "released"
          : input.transition === "CANCELLED"
            ? "cancelled"
            : "consumed";
      await audit(tx, {
        ...input,
        action: `inventory.reservation.${suffix}`,
        resourceType: "StockReservation",
        resourceId: input.reservationId,
        metadata: {
          lotId: current.lot_id,
          materialId: current.material_id,
          locationId: current.location_id,
          quantityMg: String(current.quantity_mg),
          operationKey: input.operationKey,
          consumedMovementId
        }
      });
      return reservation(updated[0]);
    });
  }

  async listLotReservations(tenantId: string, lotId: string): Promise<StockReservation[]> {
    const rows = await this.sql<
      ReservationRow[]
    >`select * from inventory.stock_reservations where tenant_id = ${tenantId} and lot_id = ${lotId} order by created_at desc, id`;
    return rows.map(reservation);
  }

  async traceTrial(tenantId: string, trialId: string): Promise<InventoryTrace> {
    const rows = await this.sql<
      MovementRow[]
    >`select * from inventory.stock_movements where tenant_id = ${tenantId} and source_module = 'TRIAL' and source_reference_id = ${trialId} order by created_at, id`;
    return { trialId, movements: rows.map(movement) };
  }
}

export class PostgresTrialInventoryPort implements TrialInventoryPort {
  constructor(private readonly sql: Sql) {}

  async listAvailability(input: {
    tenantId: string;
    trialId: string;
    requirements: readonly TrialPreparationRequirement[];
  }): Promise<TrialInventoryAvailability> {
    const materialIds = input.requirements.map((item) => item.materialId);
    if (materialIds.length === 0)
      return {
        trialId: input.trialId,
        requirements: input.requirements,
        allocations: [],
        activeReservations: []
      };
    const rows = await this.sql<
      (LotRow & BalanceRow & { location_code: string; location_status: string })[]
    >`
      select lot.id, lot.tenant_id, lot.material_id, material.display_name, material.approval_status,
        lot.lot_code, lot.supplier_lot_code, lot.manufactured_at, lot.expires_at, lot.retest_at,
        lot.lifecycle_status, lot.availability_status, lot.notes, lot.created_by_user_id,
        lot.created_at, lot.updated_at, lot.closed_at, lot.closed_by_user_id,
        loc.id as location_id, loc.location_code, loc.status as location_status,
        coalesce(sum(case when movement.to_location_id = loc.id then movement.quantity_mg when movement.from_location_id = loc.id then -movement.quantity_mg else 0 end), 0)::bigint as on_hand_mg,
        coalesce((select sum(item.quantity_mg) from inventory.stock_reservations item where item.tenant_id = lot.tenant_id and item.lot_id = lot.id and item.location_id = loc.id and item.status = 'ACTIVE'), 0)::bigint as reserved_mg
      from inventory.material_lots lot
      join material_intelligence.materials material on material.id = lot.material_id
      join inventory.locations loc on loc.tenant_id = lot.tenant_id
      left join inventory.stock_movements movement on movement.tenant_id = lot.tenant_id and movement.lot_id = lot.id and (movement.from_location_id = loc.id or movement.to_location_id = loc.id)
      where lot.tenant_id = ${input.tenantId} and lot.material_id in ${this.sql(materialIds)}
      group by lot.id, material.display_name, material.approval_status, loc.id
      having coalesce(sum(case when movement.to_location_id = loc.id then movement.quantity_mg when movement.from_location_id = loc.id then -movement.quantity_mg else 0 end), 0) > 0
      order by lot.material_id, lot.expires_at nulls last, lot.lot_code, loc.location_code
    `;
    const now = new Date();
    const activeRows = await this.sql<ReservationRow[]>`
      select * from inventory.stock_reservations
      where tenant_id = ${input.tenantId} and source_module = 'TRIAL'
        and source_reference_id = ${input.trialId} and status = 'ACTIVE'
      order by material_id, lot_id, location_id, id
    `;
    return {
      trialId: input.trialId,
      requirements: input.requirements,
      activeReservations: activeRows.map((item) => ({
        reservationId: item.id,
        materialId: item.material_id,
        lotId: item.lot_id,
        locationId: item.location_id,
        quantityMg: String(item.quantity_mg),
        status: "ACTIVE" as const
      })),
      allocations: rows.map((row) => {
        const onHand = BigInt(row.on_hand_mg);
        const reserved = BigInt(row.reserved_mg);
        let reason: string | null = null;
        if (row.lifecycle_status !== "OPEN") reason = "LOT_CLOSED";
        else if (row.availability_status !== "AVAILABLE") reason = "LOT_ON_HOLD";
        else if (row.expires_at && row.expires_at <= now) reason = "LOT_EXPIRED";
        else if (row.location_status !== "ACTIVE") reason = "LOCATION_ARCHIVED";
        else if (onHand - reserved <= 0n) reason = "INSUFFICIENT_AVAILABLE_STOCK";
        return {
          materialId: row.material_id,
          lotId: row.id,
          lotCode: row.lot_code,
          locationId: row.location_id,
          locationCode: row.location_code,
          onHandMg: String(onHand),
          reservedMg: String(reserved),
          availableMg: String(onHand - reserved),
          lifecycleStatus: row.lifecycle_status,
          availabilityStatus: row.availability_status,
          expiresAt: row.expires_at,
          retestAt: row.retest_at,
          eligible: reason === null,
          ineligibilityReason: reason
        };
      })
    };
  }

  async reserve(
    input: Parameters<TrialInventoryPort["reserve"]>[0]
  ): Promise<TrialInventoryReservationSet> {
    return this.sql.begin(async (tx) => {
      const trials = await tx<
        { status: string }[]
      >`select status from trial_sensory.trials where tenant_id = ${input.tenantId} and id = ${input.trialId} for update`;
      if (!trials[0]) throw new TrialSensoryProblem(404, "TRIAL_NOT_FOUND", "Trial was not found.");
      if (trials[0].status !== "DRAFT")
        throw new TrialSensoryProblem(
          409,
          "TRIAL_ALREADY_PREPARED",
          "Only DRAFT Trial inventory can be reserved."
        );
      const result: StockReservation[] = [];
      const ordered = [...input.allocations].sort((a, b) =>
        `${a.lotId}:${a.locationId}`.localeCompare(`${b.lotId}:${b.locationId}`)
      );
      const expectedKeys = new Set(ordered.map((_, index) => `${input.operationKey}:${index}`));
      const active = await tx<ReservationRow[]>`
        select * from inventory.stock_reservations
        where tenant_id = ${input.tenantId} and source_module = 'TRIAL'
          and source_reference_id = ${input.trialId} and status = 'ACTIVE'
        order by id for update
      `;
      if (active.some((item) => !expectedKeys.has(item.operation_key))) {
        throw new TrialSensoryProblem(
          409,
          "TRIAL_INVENTORY_ALLOCATION_MISMATCH",
          "Release the existing Trial allocation before reserving a replacement."
        );
      }
      for (const [index, allocation] of ordered.entries()) {
        const key = `${input.operationKey}:${index}`;
        const existing = await tx<
          ReservationRow[]
        >`select * from inventory.stock_reservations where tenant_id = ${input.tenantId} and operation_key = ${key}`;
        if (existing[0]) {
          if (
            existing[0].source_module !== "TRIAL" ||
            existing[0].source_reference_id !== input.trialId ||
            existing[0].lot_id !== allocation.lotId ||
            existing[0].location_id !== allocation.locationId ||
            existing[0].material_id !== allocation.materialId ||
            String(existing[0].quantity_mg) !== allocation.quantityMg
          )
            throw new TrialSensoryProblem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Trial reservation operation key conflicts with existing state."
            );
          result.push(reservation(existing[0]));
          continue;
        }
        const lot = await requireLockedLot(tx, input.tenantId, allocation.lotId);
        if (lot.material_id !== allocation.materialId)
          throw new TrialSensoryProblem(
            409,
            "TRIAL_INVENTORY_ALLOCATION_MISMATCH",
            "Lot Material does not match Trial requirement."
          );
        if (
          lot.lifecycle_status !== "OPEN" ||
          lot.availability_status !== "AVAILABLE" ||
          (lot.expires_at && lot.expires_at <= new Date())
        )
          throw new TrialSensoryProblem(
            409,
            "TRIAL_INVENTORY_NOT_READY",
            "Selected Lot is not eligible for Trial allocation."
          );
        await requireActiveLocation(tx, input.tenantId, allocation.locationId);
        const available = await balanceAt(
          tx,
          input.tenantId,
          allocation.lotId,
          allocation.locationId
        );
        if (BigInt(allocation.quantityMg) > available.available)
          throw new TrialSensoryProblem(
            409,
            "TRIAL_INVENTORY_NOT_READY",
            "Selected Lot does not have sufficient available stock."
          );
        const rows = await tx<ReservationRow[]>`
          insert into inventory.stock_reservations (
            tenant_id, lot_id, material_id, location_id, quantity_mg, source_module,
            source_reference_id, operation_key, created_by_user_id
          ) values (
            ${input.tenantId}, ${allocation.lotId}, ${allocation.materialId}, ${allocation.locationId},
            ${allocation.quantityMg}, 'TRIAL', ${input.trialId}, ${key}, ${input.actorUserId}
          ) returning *
        `;
        await audit(tx, {
          ...input,
          action: "inventory.reservation.created",
          resourceType: "StockReservation",
          resourceId: rows[0].id,
          metadata: {
            trialId: input.trialId,
            lotId: allocation.lotId,
            materialId: allocation.materialId,
            locationId: allocation.locationId,
            quantityMg: allocation.quantityMg,
            operationKey: key
          }
        });
        result.push(reservation(rows[0]));
      }
      return {
        trialId: input.trialId,
        reservations: result.map((item) => ({
          reservationId: item.id,
          materialId: item.materialId,
          lotId: item.lotId,
          locationId: item.locationId,
          quantityMg: item.quantityMg,
          status: item.status
        }))
      };
    });
  }

  async releaseDraftTrialReservations(
    input: Parameters<TrialInventoryPort["releaseDraftTrialReservations"]>[0]
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const trials = await tx<
        { status: string }[]
      >`select status from trial_sensory.trials where tenant_id = ${input.tenantId} and id = ${input.trialId} for update`;
      if (!trials[0]) throw new TrialSensoryProblem(404, "TRIAL_NOT_FOUND", "Trial was not found.");
      if (trials[0].status !== "DRAFT")
        throw new TrialSensoryProblem(
          409,
          "TRIAL_ALREADY_PREPARED",
          "Only DRAFT Trial reservations can be released."
        );
      const rows = await tx<
        ReservationRow[]
      >`select * from inventory.stock_reservations where tenant_id = ${input.tenantId} and source_module = 'TRIAL' and source_reference_id = ${input.trialId} and status = 'ACTIVE' order by id for update`;
      for (const item of rows) {
        await tx`update inventory.stock_reservations set status = 'RELEASED', released_at = now() where tenant_id = ${input.tenantId} and id = ${item.id}`;
        await audit(tx, {
          ...input,
          action: "inventory.reservation.released",
          resourceType: "StockReservation",
          resourceId: item.id,
          metadata: {
            trialId: input.trialId,
            lotId: item.lot_id,
            materialId: item.material_id,
            locationId: item.location_id,
            quantityMg: String(item.quantity_mg),
            operationKey: input.operationKey
          }
        });
      }
    });
  }
}

export async function consumeTrialReservationsInTransaction(
  tx: TransactionSql,
  input: InventoryCommandContext & { trialId: string; requirements: readonly TrialLine[] }
): Promise<void> {
  const rows = await tx<ReservationRow[]>`
    select * from inventory.stock_reservations
    where tenant_id = ${input.tenantId} and source_module = 'TRIAL'
      and source_reference_id = ${input.trialId} and status = 'ACTIVE'
    order by lot_id, location_id, id
    for update
  `;
  const required = new Map(
    input.requirements.map((item) => [item.materialId, BigInt(item.scaledMassMg)])
  );
  const allocated = new Map<string, bigint>();
  for (const item of rows)
    allocated.set(
      item.material_id,
      (allocated.get(item.material_id) ?? 0n) + BigInt(item.quantity_mg)
    );
  if (
    required.size !== allocated.size ||
    [...required].some(([materialId, mass]) => allocated.get(materialId) !== mass)
  )
    throw new TrialSensoryProblem(
      409,
      "TRIAL_INVENTORY_ALLOCATION_MISMATCH",
      "ACTIVE Trial reservations do not exactly match the preparation plan."
    );
  const lotIds = [...new Set(rows.map((row) => row.lot_id))].sort();
  for (const lotId of lotIds) await requireLockedLot(tx, input.tenantId, lotId);
  for (const item of rows) {
    const lot = await requireLockedLot(tx, input.tenantId, item.lot_id);
    if (
      lot.material_id !== item.material_id ||
      lot.lifecycle_status !== "OPEN" ||
      lot.availability_status !== "AVAILABLE" ||
      (lot.expires_at && lot.expires_at <= new Date())
    )
      throw new TrialSensoryProblem(
        409,
        "TRIAL_INVENTORY_NOT_READY",
        "Reserved Trial Lot is no longer eligible."
      );
    await requireActiveLocation(tx, input.tenantId, item.location_id);
    const balance = await balanceAt(tx, input.tenantId, item.lot_id, item.location_id);
    if (BigInt(item.quantity_mg) > balance.onHand)
      throw new TrialSensoryProblem(
        409,
        "TRIAL_INVENTORY_NOT_READY",
        "Reserved Trial stock is no longer physically available."
      );
    const operationKey = `trial:${input.trialId}:reservation:${item.id}:consume`;
    const value = await insertMovement(tx, {
      ...input,
      lotId: item.lot_id,
      movementType: "CONSUMPTION",
      quantityMg: String(item.quantity_mg),
      fromLocationId: item.location_id,
      toLocationId: null,
      sourceModule: "TRIAL",
      sourceReferenceId: input.trialId,
      reasonCode: "TRIAL_PREPARATION",
      operationKey,
      protectedReservationMg: String(item.quantity_mg)
    });
    await tx`update inventory.stock_reservations set status = 'CONSUMED', consumed_at = now(), consumed_movement_id = ${value.id} where tenant_id = ${input.tenantId} and id = ${item.id}`;
    await audit(tx, {
      ...input,
      action: "inventory.reservation.consumed",
      resourceType: "StockReservation",
      resourceId: item.id,
      metadata: {
        trialId: input.trialId,
        lotId: item.lot_id,
        materialId: item.material_id,
        locationId: item.location_id,
        quantityMg: String(item.quantity_mg),
        reservationId: item.id,
        consumedMovementId: value.id,
        operationKey
      }
    });
    await audit(tx, {
      ...input,
      action: "inventory.stock.consumed",
      resourceType: "StockMovement",
      resourceId: value.id,
      metadata: {
        trialId: input.trialId,
        lotId: item.lot_id,
        materialId: item.material_id,
        locationId: item.location_id,
        quantityMg: String(item.quantity_mg),
        reservationId: item.id,
        consumedMovementId: value.id,
        operationKey
      }
    });
  }
}

export async function cancelDraftTrialReservationsInTransaction(
  tx: TransactionSql,
  input: InventoryCommandContext & { trialId: string }
): Promise<void> {
  const rows = await tx<ReservationRow[]>`
    select * from inventory.stock_reservations
    where tenant_id = ${input.tenantId} and source_module = 'TRIAL'
      and source_reference_id = ${input.trialId} and status = 'ACTIVE'
    order by id for update
  `;
  for (const item of rows) {
    await tx`update inventory.stock_reservations set status = 'CANCELLED', cancelled_at = now() where tenant_id = ${input.tenantId} and id = ${item.id}`;
    await audit(tx, {
      ...input,
      action: "inventory.reservation.cancelled",
      resourceType: "StockReservation",
      resourceId: item.id,
      metadata: {
        trialId: input.trialId,
        lotId: item.lot_id,
        materialId: item.material_id,
        locationId: item.location_id,
        quantityMg: String(item.quantity_mg),
        operationKey: `trial:${input.trialId}:cancel`
      }
    });
  }
}

export class PostgresInventoryReceiptPort implements InventoryReceiptPort {
  constructor(
    private readonly sql: Sql,
    private readonly materials: InventoryMaterialSource
  ) {}

  async receiveProcurementLot(
    input: Parameters<InventoryReceiptPort["receiveProcurementLot"]>[0]
  ): Promise<StockMovement> {
    const material = await this.materials.findTenantAccessibleMaterial(
      input.context.tenantId,
      input.materialId
    );
    if (!material)
      throw new InventoryProblem(
        404,
        "MATERIAL_NOT_FOUND",
        "Tenant-accessible Material not found."
      );
    return this.sql.begin((tx) => receiveProcurementLotInTransaction(tx, input));
  }
}

type ProcurementLotRow = {
  id: string;
  material_id: string;
  supplier_lot_code: string | null;
  manufactured_at: Date | null;
  expires_at: Date | null;
  retest_at: Date | null;
};

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

/**
 * Canonical Gate 7 receipt implementation for a caller-owned transaction.
 * Gate 8 uses this narrow adapter so procurement POST and physical Inventory
 * receipt either commit together or roll back together.
 */
export async function receiveProcurementLotInTransaction(
  tx: TransactionSql,
  input: Parameters<InventoryReceiptPort["receiveProcurementLot"]>[0]
): Promise<StockMovement> {
  let lots = await tx<ProcurementLotRow[]>`
    select id, material_id, supplier_lot_code, manufactured_at, expires_at, retest_at
    from inventory.material_lots
    where tenant_id = ${input.context.tenantId} and lot_code = ${input.lotCode}
    for update
  `;
  const identity = {
    supplierLotCode: input.supplierLotCode ?? null,
    manufacturedAt: input.manufacturedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    retestAt: input.retestAt ?? null
  };
  if (
    lots[0] &&
    (lots[0].material_id !== input.materialId ||
      lots[0].supplier_lot_code !== identity.supplierLotCode ||
      !sameInstant(lots[0].manufactured_at, identity.manufacturedAt) ||
      !sameInstant(lots[0].expires_at, identity.expiresAt) ||
      !sameInstant(lots[0].retest_at, identity.retestAt))
  )
    throw new InventoryProblem(
      409,
      "INVENTORY_LOT_IDENTITY_CONFLICT",
      "Existing Inventory Lot identity conflicts with the procurement receipt."
    );
  if (!lots[0]) {
    lots = await tx<ProcurementLotRow[]>`
      insert into inventory.material_lots (
        tenant_id, material_id, lot_code, supplier_lot_code,
        manufactured_at, expires_at, retest_at, created_by_user_id
      ) values (
        ${input.context.tenantId}, ${input.materialId}, ${input.lotCode},
        ${identity.supplierLotCode}, ${identity.manufacturedAt}, ${identity.expiresAt},
        ${identity.retestAt}, ${input.context.actorUserId}
      ) returning id, material_id, supplier_lot_code, manufactured_at, expires_at, retest_at
    `;
  }
  const existingMovement = await findMovementByOperation(
    tx,
    input.context.tenantId,
    input.operationKey
  );
  const value = await insertMovement(tx, {
    ...input.context,
    lotId: lots[0].id,
    movementType: "RECEIPT",
    quantityMg: input.quantityMg,
    fromLocationId: null,
    toLocationId: input.locationId,
    sourceModule: "PROCUREMENT",
    sourceReferenceId: input.procurementReceiptId,
    reasonCode: null,
    operationKey: input.operationKey
  });
  if (!existingMovement)
    await audit(tx, {
      ...input.context,
      action: "inventory.stock.received",
      resourceType: "StockMovement",
      resourceId: value.id,
      metadata: {
        lotId: value.lotId,
        materialId: value.materialId,
        locationId: input.locationId,
        quantityMg: input.quantityMg,
        sourceModule: "PROCUREMENT",
        sourceReferenceId: input.procurementReceiptId,
        operationKey: input.operationKey
      }
    });
  return value;
}

export type PostgresProductionInventoryPort = ProductionInventoryPort;
