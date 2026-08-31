import { TrialSensoryProblem } from "./problem.js";

export const trialSensoryPermissions = {
  readTrial: "module.trial-sensory.trial.read",
  createTrial: "module.trial-sensory.trial.create",
  prepareTrial: "module.trial-sensory.trial.prepare",
  cancelTrial: "module.trial-sensory.trial.cancel",
  createEvaluation: "module.trial-sensory.evaluation.create",
  editEvaluation: "module.trial-sensory.evaluation.edit",
  finalizeEvaluation: "module.trial-sensory.evaluation.finalize",
  requestRevision: "module.trial-sensory.revision.request",
  recommendApproval: "module.trial-sensory.approval.recommend"
} as const;

export type TrialSensoryPermission =
  (typeof trialSensoryPermissions)[keyof typeof trialSensoryPermissions];

export type TrialSensoryTenantContext = {
  actorUserId: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
};

export function requireTrialSensoryPermission(
  context: TrialSensoryTenantContext,
  permission: TrialSensoryPermission
): void {
  if (!context.permissions.has(permission)) {
    throw new TrialSensoryProblem(403, "PERMISSION_DENIED", "Trial & Sensory permission denied.");
  }
}
