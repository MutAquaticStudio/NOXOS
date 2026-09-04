import { describe, expect, it } from "vitest";
import { resolveDefinitionAvailability, validateModuleDefinitions } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

describe("Quality Control module registration", () => {
  const definition = moduleDefinitions.find((value) => value.descriptor.id === "quality-control")!;

  it("uses one product namespace and the canonical G10 authority dependencies", () => {
    expect(definition.descriptor).toMatchObject({
      routeRoot: "/quality-control",
      apiNamespace: "quality-control",
      entitlement: "module.quality-control",
      featureFlag: "module.quality-control",
      dependencies: ["platform", "production", "release-readiness"]
    });
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
  });

  it("fails closed without flag, entitlement, or permission", () => {
    const complete = {
      featureFlags: new Set(["module.quality-control"]),
      entitlements: new Set(["module.quality-control"]),
      permissions: new Set(["module.quality-control.read"])
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
