import type { TenantRequestContext } from "@nox-os/contracts";
import type {
  QualityControlStore,
  QualityCommandContext,
  SpecificationItemInput,
  InspectionResultInput
} from "./contracts.js";

const command = (context: TenantRequestContext): QualityCommandContext => ({
  tenantId: context.tenant.tenantId,
  actorUserId: context.actor.userId,
  requestId: context.requestId,
  correlationId: context.correlationId
});

export class QualityControlApplication {
  constructor(readonly store: QualityControlStore) {}
  listBatches(tenantId: string) {
    return this.store.listBatchViews(tenantId);
  }
  findBatch(tenantId: string, batchId: string) {
    return this.store.findBatchView(tenantId, batchId);
  }
  listSpecifications(tenantId: string) {
    return this.store.listSpecifications(tenantId);
  }
  findSpecification(tenantId: string, specificationId: string) {
    return this.store.findSpecification(tenantId, specificationId);
  }
  createSpecification(
    context: TenantRequestContext,
    input: Parameters<QualityControlStore["createSpecification"]>[0]
  ) {
    return this.store.createSpecification({ ...input, ...command(context) });
  }
  updateSpecification(
    context: TenantRequestContext,
    specificationId: string,
    input: { notes: string | null }
  ) {
    return this.store.updateSpecification({ ...command(context), specificationId, ...input });
  }
  replaceSpecificationItems(
    context: TenantRequestContext,
    specificationId: string,
    items: readonly SpecificationItemInput[]
  ) {
    return this.store.replaceSpecificationItems({ ...command(context), specificationId, items });
  }
  activateSpecification(context: TenantRequestContext, specificationId: string) {
    return this.store.activateSpecification({ ...command(context), specificationId });
  }
  retireSpecification(context: TenantRequestContext, specificationId: string) {
    return this.store.retireSpecification({ ...command(context), specificationId });
  }
  createInspection(
    context: TenantRequestContext,
    input: Parameters<QualityControlStore["createInspection"]>[0]
  ) {
    return this.store.createInspection({ ...input, ...command(context) });
  }
  findInspection(tenantId: string, inspectionId: string) {
    return this.store.findInspection(tenantId, inspectionId);
  }
  updateInspection(
    context: TenantRequestContext,
    inspectionId: string,
    input: { sampleReference?: string | null; notes?: string | null }
  ) {
    return this.store.updateInspection({ ...command(context), inspectionId, ...input });
  }
  replaceInspectionResults(
    context: TenantRequestContext,
    inspectionId: string,
    results: readonly InspectionResultInput[]
  ) {
    return this.store.replaceInspectionResults({ ...command(context), inspectionId, results });
  }
  finalizeInspection(context: TenantRequestContext, inspectionId: string) {
    return this.store.finalizeInspection({ ...command(context), inspectionId });
  }
  cancelInspection(context: TenantRequestContext, inspectionId: string) {
    return this.store.cancelInspection({ ...command(context), inspectionId });
  }
  createReinspection(context: TenantRequestContext, inspectionId: string, retestReason: string) {
    return this.store.createReinspection({ ...command(context), inspectionId, retestReason });
  }
  holdBatch(context: TenantRequestContext, batchId: string, reason: string) {
    return this.store.holdBatch({ ...command(context), batchId, reason });
  }
  releaseBatch(context: TenantRequestContext, batchId: string) {
    return this.store.releaseBatch({ ...command(context), batchId });
  }
  rejectBatch(context: TenantRequestContext, batchId: string, reason: string) {
    return this.store.rejectBatch({ ...command(context), batchId, reason });
  }
}
