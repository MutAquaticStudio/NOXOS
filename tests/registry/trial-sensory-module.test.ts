import { describe, expect, it } from "vitest";
import { resolveModuleAvailability } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const permissionKeys = [
  "module.trial-sensory.trial.read",
  "module.trial-sensory.trial.create",
  "module.trial-sensory.trial.prepare",
  "module.trial-sensory.trial.cancel",
  "module.trial-sensory.evaluation.create",
  "module.trial-sensory.evaluation.edit",
  "module.trial-sensory.evaluation.finalize",
  "module.trial-sensory.revision.request",
  "module.trial-sensory.approval.recommend"
];

describe("Trial and Sensory module contract", () => {
  const definition = moduleDefinitions.find((item) => item.descriptor.id === "trial-sensory");

  it("registers the canonical route, entitlement and nine permissions", () => {
    expect(definition?.descriptor).toMatchObject({
      routeRoot: "/trials",
      apiNamespace: "trials",
      entitlement: "module.trial-sensory",
      featureFlag: "module.trial-sensory",
      dependencies: ["platform", "design-studio"]
    });
    expect(definition?.authorization.permissions).toEqual(permissionKeys);
  });

  it("fails closed unless flag, entitlement and read permission are all present", () => {
    if (!definition) throw new Error("Trial and Sensory definition missing.");
    const inputs = {
      featureFlags: new Set(["module.trial-sensory"]),
      entitlements: new Set(["module.trial-sensory"]),
      permissions: new Set(["module.trial-sensory.trial.read"])
    };
    expect(resolveModuleAvailability(definition.descriptor, inputs).state).toBe("AVAILABLE");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        ...inputs,
        entitlements: new Set()
      }).state
    ).toBe("NOT_ENTITLED");
  });
});
