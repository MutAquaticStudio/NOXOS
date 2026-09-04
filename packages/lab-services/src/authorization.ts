export const labServicesPermissions = {
  read: "module.lab-services.read",
  manageCustomer: "module.lab-services.customer.manage",
  manageContact: "module.lab-services.contact.manage",
  createServiceOrder: "module.lab-services.service-order.create",
  editServiceOrder: "module.lab-services.service-order.edit",
  confirmServiceOrder: "module.lab-services.service-order.confirm",
  startServiceOrder: "module.lab-services.service-order.start",
  completeServiceOrder: "module.lab-services.service-order.complete",
  cancelServiceOrder: "module.lab-services.service-order.cancel",
  createInteraction: "module.lab-services.interaction.create"
} as const;

export type LabServicesPermission =
  (typeof labServicesPermissions)[keyof typeof labServicesPermissions];
