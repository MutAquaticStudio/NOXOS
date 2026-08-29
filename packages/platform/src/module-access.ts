import type { ModuleDefinition, TenantRequestContext } from "@nox-os/contracts";
import {
  moduleEntitlementKey,
  resolveDefinitionAvailability,
  type FeatureFlagResolver
} from "@nox-os/module-registry";

export class ModuleAccessDeniedError extends Error {
  constructor(
    readonly moduleId: string,
    readonly permission: string,
    readonly reason: string
  ) {
    super("Module access denied: " + moduleId + " / " + permission + " (" + reason + ")");
  }
}

export type ModuleAccessOptions = {
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
};

/**
 * Canonical future-module guard. The caller must already have resolved a
 * current TenantRequestContext; this helper never trusts client role data.
 */
export function requireModuleAccess(
  context: TenantRequestContext,
  moduleId: string,
  permission: string,
  options: ModuleAccessOptions
): void {
  const definition = options.definitions.find((candidate) => candidate.descriptor.id === moduleId);
  if (!definition || !definition.authorization.permissions.includes(permission)) {
    throw new ModuleAccessDeniedError(moduleId, permission, "UNKNOWN_MODULE_PERMISSION");
  }

  const featureFlags = new Set(
    options.definitions
      .map((candidate) => candidate.descriptor.featureFlag)
      .filter((flag): flag is string => options.featureFlags.isEnabled(flag))
  );
  const availability = resolveDefinitionAvailability(definition, {
    featureFlags,
    entitlements: new Set(context.entitlements),
    permissions: new Set(context.authorization.modulePermissions)
  });
  if (!availability.enabled) {
    throw new ModuleAccessDeniedError(moduleId, permission, availability.state);
  }
  if (!context.entitlements.includes(moduleEntitlementKey(moduleId))) {
    throw new ModuleAccessDeniedError(moduleId, permission, "NOT_ENTITLED");
  }
  if (!context.authorization.modulePermissions.includes(permission)) {
    throw new ModuleAccessDeniedError(moduleId, permission, "NO_PERMISSION");
  }
}
