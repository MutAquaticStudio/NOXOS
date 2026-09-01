import type {
  CreateGoodsReceiptRequest,
  CreatePurchaseOrderRequest,
  CreateSupplierOfferRequest,
  CreateSupplierRequest,
  ProcurementCommandContext,
  UpdateGoodsReceiptRequest,
  UpdatePurchaseOrderRequest,
  UpdateSupplierOfferRequest,
  UpdateSupplierRequest
} from "./contracts.js";
import type { ProcurementMaterialSource, ProcurementStore } from "./persistence.js";
import { ProcurementProblem } from "./problem.js";

export class ProcurementApplication {
  constructor(
    readonly store: ProcurementStore,
    private readonly materials: ProcurementMaterialSource
  ) {}

  listSuppliers(tenantId: string) {
    return this.store.listSuppliers(tenantId);
  }
  findSupplier(tenantId: string, supplierId: string) {
    return this.store.findSupplier(tenantId, supplierId);
  }
  createSupplier(context: ProcurementCommandContext, input: CreateSupplierRequest) {
    return this.store.createSupplier({ ...context, ...input });
  }
  updateSupplier(
    context: ProcurementCommandContext,
    supplierId: string,
    changes: UpdateSupplierRequest
  ) {
    return this.store.updateSupplier({ ...context, supplierId, changes });
  }

  listSupplierOffers(tenantId: string, supplierId?: string) {
    return this.store.listSupplierOffers(tenantId, supplierId);
  }
  async createSupplierOffer(context: ProcurementCommandContext, input: CreateSupplierOfferRequest) {
    await this.requireMaterial(context.tenantId, input.materialId);
    return this.store.createSupplierOffer({ ...context, ...input });
  }
  updateSupplierOffer(
    context: ProcurementCommandContext,
    offerId: string,
    changes: UpdateSupplierOfferRequest
  ) {
    return this.store.updateSupplierOffer({ ...context, offerId, changes });
  }

  listPurchaseOrders(tenantId: string) {
    return this.store.listPurchaseOrders(tenantId);
  }
  findPurchaseOrder(tenantId: string, purchaseOrderId: string) {
    return this.store.findPurchaseOrder(tenantId, purchaseOrderId);
  }
  async createPurchaseOrder(context: ProcurementCommandContext, input: CreatePurchaseOrderRequest) {
    await Promise.all(
      input.lines.map((line) => this.requireMaterial(context.tenantId, line.materialId))
    );
    return this.store.createPurchaseOrder({ ...context, ...input });
  }
  async updatePurchaseOrder(
    context: ProcurementCommandContext,
    purchaseOrderId: string,
    changes: UpdatePurchaseOrderRequest
  ) {
    if (changes.lines)
      await Promise.all(
        changes.lines.map((line) => this.requireMaterial(context.tenantId, line.materialId))
      );
    return this.store.updatePurchaseOrder({ ...context, purchaseOrderId, changes });
  }
  approvePurchaseOrder(context: ProcurementCommandContext, purchaseOrderId: string) {
    return this.store.approvePurchaseOrder({ ...context, purchaseOrderId });
  }
  cancelPurchaseOrder(context: ProcurementCommandContext, purchaseOrderId: string) {
    return this.store.cancelPurchaseOrder({ ...context, purchaseOrderId });
  }
  closePurchaseOrder(context: ProcurementCommandContext, purchaseOrderId: string) {
    return this.store.closePurchaseOrder({ ...context, purchaseOrderId });
  }

  listGoodsReceipts(tenantId: string) {
    return this.store.listGoodsReceipts(tenantId);
  }
  findGoodsReceipt(tenantId: string, receiptId: string) {
    return this.store.findGoodsReceipt(tenantId, receiptId);
  }
  createGoodsReceipt(context: ProcurementCommandContext, input: CreateGoodsReceiptRequest) {
    return this.store.createGoodsReceipt({ ...context, ...input });
  }
  updateGoodsReceipt(
    context: ProcurementCommandContext,
    receiptId: string,
    changes: UpdateGoodsReceiptRequest
  ) {
    return this.store.updateGoodsReceipt({ ...context, receiptId, changes });
  }
  postGoodsReceipt(context: ProcurementCommandContext, receiptId: string) {
    return this.store.postGoodsReceipt({ ...context, receiptId });
  }
  cancelGoodsReceipt(context: ProcurementCommandContext, receiptId: string) {
    return this.store.cancelGoodsReceipt({ ...context, receiptId });
  }

  private async requireMaterial(tenantId: string, materialId: string): Promise<void> {
    if (!(await this.materials.findTenantAccessibleMaterial(tenantId, materialId)))
      throw new ProcurementProblem(
        404,
        "MATERIAL_NOT_FOUND",
        "Tenant-accessible Material was not found."
      );
  }
}
