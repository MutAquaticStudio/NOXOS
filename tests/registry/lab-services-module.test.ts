import { describe, expect, it } from "vitest";
import { resolveDefinitionAvailability, validateModuleDefinitions } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

describe("Lab Services module registration", () => {
  const definition = moduleDefinitions.find((item) => item.descriptor.id === "lab-services")!;
  it("owns one product route/API namespace without G4 or G10 dependencies", () => {
    expect(definition.descriptor).toMatchObject({
      routeRoot: "/lab-services",
      apiNamespace: "lab-services",
      entitlement: "module.lab-services",
      featureFlag: "module.lab-services",
      dependencies: ["platform"]
    });
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
  });
  it("fails closed without feature flag, entitlement, or read permission", () => {
    const complete = {
      featureFlags: new Set(["module.lab-services"]),
      entitlements: new Set(["module.lab-services"]),
      permissions: new Set(["module.lab-services.read"])
    };
    expect(resolveDefinitionAvailability(definition, complete).state).toBe("AVAILABLE");
    expect(
      resolveDefinitionAvailability(definition, { ...complete, featureFlags: new Set() }).state
    ).toBe("DISABLED");
    expect(
      resolveDefinitionAvailability(definition, { ...complete, entitlements: new Set() }).state
    ).toBe("NOT_ENTITLED");
    expect(
      resolveDefinitionAvailability(definition, { ...complete, permissions: new Set() }).state
    ).toBe("NO_PERMISSION");
  });
});
