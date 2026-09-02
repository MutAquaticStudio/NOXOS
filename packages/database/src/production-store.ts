import type { Sql, TransactionSql } from "postgres";
import {
  scaleFormulaMasses,
  findBelowWeighableResolution,
  type FrozenFormulaVersion
} from "@nox-os/design-studio";
import type {
  ProductionStore,
  ProductionOrder,
  ProductionOrderLine,
  ProductionMaterialAllocation,
  ProductionBatch,
  ProductionCommandContext,
  CreateProductionOrderRequest,
  UpdateProductionOrderRequest,
  AllocationInput,
  ProductionReadinessSource,
  QuantityMg
} from "@nox-os/production";
import { ProductionProblem } from "@nox-os/production";
import {
  reserveProductionLotInTransaction,
  releaseProductionReservationInTransaction,
  consumeProductionReservationInTransaction
} from "./inventory-store.js";
import { createPostgresDesignStudioStore } from "./design-studio-store.js";
import { createPostgresProductionReadinessSource } from "./release-readiness-store.js";

type OrderRow = {
  id: string;
  tenant_id: string;
  order_number: string;
  formula_version_id: string;
  formula_bundle_hash: string;
  target_mass_mg: bigint | string;
  status: ProductionOrder["status"];
  release_readiness_assessment_id: string | null;
  notes: string | null;
  created_by_user_id: string;
  released_by_user_id: string | null;
  cancelled_by_user_id: string | null;
  completed_by_user_id: string | null;
  aborted_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  released_at: Date | null;
  cancelled_at: Date | null;
  completed_at: Date | null;
  aborted_at: Date | null;
};
type LineRow = {
  id: string;
  tenant_id: string;
  production_order_id: string;
  formula_line_order: number;
  material_id: string;
  required_mass_mg: bigint | string;
  material_snapshot_hash: string;
  created_at: Date;
};
type AllocationRow = {
  id: string;
  tenant_id: string;
  production_order_id: string;
  production_order_line_id: string;
  material_id: string;
  inventory_lot_id: string;
  inventory_location_id: string;
  allocated_mass_mg: bigint | string;
  inventory_reservation_id: string | null;
  inventory_consumption_movement_id: string | null;
  reservation_operation_key: string;
  consumption_operation_key: string;
  created_by_user_id: string;
  created_at: Date;
};
type BatchRow = {
  id: string;
  tenant_id: string;
  batch_number: string;
  production_order_id: string;
  formula_version_id: string;
  formula_bundle_hash: string;
  release_readiness_assessment_id: string;
  start_readiness_assessment_id: string;
  target_mass_mg: bigint | string;
  actual_output_mass_mg: bigint | string | null;
  process_notes: string | null;
  abort_reason: string | null;
  started_by_user_id: string;
  completed_by_user_id: string | null;
  aborted_by_user_id: string | null;
  started_at: Date;
  completed_at: Date | null;
  aborted_at: Date | null;
};
type Executor = Sql | TransactionSql;
const mass = (v: bigint | string) => String(v) as QuantityMg;
const mapLine = (r: LineRow): ProductionOrderLine => ({
  id: r.id,
  tenantId: r.tenant_id,
  productionOrderId: r.production_order_id,
  formulaLineOrder: r.formula_line_order,
  materialId: r.material_id,
  requiredMassMg: mass(r.required_mass_mg),
  materialSnapshotHash: r.material_snapshot_hash,
  createdAt: r.created_at
});
const mapAllocation = (r: AllocationRow): ProductionMaterialAllocation => ({
  id: r.id,
  tenantId: r.tenant_id,
  productionOrderId: r.production_order_id,
  productionOrderLineId: r.production_order_line_id,
  materialId: r.material_id,
  inventoryLotId: r.inventory_lot_id,
  inventoryLocationId: r.inventory_location_id,
  allocatedMassMg: mass(r.allocated_mass_mg),
  inventoryReservationId: r.inventory_reservation_id,
  inventoryConsumptionMovementId: r.inventory_consumption_movement_id,
  reservationOperationKey: r.reservation_operation_key,
  consumptionOperationKey: r.consumption_operation_key,
  createdByUserId: r.created_by_user_id,
  createdAt: r.created_at
});
const mapBatch = (
  r: BatchRow,
  allocations: readonly ProductionMaterialAllocation[]
): ProductionBatch => ({
  id: r.id,
  tenantId: r.tenant_id,
  batchNumber: r.batch_number,
  productionOrderId: r.production_order_id,
  formulaVersionId: r.formula_version_id,
  formulaBundleHash: r.formula_bundle_hash,
  releaseReadinessAssessmentId: r.release_readiness_assessment_id,
  startReadinessAssessmentId: r.start_readiness_assessment_id,
  targetMassMg: mass(r.target_mass_mg),
  actualOutputMassMg: r.actual_output_mass_mg === null ? null : mass(r.actual_output_mass_mg),
  processNotes: r.process_notes,
  abortReason: r.abort_reason,
  startedByUserId: r.started_by_user_id,
  completedByUserId: r.completed_by_user_id,
  abortedByUserId: r.aborted_by_user_id,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  abortedAt: r.aborted_at,
  allocations
});

async function hydrateOrder(
  sql: Executor,
  tenantId: string,
  id: string
): Promise<ProductionOrder | undefined> {
  const rows = await sql<
    OrderRow[]
  >`select * from production.production_orders where tenant_id = ${tenantId} and id = ${id}`;
  const row = rows[0];
  if (!row) return undefined;
  const lines = await sql<
    LineRow[]
  >`select * from production.production_order_lines where tenant_id = ${tenantId} and production_order_id = ${id} order by formula_line_order`;
  const allocations = await sql<
    AllocationRow[]
  >`select * from production.production_material_allocations where tenant_id = ${tenantId} and production_order_id = ${id} order by id`;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderNumber: row.order_number,
    formulaVersionId: row.formula_version_id,
    formulaBundleHash: row.formula_bundle_hash,
    targetMassMg: mass(row.target_mass_mg),
    status: row.status,
    releaseReadinessAssessmentId: row.release_readiness_assessment_id,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    releasedByUserId: row.released_by_user_id,
    cancelledByUserId: row.cancelled_by_user_id,
    completedByUserId: row.completed_by_user_id,
    abortedByUserId: row.aborted_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    releasedAt: row.released_at,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    abortedAt: row.aborted_at,
    lines: lines.map(mapLine),
    allocations: allocations.map(mapAllocation)
  };
}
async function hydrateBatch(
  sql: Executor,
  tenantId: string,
  id: string
): Promise<ProductionBatch | undefined> {
  const rows = await sql<
    BatchRow[]
  >`select * from production.production_batches where tenant_id = ${tenantId} and id = ${id}`;
  if (!rows[0]) return undefined;
  const allocations = await sql<
    AllocationRow[]
  >`select * from production.production_material_allocations where tenant_id = ${tenantId} and production_order_id = ${rows[0].production_order_id} order by id`;
  return mapBatch(rows[0], allocations.map(mapAllocation));
}
function audit(
  tx: TransactionSql,
  c: ProductionCommandContext,
  action: string,
  type: string,
  id: string,
  metadata: Record<string, unknown> = {}
) {
  return tx`insert into platform.audit_events (tenant_id, actor_user_id, action, resource_type, resource_id, request_id, correlation_id, metadata) values (${c.tenantId}, ${c.actorUserId}, ${action}, ${type}, ${id}, ${c.requestId}, ${c.correlationId}, ${tx.json(JSON.parse(JSON.stringify(metadata)))})`;
}

export class PostgresProductionStore implements ProductionStore {
  private readonly readiness: ProductionReadinessSource;
  constructor(
    private readonly sql: Sql,
    readiness?: ProductionReadinessSource
  ) {
    this.readiness = readiness ?? createPostgresProductionReadinessSource(sql);
  }
  async listOrders(tenantId: string) {
    const rows = await this.sql<
      { id: string }[]
    >`select id from production.production_orders where tenant_id = ${tenantId} order by updated_at desc, id`;
    return (await Promise.all(rows.map((r) => hydrateOrder(this.sql, tenantId, r.id)))).filter(
      (v): v is ProductionOrder => Boolean(v)
    );
  }
  findOrder(tenantId: string, id: string) {
    return hydrateOrder(this.sql, tenantId, id);
  }
  async createOrder(
    c: ProductionCommandContext & CreateProductionOrderRequest
  ): Promise<ProductionOrder> {
    const formula = await createPostgresDesignStudioStore(this.sql).findFrozenFormulaVersion(
      c.tenantId,
      c.formulaVersionId
    );
    this.assertFormula(formula);
    const scaled = this.scale(formula, c.targetMassMg);
    const id = await this.sql.begin(async (tx) => {
      const rows = await tx<
        { id: string }[]
      >`insert into production.production_orders (tenant_id, order_number, formula_version_id, formula_bundle_hash, target_mass_mg, notes, created_by_user_id) values (${c.tenantId}, ${c.orderNumber}, ${c.formulaVersionId}, ${formula.bundleHash}, ${c.targetMassMg}, ${c.notes ?? null}, ${c.actorUserId}) returning id`;
      for (const [index, line] of scaled.entries()) {
        const source = formula.candidate.lines[index];
        await tx`insert into production.production_order_lines (tenant_id, production_order_id, formula_line_order, material_id, required_mass_mg, material_snapshot_hash) values (${c.tenantId}, ${rows[0].id}, ${index + 1}, ${line.materialId}, ${line.scaledMassMg}, ${source.materialSnapshot.snapshotHash})`;
      }
      await audit(tx, c, "production.order.created", "ProductionOrder", rows[0].id, {
        formulaVersionId: c.formulaVersionId,
        formulaBundleHash: formula.bundleHash,
        targetMassMg: c.targetMassMg
      });
      return rows[0].id;
    });
    return (await hydrateOrder(this.sql, c.tenantId, id))!;
  }
  async updateOrder(
    c: ProductionCommandContext & { orderId: string } & UpdateProductionOrderRequest
  ): Promise<ProductionOrder> {
    const current = await this.findOrder(c.tenantId, c.orderId);
    if (!current)
      throw new ProductionProblem(
        404,
        "PRODUCTION_ORDER_NOT_FOUND",
        "Production order was not found."
      );
    if (current.status !== "DRAFT")
      throw new ProductionProblem(
        409,
        "PRODUCTION_ORDER_NOT_EDITABLE",
        "Only DRAFT orders may be edited."
      );
    const nextMass = c.targetMassMg ?? current.targetMassMg;
    const formula = await createPostgresDesignStudioStore(this.sql).findFrozenFormulaVersion(
      c.tenantId,
      current.formulaVersionId
    );
    this.assertFormula(formula);
    const scaled = this.scale(formula, nextMass);
    await this.sql.begin(async (tx) => {
      await tx`select id from production.production_orders where tenant_id = ${c.tenantId} and id = ${c.orderId} and status = 'DRAFT' for update`;
      await tx`update production.production_orders set target_mass_mg = ${nextMass}, notes = ${c.notes === undefined ? current.notes : c.notes}, updated_at = now() where tenant_id = ${c.tenantId} and id = ${c.orderId}`;
      if (c.targetMassMg) {
        await tx`delete from production.production_material_allocations where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId}`;
        await tx`delete from production.production_order_lines where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId}`;
        for (const [index, line] of scaled.entries())
          await tx`insert into production.production_order_lines (tenant_id, production_order_id, formula_line_order, material_id, required_mass_mg, material_snapshot_hash) values (${c.tenantId}, ${c.orderId}, ${index + 1}, ${line.materialId}, ${line.scaledMassMg}, ${formula.candidate.lines[index].materialSnapshot.snapshotHash})`;
      }
      await audit(tx, c, "production.order.updated", "ProductionOrder", c.orderId, {
        targetMassMg: nextMass
      });
    });
    return (await hydrateOrder(this.sql, c.tenantId, c.orderId))!;
  }
  async updateAllocations(
    c: ProductionCommandContext & { orderId: string; allocations: readonly AllocationInput[] }
  ): Promise<ProductionOrder> {
    await this.sql.begin(async (tx) => {
      const order = await this.lockOrder(tx, c.tenantId, c.orderId);
      if (order.status !== "DRAFT")
        throw new ProductionProblem(
          409,
          "PRODUCTION_ORDER_NOT_EDITABLE",
          "Only DRAFT orders may allocate."
        );
      const lines = await tx<
        LineRow[]
      >`select * from production.production_order_lines where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId} order by formula_line_order`;
      this.validateAllocations(lines, c.allocations);
      await tx`delete from production.production_material_allocations where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId}`;
      for (const item of c.allocations) {
        const line = lines.find((l) => l.id === item.productionOrderLineId);
        if (!line)
          throw new ProductionProblem(
            409,
            "PRODUCTION_ALLOCATION_MISMATCH",
            "Allocation line is not part of the order."
          );
        await tx`insert into production.production_material_allocations (tenant_id, production_order_id, production_order_line_id, material_id, inventory_lot_id, inventory_location_id, allocated_mass_mg, reservation_operation_key, consumption_operation_key, created_by_user_id) values (${c.tenantId}, ${c.orderId}, ${item.productionOrderLineId}, ${line.material_id}, ${item.lotId}, ${item.locationId}, ${item.allocatedMassMg}, ${`production:order:${c.orderId}:allocation:${item.productionOrderLineId}:${item.lotId}:reserve`}, ${`production:order:${c.orderId}:allocation:${item.productionOrderLineId}:${item.lotId}:consume`}, ${c.actorUserId})`;
      }
      await audit(tx, c, "production.allocations.updated", "ProductionOrder", c.orderId);
    });
    return (await this.findOrder(c.tenantId, c.orderId))!;
  }
  async releaseOrder(c: ProductionCommandContext & { orderId: string }): Promise<ProductionOrder> {
    await this.sql.begin(async (tx) => {
      const order = await this.lockOrder(tx, c.tenantId, c.orderId);
      if (order.status === "RELEASED") return;
      if (order.status !== "DRAFT")
        throw new ProductionProblem(
          409,
          "PRODUCTION_ORDER_NOT_RELEASABLE",
          "Only DRAFT orders may be released."
        );
      const readiness = this.requireReady(
        await this.readiness.resolveCurrentForFormula({
          tenantId: c.tenantId,
          formulaVersionId: order.formula_version_id,
          formulaBundleHash: order.formula_bundle_hash
        })
      );
      const lines = await tx<
        LineRow[]
      >`select * from production.production_order_lines where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId} order by formula_line_order`;
      const allocations = await tx<
        AllocationRow[]
      >`select * from production.production_material_allocations where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId} order by inventory_lot_id, inventory_location_id, id`;
      this.validateAllocationRows(lines, allocations);
      const ids: Record<string, string> = {};
      for (const a of allocations) {
        const r = await reserveProductionLotInTransaction(tx, {
          tenantId: c.tenantId,
          actorUserId: c.actorUserId,
          requestId: c.requestId,
          correlationId: c.correlationId,
          lotId: a.inventory_lot_id,
          materialId: a.material_id,
          locationId: a.inventory_location_id,
          quantityMg: mass(a.allocated_mass_mg),
          sourceReferenceId: a.id,
          operationKey: a.reservation_operation_key
        });
        ids[a.id] = r.id;
      }
      for (const a of allocations)
        await tx`update production.production_material_allocations set inventory_reservation_id = ${ids[a.id]} where tenant_id = ${c.tenantId} and id = ${a.id}`;
      await tx`update production.production_orders set status = 'RELEASED', release_readiness_assessment_id = ${readiness.assessmentId}, released_by_user_id = ${c.actorUserId}, released_at = now(), updated_at = now() where tenant_id = ${c.tenantId} and id = ${c.orderId}`;
      await audit(tx, c, "production.order.released", "ProductionOrder", c.orderId, {
        assessmentId: readiness.assessmentId
      });
    });
    return (await this.findOrder(c.tenantId, c.orderId))!;
  }
  async cancelOrder(c: ProductionCommandContext & { orderId: string }): Promise<ProductionOrder> {
    await this.sql.begin(async (tx) => {
      const order = await this.lockOrder(tx, c.tenantId, c.orderId);
      if (order.status === "CANCELLED") return;
      if (order.status === "DRAFT") {
        await tx`update production.production_orders set status = 'CANCELLED', cancelled_by_user_id = ${c.actorUserId}, cancelled_at = now(), updated_at = now() where tenant_id = ${c.tenantId} and id = ${c.orderId}`;
      } else if (order.status === "RELEASED") {
        const reservations = await tx<
          { id: string }[]
        >`select inventory_reservation_id as id from production.production_material_allocations where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId} and inventory_reservation_id is not null order by inventory_reservation_id for update`;
        for (const r of reservations)
          await releaseProductionReservationInTransaction(tx, {
            tenantId: c.tenantId,
            actorUserId: c.actorUserId,
            requestId: c.requestId,
            correlationId: c.correlationId,
            reservationId: r.id,
            operationKey: `production:cancel:${c.orderId}:${r.id}`
          });
        await tx`update production.production_orders set status = 'CANCELLED', cancelled_by_user_id = ${c.actorUserId}, cancelled_at = now(), updated_at = now() where tenant_id = ${c.tenantId} and id = ${c.orderId}`;
      } else
        throw new ProductionProblem(
          409,
          "PRODUCTION_ORDER_ALREADY_TERMINAL",
          "Order cannot be cancelled after start."
        );
      await audit(tx, c, "production.order.cancelled", "ProductionOrder", c.orderId);
    });
    return (await this.findOrder(c.tenantId, c.orderId))!;
  }
  async startOrder(c: ProductionCommandContext & { orderId: string }): Promise<ProductionBatch> {
    const batchId = await (this.sql.begin(async (tx) => {
      const order = await this.lockOrder(tx, c.tenantId, c.orderId);
      if (order.status === "IN_PROGRESS") {
        const existing = await tx<
          { id: string }[]
        >`select id from production.production_batches where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId}`;
        if (existing[0]) return existing[0].id;
      }
      if (order.status !== "RELEASED")
        throw new ProductionProblem(
          409,
          "PRODUCTION_ORDER_NOT_RELEASED",
          "Only RELEASED orders may start."
        );
      const readiness = this.requireReady(
        await this.readiness.resolveCurrentForFormula({
          tenantId: c.tenantId,
          formulaVersionId: order.formula_version_id,
          formulaBundleHash: order.formula_bundle_hash
        })
      );
      const allocations = await tx<
        AllocationRow[]
      >`select * from production.production_material_allocations where tenant_id = ${c.tenantId} and production_order_id = ${c.orderId} order by inventory_lot_id, inventory_location_id, id for update`;
      if (allocations.some((a) => !a.inventory_reservation_id))
        throw new ProductionProblem(
          409,
          "PRODUCTION_ALLOCATION_MISMATCH",
          "Every allocation must have a reservation."
        );
      for (const a of allocations) {
        const r = await consumeProductionReservationInTransaction(tx, {
          tenantId: c.tenantId,
          actorUserId: c.actorUserId,
          requestId: c.requestId,
          correlationId: c.correlationId,
          reservationId: a.inventory_reservation_id!,
          operationKey: a.consumption_operation_key
        });
        await tx`update production.production_material_allocations set inventory_consumption_movement_id = ${r.consumedMovementId} where tenant_id = ${c.tenantId} and id = ${a.id}`;
      }
      if (!order.release_readiness_assessment_id)
        throw new ProductionProblem(
          409,
          "PRODUCTION_READINESS_MISSING",
          "Release readiness is missing."
        );
      const batch = await tx<
        BatchRow[]
      >`insert into production.production_batches (tenant_id, batch_number, production_order_id, formula_version_id, formula_bundle_hash, release_readiness_assessment_id, start_readiness_assessment_id, target_mass_mg, started_by_user_id) values (${c.tenantId}, ${`B-${c.orderId.slice(0, 8)}`}, ${c.orderId}, ${order.formula_version_id}, ${order.formula_bundle_hash}, ${order.release_readiness_assessment_id}, ${readiness.assessmentId}, ${String(order.target_mass_mg)}, ${c.actorUserId}) returning *`;
      await tx`update production.production_orders set status = 'IN_PROGRESS', updated_at = now() where tenant_id = ${c.tenantId} and id = ${c.orderId}`;
      await audit(tx, c, "production.batch.started", "ProductionBatch", batch[0].id, {
        assessmentId: readiness.assessmentId
      });
      return batch[0].id;
    }) as unknown as Promise<string>);
    return (await this.findBatch(c.tenantId, batchId))!;
  }
  async completeBatch(
    c: ProductionCommandContext & {
      batchId: string;
      actualOutputMassMg: QuantityMg;
      processNotes?: string | null;
    }
  ): Promise<ProductionBatch> {
    await this.sql.begin(async (tx) => {
      const batch = await this.lockBatch(tx, c.tenantId, c.batchId);
      if (batch.completed_at || batch.aborted_at)
        throw new ProductionProblem(
          409,
          "PRODUCTION_BATCH_NOT_IN_PROGRESS",
          "Batch is already terminal."
        );
      await tx`update production.production_batches set actual_output_mass_mg = ${c.actualOutputMassMg}, process_notes = ${c.processNotes ?? null}, completed_by_user_id = ${c.actorUserId}, completed_at = now() where tenant_id = ${c.tenantId} and id = ${c.batchId}`;
      await tx`update production.production_orders set status = 'COMPLETED', completed_by_user_id = ${c.actorUserId}, completed_at = now(), updated_at = now() where tenant_id = ${c.tenantId} and id = ${batch.production_order_id}`;
      await audit(tx, c, "production.batch.completed", "ProductionBatch", c.batchId, {
        actualOutputMassMg: c.actualOutputMassMg
      });
    });
    return (await this.findBatch(c.tenantId, c.batchId))!;
  }
  async abortBatch(
    c: ProductionCommandContext & { batchId: string; reason: string }
  ): Promise<ProductionBatch> {
    await this.sql.begin(async (tx) => {
      const batch = await this.lockBatch(tx, c.tenantId, c.batchId);
      if (batch.completed_at || batch.aborted_at)
        throw new ProductionProblem(
          409,
          "PRODUCTION_BATCH_NOT_IN_PROGRESS",
          "Batch is already terminal."
        );
      if (!c.reason.trim())
        throw new ProductionProblem(
          400,
          "PRODUCTION_ABORT_REASON_REQUIRED",
          "Abort reason is required."
        );
      await tx`update production.production_batches set abort_reason = ${c.reason.trim()}, aborted_by_user_id = ${c.actorUserId}, aborted_at = now() where tenant_id = ${c.tenantId} and id = ${c.batchId}`;
      await tx`update production.production_orders set status = 'ABORTED', aborted_by_user_id = ${c.actorUserId}, aborted_at = now(), updated_at = now() where tenant_id = ${c.tenantId} and id = ${batch.production_order_id}`;
      await audit(tx, c, "production.batch.aborted", "ProductionBatch", c.batchId, {
        reason: c.reason.trim()
      });
    });
    return (await this.findBatch(c.tenantId, c.batchId))!;
  }
  findBatch(tenantId: string, id: string) {
    return hydrateBatch(this.sql, tenantId, id);
  }
  async findBatchForOrder(tenantId: string, orderId: string) {
    const rows = await this.sql<
      { id: string }[]
    >`select id from production.production_batches where tenant_id = ${tenantId} and production_order_id = ${orderId}`;
    return rows[0] ? hydrateBatch(this.sql, tenantId, rows[0].id) : undefined;
  }
  private assertFormula(
    formula: FrozenFormulaVersion | undefined
  ): asserts formula is FrozenFormulaVersion {
    if (!formula)
      throw new ProductionProblem(
        404,
        "PRODUCTION_FORMULA_NOT_FOUND",
        "Frozen FormulaVersion was not found."
      );
    if (formula.status !== "FROZEN")
      throw new ProductionProblem(
        409,
        "PRODUCTION_FORMULA_NOT_APPROVED",
        "FormulaVersion is not frozen."
      );
    if (formula.approvalState !== "APPROVED")
      throw new ProductionProblem(
        409,
        "PRODUCTION_FORMULA_NOT_APPROVED",
        "FormulaVersion is not approved."
      );
    if (formula.compositionKind !== "FULL_FORMULA")
      throw new ProductionProblem(
        409,
        "PRODUCTION_FORMULA_NOT_FULL",
        "Production requires a FULL_FORMULA."
      );
  }
  private scale(formula: FrozenFormulaVersion, target: QuantityMg) {
    try {
      const scaled = scaleFormulaMasses(
        formula.candidate.lines.map((l) => ({
          materialId: l.materialId,
          normalizedMassMg: l.normalizedMassMg
        })),
        target
      );
      if (findBelowWeighableResolution(scaled).length)
        throw new ProductionProblem(
          409,
          "PRODUCTION_BELOW_WEIGHABLE_RESOLUTION",
          "A requirement is below weighable resolution."
        );
      return scaled;
    } catch (e) {
      if (e instanceof ProductionProblem) throw e;
      throw new ProductionProblem(
        400,
        "PRODUCTION_BELOW_WEIGHABLE_RESOLUTION",
        "Formula cannot be scaled to the requested mass."
      );
    }
  }
  private requireReady(
    r: Awaited<ReturnType<ProductionReadinessSource["resolveCurrentForFormula"]>>
  ): Extract<typeof r, { status: "RESOLVED" }> {
    if (r.status === "MISSING")
      throw new ProductionProblem(
        409,
        "PRODUCTION_READINESS_MISSING",
        "Current release readiness is missing."
      );
    if (r.status === "AMBIGUOUS")
      throw new ProductionProblem(
        409,
        "PRODUCTION_READINESS_AMBIGUOUS",
        "Current release readiness is ambiguous."
      );
    if (r.decision !== "READY")
      throw new ProductionProblem(
        409,
        "PRODUCTION_NOT_READY",
        "Formula is not currently release-ready."
      );
    return r;
  }
  private async lockOrder(tx: TransactionSql, tenantId: string, id: string): Promise<OrderRow> {
    const rows = await tx<
      OrderRow[]
    >`select * from production.production_orders where tenant_id = ${tenantId} and id = ${id} for update`;
    if (!rows[0])
      throw new ProductionProblem(
        404,
        "PRODUCTION_ORDER_NOT_FOUND",
        "Production order was not found."
      );
    return rows[0];
  }
  private async lockBatch(tx: TransactionSql, tenantId: string, id: string): Promise<BatchRow> {
    const rows = await tx<
      BatchRow[]
    >`select * from production.production_batches where tenant_id = ${tenantId} and id = ${id} for update`;
    if (!rows[0])
      throw new ProductionProblem(
        404,
        "PRODUCTION_BATCH_NOT_FOUND",
        "Production batch was not found."
      );
    return rows[0];
  }
  private validateAllocations(lines: readonly LineRow[], allocations: readonly AllocationInput[]) {
    const byLine = new Map<string, bigint>();
    for (const a of allocations) {
      if (!lines.some((l) => l.id === a.productionOrderLineId))
        throw new ProductionProblem(
          409,
          "PRODUCTION_ALLOCATION_MISMATCH",
          "Allocation line is not part of the order."
        );
      byLine.set(
        a.productionOrderLineId,
        (byLine.get(a.productionOrderLineId) ?? 0n) + BigInt(a.allocatedMassMg)
      );
    }
    for (const l of lines)
      if (byLine.get(l.id) !== BigInt(l.required_mass_mg))
        throw new ProductionProblem(
          409,
          "PRODUCTION_ALLOCATION_MISMATCH",
          "Allocations must exactly match requirements."
        );
  }
  private validateAllocationRows(lines: readonly LineRow[], allocations: readonly AllocationRow[]) {
    this.validateAllocations(
      lines,
      allocations.map((a) => ({
        productionOrderLineId: a.production_order_line_id,
        lotId: a.inventory_lot_id,
        locationId: a.inventory_location_id,
        allocatedMassMg: mass(a.allocated_mass_mg)
      }))
    );
  }
}
