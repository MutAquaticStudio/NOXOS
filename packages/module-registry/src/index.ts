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

const osRouteOwners = new Map<string, string>([
  ["/login", "platform"],
  ["/signup", "platform"],
  ["/dashboard", "platform"],
  ["/admin/tenants", "platform"],
  ["/admin/support", "support"]
]);

const osParentDelegations = new Map<string, string>([["/admin/support", "platform"]]);

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

type RouteClaim = {
  route: string;
  descriptor: ModuleDescriptor;
  kind: "root" | "child";
};

function isNestedRoute(parent: string, candidate: string): boolean {
  return parent !== candidate && candidate.startsWith(parent + "/");
}

function routeIsReservedForAnotherModule(route: string, moduleId: string): boolean {
  const owner = osRouteOwners.get(route);
  return Boolean(owner && owner !== moduleId);
}

function isAllowedCrossModuleOverlap(left: RouteClaim, right: RouteClaim): boolean {
  const [parent, child] = isNestedRoute(left.route, right.route) ? [left, right] : [right, left];

  return (
    parent.kind === "root" &&
    osParentDelegations.get(child.route) === parent.descriptor.id &&
    osRouteOwners.get(child.route) === child.descriptor.id
  );
}

function arraysMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateModuleDefinitions(definitions: readonly ModuleDefinition[]): void {
  const violations: string[] = [];
  const ids = new Set<string>();
  const routeClaims: RouteClaim[] = [];
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
    if (!definition.uxProfile.id || definition.uxProfile.id !== descriptor.uxProfileId) {
      violations.push("UX profile mismatch: " + descriptor.id);
    }
    if (
      definition.uxProfile.primaryTasks.length === 0 ||
      definition.uxProfile.supportedViews.length === 0 ||
      definition.uxProfile.states.length === 0
    ) {
      violations.push("incomplete UX profile: " + descriptor.id);
    }
    if (!arraysMatch(descriptor.mobilePriority, definition.uxProfile.mobilePriority)) {
      violations.push("mobile priority does not match UX profile: " + descriptor.id);
    }
    if (routeIsReservedForAnotherModule(descriptor.routeRoot, descriptor.id)) {
      violations.push("OS route reserved for another module: " + descriptor.routeRoot);
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

    routeClaims.push({ route: descriptor.routeRoot, descriptor, kind: "root" });

    for (const childRoute of descriptor.childRoutes) {
      if (!childRoute.startsWith("/")) {
        violations.push("child route must start with /: " + childRoute);
      }
      if (forbiddenGovernanceRoute.test(childRoute)) {
        violations.push("forbidden governance child route: " + childRoute);
      }
      const isNested =
        childRoute === descriptor.routeRoot || isNestedRoute(descriptor.routeRoot, childRoute);
      const specialOwner = osRouteOwners.get(childRoute);
      if (!isNested && specialOwner !== descriptor.id) {
        violations.push("undeclared OS route: " + childRoute);
      }
      if (routeIsReservedForAnotherModule(childRoute, descriptor.id)) {
        violations.push("OS route reserved for another module: " + childRoute);
      }
      routeClaims.push({ route: childRoute, descriptor, kind: "child" });
    }
  }

  for (let index = 0; index < routeClaims.length; index += 1) {
    const claim = routeClaims[index];
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const otherClaim = routeClaims[otherIndex];
      if (claim.route === otherClaim.route) {
        violations.push(
          (claim.descriptor.id === otherClaim.descriptor.id
            ? "duplicate route claim: "
            : "route collision (duplicate route claim): ") +
            otherClaim.descriptor.id +
            " and " +
            claim.descriptor.id
        );
        continue;
      }
      if (
        claim.descriptor.id !== otherClaim.descriptor.id &&
        routeCollides(claim.route, otherClaim.route) &&
        !isAllowedCrossModuleOverlap(claim, otherClaim)
      ) {
        violations.push(
          "route collision: " + otherClaim.descriptor.id + " and " + claim.descriptor.id
        );
      }
    }
  }

  const definitionById = new Map(
    definitions.map((definition) => [definition.descriptor.id, definition])
  );
  for (const definition of definitions) {
    for (const dependency of definition.descriptor.dependencies) {
      if (!ids.has(dependency)) {
        violations.push(
          "unknown dependency " + dependency + " declared by " + definition.descriptor.id
        );
      }
    }
  }

  const visitState = new Map<string, "VISITING" | "VISITED">();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  const visit = (moduleId: string): void => {
    const state = visitState.get(moduleId);
    if (state === "VISITED") {
      return;
    }
    if (state === "VISITING") {
      const cycle = [...stack.slice(stack.indexOf(moduleId)), moduleId];
      const rendered = cycle.join(" -> ");
      if (!reportedCycles.has(rendered)) {
        violations.push("dependency cycle: " + rendered);
        reportedCycles.add(rendered);
      }
      return;
    }

    const definition = definitionById.get(moduleId);
    if (!definition) {
      return;
    }
    visitState.set(moduleId, "VISITING");
    stack.push(moduleId);
    for (const dependency of definition.descriptor.dependencies) {
      visit(dependency);
    }
    stack.pop();
    visitState.set(moduleId, "VISITED");
  };

  for (const moduleId of definitionById.keys()) {
    visit(moduleId);
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
    if (
      definition.descriptor.lifecycle === "DISABLED" ||
      definition.descriptor.lifecycle === "DEPRECATED"
    ) {
      continue;
    }
    definition.api.registerRoutes(registrar);
  }
}
