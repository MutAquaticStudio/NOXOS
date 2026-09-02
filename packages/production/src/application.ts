import type { TenantRequestContext } from "@nox-os/contracts";
import type {
  ProductionStore,
  CreateProductionOrderRequest,
  UpdateProductionOrderRequest,
  AllocationInput,
  QuantityMg
} from "./contracts.js";
export class ProductionApplication {
  constructor(readonly store: ProductionStore) {}
  listOrders(tenantId: string) {
    return this.store.listOrders(tenantId);
  }
  findOrder(tenantId: string, id: string) {
    return this.store.findOrder(tenantId, id);
  }
  createOrder(c: TenantRequestContext, i: CreateProductionOrderRequest) {
    return this.store.createOrder({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      ...i
    });
  }
  updateOrder(c: TenantRequestContext, id: string, i: UpdateProductionOrderRequest) {
    return this.store.updateOrder({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      orderId: id,
      ...i
    });
  }
  updateAllocations(c: TenantRequestContext, id: string, allocations: readonly AllocationInput[]) {
    return this.store.updateAllocations({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      orderId: id,
      allocations
    });
  }
  releaseOrder(c: TenantRequestContext, id: string) {
    return this.store.releaseOrder({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      orderId: id
    });
  }
  cancelOrder(c: TenantRequestContext, id: string) {
    return this.store.cancelOrder({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      orderId: id
    });
  }
  startOrder(c: TenantRequestContext, id: string) {
    return this.store.startOrder({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      orderId: id
    });
  }
  completeBatch(
    c: TenantRequestContext,
    id: string,
    i: { actualOutputMassMg: QuantityMg; processNotes?: string | null }
  ) {
    return this.store.completeBatch({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      batchId: id,
      ...i
    });
  }
  abortBatch(c: TenantRequestContext, id: string, reason: string) {
    return this.store.abortBatch({
      tenantId: c.tenant.tenantId,
      actorUserId: c.actor.userId,
      requestId: c.requestId,
      correlationId: c.correlationId,
      batchId: id,
      reason
    });
  }
  findBatch(tenantId: string, id: string) {
    return this.store.findBatch(tenantId, id);
  }
  findBatchForOrder(tenantId: string, id: string) {
    return this.store.findBatchForOrder(tenantId, id);
  }
}
