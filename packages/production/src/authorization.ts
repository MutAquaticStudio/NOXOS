export const productionPermissions = {
  read: "module.production.read",
  createOrder: "module.production.order.create",
  editOrder: "module.production.order.edit",
  allocate: "module.production.allocation.manage",
  release: "module.production.order.release",
  cancel: "module.production.order.cancel",
  start: "module.production.batch.start",
  complete: "module.production.batch.complete",
  abort: "module.production.batch.abort"
} as const;
export type ProductionPermission =
  (typeof productionPermissions)[keyof typeof productionPermissions];
