export const inventoryPermissions = {
  read: "module.inventory.read",
  manageLocation: "module.inventory.location.manage",
  createLot: "module.inventory.lot.create",
  manageLot: "module.inventory.lot.manage",
  receive: "module.inventory.stock.receive",
  transfer: "module.inventory.stock.transfer",
  consume: "module.inventory.stock.consume",
  adjust: "module.inventory.stock.adjust",
  dispose: "module.inventory.stock.dispose",
  manageReservation: "module.inventory.reservation.manage"
} as const;

export type InventoryPermission = (typeof inventoryPermissions)[keyof typeof inventoryPermissions];
