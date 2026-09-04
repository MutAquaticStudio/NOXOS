export const qualityControlPermissions = {
  read: "module.quality-control.read",
  manageSpecification: "module.quality-control.specification.manage",
  createInspection: "module.quality-control.inspection.create",
  editInspection: "module.quality-control.inspection.edit",
  finalizeInspection: "module.quality-control.inspection.finalize",
  cancelInspection: "module.quality-control.inspection.cancel",
  holdBatch: "module.quality-control.batch.hold",
  releaseBatch: "module.quality-control.batch.release",
  rejectBatch: "module.quality-control.batch.reject"
} as const;

export type QualityControlPermission =
  (typeof qualityControlPermissions)[keyof typeof qualityControlPermissions];
