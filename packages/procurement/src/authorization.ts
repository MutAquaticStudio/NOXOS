export const procurementPermissions = {
  read: "module.procurement.read",
  manageSupplier: "module.procurement.supplier.manage",
  manageOffer: "module.procurement.offer.manage",
  createPurchaseOrder: "module.procurement.purchase-order.create",
  editPurchaseOrder: "module.procurement.purchase-order.edit",
  approvePurchaseOrder: "module.procurement.purchase-order.approve",
  closePurchaseOrder: "module.procurement.purchase-order.close",
  cancelPurchaseOrder: "module.procurement.purchase-order.cancel",
  createReceipt: "module.procurement.receipt.create",
  editReceipt: "module.procurement.receipt.edit",
  postReceipt: "module.procurement.receipt.post",
  cancelReceipt: "module.procurement.receipt.cancel"
} as const;

export type ProcurementPermission =
  (typeof procurementPermissions)[keyof typeof procurementPermissions];
