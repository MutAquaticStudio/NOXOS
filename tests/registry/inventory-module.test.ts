import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { resolveModuleAvailability, validateModuleDefinitions } from "@nox-os/module-registry";

const expectedPermissions = [
  "module.inventory.read",
  "module.inventory.location.manage",
  "module.inventory.lot.create",
  "module.inventory.lot.manage",
  "module.inventory.stock.receive",
  "module.inventory.stock.transfer",
  "module.inventory.stock.consume",
  "module.inventory.stock.adjust",
  "module.inventory.stock.dispose",
  "module.inventory.reservation.manage"
] as const;

describe("Gate 7 Inventory module authority", () => {
  it("registers one product route and one namespaced authorization manifest", () => {
    expect(() => validateModuleDefinitions(moduleDefinitions)).not.toThrow();
    const definition = moduleDefinitions.find((item) => item.descriptor.id === "inventory")!;
    expect(definition.descriptor).toMatchObject({
      routeRoot: "/inventory",
      apiNamespace: "inventory",
      entitlement: "module.inventory",
      featureFlag: "module.inventory",
      lifecycle: "ACTIVE"
    });
    expect(definition.authorization.permissions).toEqual(expectedPermissions);
    expect(definition.authorization.defaultRoleGrants.TENANT_MEMBER).toEqual([
      "module.inventory.read"
    ]);
  });

  it("fails closed without flag, entitlement, or read permission", () => {
    const definition = moduleDefinitions.find((item) => item.descriptor.id === "inventory")!;
    const available = resolveModuleAvailability(definition.descriptor, {
      featureFlags: new Set(["module.inventory"]),
      entitlements: new Set(["module.inventory"]),
      permissions: new Set(["module.inventory.read"])
    });
    expect(available.state).toBe("AVAILABLE");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(["module.inventory"]),
        entitlements: new Set(),
        permissions: new Set(["module.inventory.read"])
      }).state
    ).toBe("NOT_ENTITLED");
    expect(
      resolveModuleAvailability(definition.descriptor, {
        featureFlags: new Set(["module.inventory"]),
        entitlements: new Set(["module.inventory"]),
        permissions: new Set()
      }).state
    ).toBe("NO_PERMISSION");
  });
});
