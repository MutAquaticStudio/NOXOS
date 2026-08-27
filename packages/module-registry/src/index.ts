import type {
  ApiRouteRegistrar,
  ModuleAvailability,
  ModuleDefinition,
  ModuleDescriptor,
  ModuleLifecycle
} from "@nox-os/contracts";

const forbiddenGovernanceRoute = /(^|\/)(gate-[^/]+|g[0-9]+|phase-[^/]+|milestone-[^/]+)/i;
const knownLifecycles = new Set<ModuleLifecycle>([
  "INTERNAL",
  "BETA",
  "ACTIVE",
  "DISABLED",
  "DEPRECATED"
]);

export type AvailabilityInputs = {
  featureFlags: ReadonlySet<string>;
  entitlements: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
};

export type AppRailItem = {
  moduleId: string;
  label: string;
  routeRoot: string;
  navigationGroup: string;
  uxProfileId: ModuleDescriptor["uxProfileId"];
};

export class RegistryValidationError extends Error {
  constructor(readonly violations: readonly string[]) {
    super("Module Registry validation failed: " + violations.join("; "));
  }
}

function routeCollides(left: string, right: string): boolean {
  return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
}

function isExplicitDelegation(owner: ModuleDescriptor, route: string): boolean {
  return owner.childRoutes.includes(route);
}

export function validateModuleDefinitions(definitions: readonly ModuleDefinition[]): void {
  const violations: string[] = [];
  const ids = new Set<string>();
  const routes = new Map<string, ModuleDescriptor>();
  const namespaces = new Set<string>();

  for (const definition of definitions) {
    const { descriptor, ui, api } = definition;

    if (ids.has(descriptor.id)) {
      violations.push("duplicate module id: " + descriptor.id);
    }
    ids.add(descriptor.id);

    if (!descriptor.routeRoot.startsWith("/")) {
      violations.push("route root must start with /: " + descriptor.id);
    }
    if (forbiddenGovernanceRoute.test(descriptor.routeRoot)) {
      violations.push("forbidden governance route: " + descriptor.routeRoot);
    }
    if (!knownLifecycles.has(descriptor.lifecycle)) {
      violations.push("unknown lifecycle: " + descriptor.id);
    }
    if (!descriptor.uxProfileId) {
      violations.push("missing UX profile: " + descriptor.id);
    }
    if (ui.moduleId !== descriptor.id) {
      violations.push("UI manifest mismatch: " + descriptor.id);
    }
    if (api.moduleId !== descriptor.id || api.apiNamespace !== descriptor.apiNamespace) {
      violations.push("API manifest mismatch: " + descriptor.id);
    }
    if (namespaces.has(descriptor.apiNamespace)) {
      violations.push("duplicate API namespace: " + descriptor.apiNamespace);
    }
    namespaces.add(descriptor.apiNamespace);

    for (const childRoute of descriptor.childRoutes) {
      if (!childRoute.startsWith("/")) {
        violations.push("child route must start with /: " + childRoute);
      }
      if (forbiddenGovernanceRoute.test(childRoute)) {
        violations.push("forbidden governance child route: " + childRoute);
      }
      if (
        !childRoute.startsWith(descriptor.routeRoot + "/") &&
        childRoute !== descriptor.routeRoot
      ) {
        if (!isExplicitDelegation(descriptor, childRoute)) {
          violations.push("undeclared OS route: " + childRoute);
        }
      }
    }

    for (const [existingRoute, existingDescriptor] of routes) {
      if (routeCollides(existingRoute, descriptor.routeRoot)) {
        const delegated =
          existingDescriptor.childRoutes.includes(descriptor.routeRoot) ||
          descriptor.childRoutes.includes(existingRoute);
        if (!delegated) {
          violations.push("route collision: " + existingDescriptor.id + " and " + descriptor.id);
        }
      }
    }

    routes.set(descriptor.routeRoot, descriptor);
  }

  for (const definition of definitions) {
    for (const dependency of definition.descriptor.dependencies) {
      if (!ids.has(dependency)) {
        violations.push(
          "unknown dependency " + dependency + " declared by " + definition.descriptor.id
        );
      }
    }
  }

  if (violations.length > 0) {
    throw new RegistryValidationError(violations);
  }
}

export function resolveModuleAvailability(
  descriptor: ModuleDescriptor,
  inputs: AvailabilityInputs
): ModuleAvailability {
  if (descriptor.lifecycle === "DISABLED" || descriptor.lifecycle === "DEPRECATED") {
    return {
      moduleId: descriptor.id,
      state: "DISABLED",
      visible: false,
      enabled: false,
      reason: "Module lifecycle is disabled."
    };
  }

  if (
    descriptor.lifecycle === "BETA" &&
    descriptor.featureFlag &&
    !inputs.featureFlags.has(descriptor.featureFlag)
  ) {
    return {
      moduleId: descriptor.id,
      state: "BETA_RESTRICTED",
      visible: false,
      enabled: false,
      reason: "Beta feature flag is not enabled."
    };
  }

  if (descriptor.featureFlag && !inputs.featureFlags.has(descriptor.featureFlag)) {
    return {
      moduleId: descriptor.id,
      state: "DISABLED",
      visible: false,
      enabled: false,
      reason: "Feature flag is not enabled."
    };
  }

  if (descriptor.entitlement && !inputs.entitlements.has(descriptor.entitlement)) {
    return {
      moduleId: descriptor.id,
      state: "NOT_ENTITLED",
      visible: false,
      enabled: false,
      reason: "Tenant entitlement is unavailable."
    };
  }

  if (
    descriptor.permissions.length > 0 &&
    !descriptor.permissions.every((item) => inputs.permissions.has(item))
  ) {
    return {
      moduleId: descriptor.id,
      state: "NO_PERMISSION",
      visible: false,
      enabled: false,
      reason: "Required permission is unavailable."
    };
  }

  return {
    moduleId: descriptor.id,
    state: "AVAILABLE",
    visible: true,
    enabled: true
  };
}

export function projectAppRail(
  definitions: readonly ModuleDefinition[],
  inputs: AvailabilityInputs
): AppRailItem[] {
  return definitions
    .map((definition) => ({
      definition,
      availability: resolveModuleAvailability(definition.descriptor, inputs)
    }))
    .filter((item) => item.availability.visible)
    .map(({ definition }) => ({
      moduleId: definition.descriptor.id,
      label: definition.descriptor.displayName,
      routeRoot: definition.descriptor.routeRoot,
      navigationGroup: definition.descriptor.navigationGroup,
      uxProfileId: definition.descriptor.uxProfileId
    }));
}

export function registerModuleApiRoutes(
  definitions: readonly ModuleDefinition[],
  registrar: ApiRouteRegistrar
): void {
  for (const definition of definitions) {
    definition.api.registerRoutes(registrar);
  }
}
