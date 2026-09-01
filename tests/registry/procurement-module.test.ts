import { describe, expect, it } from "vitest";
import { resolveModuleAvailability, validateModuleDefinitions } from "@nox-os/module-registry";
import { procurementPermissions } from "@nox-os/procurement";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

describe("Gate 8 Procurement module authority", () => {
  const definition = moduleDefinitions.find((item) => item.descriptor.id === "procurement")!;

  it("registers one canonical product route and permission namespace", () => {
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
    expect(definition.descriptor).toMatchObject({
      routeRoot: "/procurement",
      apiNamespace: "procurement",
      entitlement: "module.procurement",
      featureFlag: "module.procurement",
      lifecycle: "ACTIVE",
      dependencies: ["platform", "material-intelligence", "inventory"]
    });
    expect(definition.authorization.permissions).toEqual(Object.values(procurementPermissions));
    expect(definition.authorization.defaultRoleGrants.TENANT_MEMBER).toEqual([
      procurementPermissions.read
    ]);
  });

  it("fails closed without flag, entitlement, or read permission", () => {
    const available = resolveModuleAvailability(definition.descriptor, {
      featureFlags: new Set(["module.procurement"]),
      entitlements: new Set(["module.procurement"]),
      permissions: new Set([procurementPermissions.read])
    });
    expect(available.state).toBe("AVAILABLE");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(),
        entitlements: new Set(["module.procurement"]),
        permissions: new Set([procurementPermissions.read])
      }).state
    ).toBe("DISABLED");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(["module.procurement"]),
        entitlements: new Set(),
        permissions: new Set([procurementPermissions.read])
      }).state
    ).toBe("NOT_ENTITLED");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(["module.procurement"]),
        entitlements: new Set(["module.procurement"]),
        permissions: new Set()
      }).state
    ).toBe("NO_PERMISSION");
  });
});
