import type {
  CreateGoodsReceiptRequest,
  CreatePurchaseOrderRequest,
  CreateSupplierOfferRequest,
  CreateSupplierRequest,
  GoodsReceipt,
  ProcurementCommandContext,
  ProcurementMaterialReference,
  PurchaseOrder,
  Supplier,
  SupplierMaterialOffer,
  UpdateGoodsReceiptRequest,
  UpdatePurchaseOrderRequest,
  UpdateSupplierOfferRequest,
  UpdateSupplierRequest
} from "./contracts.js";

export interface ProcurementMaterialSource {
  findTenantAccessibleMaterial(
    tenantId: string,
    materialId: string
  ): Promise<ProcurementMaterialReference | undefined>;
}

export interface ProcurementStore {
  listSuppliers(tenantId: string): Promise<Supplier[]>;
  findSupplier(tenantId: string, supplierId: string): Promise<Supplier | undefined>;
  createSupplier(input: ProcurementCommandContext & CreateSupplierRequest): Promise<Supplier>;
  updateSupplier(
    input: ProcurementCommandContext & { supplierId: string; changes: UpdateSupplierRequest }
  ): Promise<Supplier>;

  listSupplierOffers(tenantId: string, supplierId?: string): Promise<SupplierMaterialOffer[]>;
  createSupplierOffer(
    input: ProcurementCommandContext & CreateSupplierOfferRequest
  ): Promise<SupplierMaterialOffer>;
  updateSupplierOffer(
    input: ProcurementCommandContext & {
      offerId: string;
      changes: UpdateSupplierOfferRequest;
    }
  ): Promise<SupplierMaterialOffer>;

  listPurchaseOrders(tenantId: string): Promise<PurchaseOrder[]>;
  findPurchaseOrder(tenantId: string, purchaseOrderId: string): Promise<PurchaseOrder | undefined>;
  createPurchaseOrder(
    input: ProcurementCommandContext & CreatePurchaseOrderRequest
  ): Promise<PurchaseOrder>;
  updatePurchaseOrder(
    input: ProcurementCommandContext & {
      purchaseOrderId: string;
      changes: UpdatePurchaseOrderRequest;
    }
  ): Promise<PurchaseOrder>;
  approvePurchaseOrder(
    input: ProcurementCommandContext & { purchaseOrderId: string }
  ): Promise<PurchaseOrder>;
  cancelPurchaseOrder(
    input: ProcurementCommandContext & { purchaseOrderId: string }
  ): Promise<PurchaseOrder>;
  closePurchaseOrder(
    input: ProcurementCommandContext & { purchaseOrderId: string }
  ): Promise<PurchaseOrder>;

  listGoodsReceipts(tenantId: string): Promise<GoodsReceipt[]>;
  findGoodsReceipt(tenantId: string, receiptId: string): Promise<GoodsReceipt | undefined>;
  createGoodsReceipt(
    input: ProcurementCommandContext & CreateGoodsReceiptRequest
  ): Promise<GoodsReceipt>;
  updateGoodsReceipt(
    input: ProcurementCommandContext & {
      receiptId: string;
      changes: UpdateGoodsReceiptRequest;
    }
  ): Promise<GoodsReceipt>;
  postGoodsReceipt(input: ProcurementCommandContext & { receiptId: string }): Promise<GoodsReceipt>;
  cancelGoodsReceipt(
    input: ProcurementCommandContext & { receiptId: string }
  ): Promise<GoodsReceipt>;
}
