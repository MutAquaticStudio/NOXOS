import { describe, expect, it } from "vitest";
import {
  moduleEntitlementKey,
  resolveDefinitionAvailability,
  validateModuleDefinitions
} from "@nox-os/module-registry";
import { foundationTestDefinition } from "../helpers/foundation-test-module";

describe("ModuleAuthorizationManifest", () => {
  it("accepts a module-owned permission and declared default role grant", () => {
    expect(() => validateModuleDefinitions([foundationTestDefinition()])).not.toThrow();
  });

  it("rejects every forbidden permission-manifest shape", () => {
    const invalid = [
      { permissions: ["module.other.workspace.read"], grants: ["module.other.workspace.read"] },
      { permissions: ["platform.tenant.read"], grants: ["platform.tenant.read"] },
      { permissions: ["tenant.profile.read"], grants: ["tenant.profile.read"] },
      {
        permissions: ["module.foundation-test.workspace.*"],
        grants: ["module.foundation-test.workspace.*"]
      },
      {
        permissions: ["module.foundation-test.workspace.read"],
        grants: ["module.foundation-test.workspace.write"]
      }
    ];

    for (const candidate of invalid) {
      const definition = foundationTestDefinition();
      definition.authorization = {
        ...definition.authorization,
        permissions: candidate.permissions,
        defaultRoleGrants: { TENANT_OWNER: candidate.grants }
      };
      expect(() => validateModuleDefinitions([definition])).toThrow();
    }
  });

  it("rejects duplicate module permissions across manifests", () => {
    const first = foundationTestDefinition();
    const second = foundationTestDefinition();
    second.descriptor = {
      ...second.descriptor,
      id: "foundation-test-two",
      routeRoot: "/foundation-test-two",
      apiNamespace: "foundation-test-two"
    };
    second.ui = { ...second.ui, moduleId: "foundation-test-two" };
    second.api = {
      ...second.api,
      moduleId: "foundation-test-two",
      apiNamespace: "foundation-test-two"
    };
    second.authorization = {
      moduleId: "foundation-test-two",
      permissions: ["module.foundation-test.workspace.read"],
      defaultRoleGrants: { TENANT_OWNER: ["module.foundation-test.workspace.read"] }
    };
    expect(() => validateModuleDefinitions([first, second])).toThrow(/duplicate module permission/);
  });

  it("uses the required lifecycle, flag, entitlement, permission precedence", () => {
    const definition = foundationTestDefinition();
    const inputs = {
      featureFlags: new Set(["module.foundation-test"]),
      entitlements: new Set([moduleEntitlementKey("foundation-test")]),
      permissions: new Set(["module.foundation-test.workspace.read"])
    };
    expect(resolveDefinitionAvailability(definition, inputs).state).toBe("AVAILABLE");

    expect(
      resolveDefinitionAvailability(definition, { ...inputs, permissions: new Set() }).state
    ).toBe("NO_PERMISSION");
    expect(
      resolveDefinitionAvailability(definition, { ...inputs, entitlements: new Set() }).state
    ).toBe("NOT_ENTITLED");
    expect(
      resolveDefinitionAvailability(definition, { ...inputs, featureFlags: new Set() }).state
    ).toBe("DISABLED");
    expect(
      resolveDefinitionAvailability(
        { ...definition, descriptor: { ...definition.descriptor, lifecycle: "DISABLED" } },
        inputs
      ).state
    ).toBe("DISABLED");
  });
});
