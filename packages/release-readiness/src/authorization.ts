import { ReleaseReadinessProblem } from "./problem.js";

export const releaseReadinessPermissions = {
  read: "module.release-readiness.assessment.read",
  create: "module.release-readiness.assessment.create",
  run: "module.release-readiness.assessment.run",
  review: "module.release-readiness.assessment.review"
} as const;

export type ReleaseReadinessPermission =
  (typeof releaseReadinessPermissions)[keyof typeof releaseReadinessPermissions];

export function requireReleaseReadinessPermission(
  permissions: ReadonlySet<string>,
  permission: ReleaseReadinessPermission
): void {
  if (!permissions.has(permission)) {
    throw new ReleaseReadinessProblem(
      403,
      "PERMISSION_DENIED",
      "Release Readiness permission denied."
    );
  }
}
