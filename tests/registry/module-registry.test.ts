import { describe, expect, it } from "vitest";
import {
  projectAppRail,
  resolveModuleAvailability,
  validateModuleDefinitions
} from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const expectedModuleIds = [
  "platform",
  "material-intelligence",
  "inventory",
  "procurement",
  "production",
  "sensory-intelligence",
  "compliance",
  "commercial",
  "community",
  "settings",
  "support",
  "design-studio"
];

describe("canonical Module Registry", () => {
  it("preserves all twelve Gate 0 module declarations", () => {
    expect(moduleDefinitions).toHaveLength(12);
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
      moduleDefinitions
        .map((definition) => definition.descriptor.entitlement)
        .filter((value): value is string => Boolean(value))
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
      "settings",
      "support"
    ]);
  });

  it("keeps disabled future modules unavailable even when a UI caller presents flags", () => {
    const inventory = moduleDefinitions.find(
      (definition) => definition.descriptor.id === "inventory"
    );
    if (!inventory) {
      throw new Error("Expected inventory declaration.");
    }

    expect(
      resolveModuleAvailability(inventory.descriptor, {
        featureFlags: new Set(["module.inventory"]),
        entitlements: new Set(["module.inventory"]),
        permissions: new Set(["inventory.read"])
      }).state
    ).toBe("DISABLED");
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
});
