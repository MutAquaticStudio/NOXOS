import { describe, expect, it } from "vitest";
import { resolveModuleAvailability, validateModuleDefinitions } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const definition = moduleDefinitions.find((item) => item.descriptor.id === "design-studio");

describe("Design Studio module authority", () => {
  it("owns one canonical product route and one permission namespace", () => {
    expect(definition?.descriptor).toMatchObject({
      routeRoot: "/design-studio",
      childRoutes: [
        "/design-studio/formula",
        "/design-studio/accords",
        "/design-studio/formula-versions/:formulaVersionId"
      ],
      apiNamespace: "design-studio",
      lifecycle: "INTERNAL",
      dependencies: ["platform", "material-intelligence"],
      entitlement: "module.design-studio",
      featureFlag: "module.design-studio",
      permissions: ["module.design-studio.studio.read"]
    });
    expect(definition?.authorization.permissions).toEqual(
      expect.arrayContaining([
        "module.design-studio.project.create",
        "module.design-studio.brief.manage",
        "module.design-studio.intent.confirm",
        "module.design-studio.formula.generate",
        "module.design-studio.accord.plan",
        "module.design-studio.accord.develop",
        "module.design-studio.formula.freeze",
        "module.design-studio.formula.approve",
        "module.design-studio.scientific-artifact.read"
      ])
    );
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
  });

  it("fails closed unless lifecycle, flag, entitlement and read permission all pass", () => {
    if (!definition) throw new Error("Design Studio module definition is missing.");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(["module.design-studio"]),
        entitlements: new Set(["module.design-studio"]),
        permissions: new Set(["module.design-studio.studio.read"])
      }).state
    ).toBe("AVAILABLE");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(["module.design-studio"]),
        entitlements: new Set(),
        permissions: new Set(["module.design-studio.studio.read"])
      }).state
    ).toBe("NOT_ENTITLED");
  });
});
