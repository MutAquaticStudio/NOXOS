import { describe, expect, it } from "vitest";
import {
  projectAppRail,
  moduleEntitlementKey,
  registerModuleApiRoutes,
  resolveModuleAvailability,
  validateModuleDefinitions
} from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const expectedModuleIds = [
  "platform",
  "material-intelligence",
  "inventory",
  "procurement",
  "project-operations",
  "lab-services",
  "production",
  "quality-control",
  "sensory-intelligence",
  "compliance",
  "commercial-orders",
  "community",
  "settings",
  "support",
  "design-studio",
  "trial-sensory",
  "release-readiness"
];

describe("canonical Module Registry", () => {
  it("preserves Gate 0 declarations and appends the accepted bounded modules", () => {
    expect(moduleDefinitions).toHaveLength(17);
    expect(moduleDefinitions.map((definition) => definition.descriptor.id)).toEqual(
      expectedModuleIds
    );
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
  });

  it("projects the App Rail from availability rather than a manual navigation list", () => {
    const allFlags = new Set(
      moduleDefinitions
        .map((definition) => definition.descriptor.featureFlag)
        .filter((value): value is string => Boolean(value))
    );
    const allEntitlements = new Set(
      moduleDefinitions.map((definition) => moduleEntitlementKey(definition.descriptor.id))
    );
    const allPermissions = new Set(
      moduleDefinitions.flatMap((definition) => definition.descriptor.permissions)
    );
    const rail = projectAppRail(moduleDefinitions, {
      featureFlags: allFlags,
      entitlements: allEntitlements,
      permissions: allPermissions
    });

    expect(rail.map((item) => item.moduleId)).toEqual([
      "platform",
      "material-intelligence",
      "inventory",
      "procurement",
      "project-operations",
      "lab-services",
      "production",
      "quality-control",
      "commercial-orders",
      "settings",
      "support",
      "design-studio",
      "trial-sensory",
      "release-readiness"
    ]);
  });

  it("projects server-resolved availability without rebuilding a second navigation authority", () => {
    const rail = projectAppRail(moduleDefinitions, [
      {
        moduleId: "settings",
        state: "AVAILABLE",
        visible: true,
        enabled: true
      }
    ]);

    expect(rail.map((item) => item.moduleId)).toEqual(["settings"]);
  });

  it("fails Commercial Orders closed when its entitlement is absent", () => {
    const commercialOrders = moduleDefinitions.find(
      (definition) => definition.descriptor.id === "commercial-orders"
    );
    if (!commercialOrders) {
      throw new Error("Expected Commercial Orders declaration.");
    }

    expect(
      resolveModuleAvailability(commercialOrders.descriptor, {
        featureFlags: new Set(["module.commercial-orders"]),
        entitlements: new Set(),
        permissions: new Set(commercialOrders.descriptor.permissions)
      }).state
    ).toBe("NOT_ENTITLED");
  });

  it("rejects duplicate module API namespaces", () => {
    const collision = moduleDefinitions.map((definition) => ({
      ...definition,
      descriptor: { ...definition.descriptor }
    }));
    collision[1] = {
      ...collision[1],
      descriptor: {
        ...collision[1].descriptor,
        apiNamespace: "platform"
      }
    };

    expect(() => validateModuleDefinitions(collision)).toThrow(/duplicate API namespace/);
  });

  it("rejects route collisions and governance-derived runtime routes", () => {
    const routeCollision = moduleDefinitions.map((definition) => ({
      ...definition,
      descriptor: { ...definition.descriptor }
    }));
    routeCollision[1] = {
      ...routeCollision[1],
      descriptor: {
        ...routeCollision[1].descriptor,
        routeRoot: "/admin"
      }
    };
    expect(() => validateModuleDefinitions(routeCollision)).toThrow(/route collision/);

    const governanceRoute = moduleDefinitions.map((definition) => ({
      ...definition,
      descriptor: { ...definition.descriptor }
    }));
    governanceRoute[1] = {
      ...governanceRoute[1],
      descriptor: {
        ...governanceRoute[1].descriptor,
        routeRoot: "/gate-1/materials"
      }
    };
    expect(() => validateModuleDefinitions(governanceRoute)).toThrow(/forbidden governance route/);
  });

  it("rejects dependency cycles and attempts to claim an OS-owned route", () => {
    const cycle = moduleDefinitions.map((definition) => ({
      ...definition,
      descriptor: { ...definition.descriptor }
    }));
    cycle[0] = {
      ...cycle[0],
      descriptor: { ...cycle[0].descriptor, dependencies: ["material-intelligence"] }
    };
    expect(() => validateModuleDefinitions(cycle)).toThrow(/dependency cycle/);

    const osRouteCollision = moduleDefinitions.map((definition) => ({
      ...definition,
      descriptor: { ...definition.descriptor }
    }));
    osRouteCollision[1] = {
      ...osRouteCollision[1],
      descriptor: { ...osRouteCollision[1].descriptor, routeRoot: "/login" }
    };
    expect(() => validateModuleDefinitions(osRouteCollision)).toThrow(
      /OS route reserved|route collision/
    );
  });

  it("requires a complete UX profile whose identity and mobile priority match its descriptor", () => {
    const mismatch = moduleDefinitions.map((definition) => ({
      ...definition,
      descriptor: { ...definition.descriptor },
      uxProfile: { ...definition.uxProfile }
    }));
    mismatch[1] = {
      ...mismatch[1],
      uxProfile: { ...mismatch[1].uxProfile, id: "wrong-profile" }
    };

    expect(() => validateModuleDefinitions(mismatch)).toThrow(/UX profile mismatch/);
  });

  it("registers the active Commercial Orders namespace through the canonical registry", () => {
    const registeredPaths: string[] = [];
    registerModuleApiRoutes(moduleDefinitions, {
      get(path) {
        registeredPaths.push(path);
      },
      register(_method, path) {
        registeredPaths.push(path);
      }
    });

    expect(registeredPaths).toContain("/materials/foundation");
    expect(registeredPaths).toContain("/inventory/foundation");
    expect(registeredPaths).toContain("/procurement/foundation");
    expect(registeredPaths).toContain("/commercial-orders/foundation");
  });
});
