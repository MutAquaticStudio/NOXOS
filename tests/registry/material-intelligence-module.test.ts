import { describe, expect, it } from "vitest";
import { resolveDefinitionAvailability, validateModuleDefinitions } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const definition = moduleDefinitions.find((item) => item.descriptor.id === "material-intelligence");

describe("G3-A Material Intelligence Module contract", () => {
  it("registers the canonical entitlement, five tenant permissions, grants, and platform authority", () => {
    expect(definition).toBeDefined();
    expect(definition?.descriptor.entitlement).toBe("module.material-intelligence");
    expect(definition?.descriptor.routeRoot).toBe("/materials");
    expect(definition?.descriptor.childRoutes).toEqual([
      "/materials/new",
      "/materials/:materialId",
      "/materials/review",
      "/materials/review/:requestId"
    ]);
    expect(definition?.authorization.permissions).toEqual([
      "module.material-intelligence.material.read",
      "module.material-intelligence.material.create",
      "module.material-intelligence.material.request-change",
      "module.material-intelligence.material.approve",
      "module.material-intelligence.material.share"
    ]);
    expect(definition?.authorization.defaultRoleGrants.TENANT_MEMBER).toEqual([
      "module.material-intelligence.material.read",
      "module.material-intelligence.material.create",
      "module.material-intelligence.material.request-change"
    ]);
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
  });

  it("keeps the module available for a member who has its read capability without granting review actions", () => {
    expect(
      resolveDefinitionAvailability(definition!, {
        featureFlags: new Set(["module.material-intelligence"]),
        entitlements: new Set(["module.material-intelligence"]),
        permissions: new Set(["module.material-intelligence.material.read"])
      })
    ).toMatchObject({ state: "AVAILABLE", enabled: true });
  });
});
