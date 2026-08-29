import { describe, expect, it } from "vitest";
import type { TenantRequestContext } from "@nox-os/contracts";
import { LocalFeatureFlagResolver, moduleEntitlementKey } from "@nox-os/module-registry";
import { ModuleAccessDeniedError, requireModuleAccess } from "@nox-os/platform";
import { foundationTestDefinition } from "../helpers/foundation-test-module";

const permission = "module.foundation-test.workspace.read";
const definition = foundationTestDefinition();

function context(overrides: Partial<TenantRequestContext> = {}): TenantRequestContext {
  return {
    requestId: "req_module_test",
    correlationId: "corr_module_test",
    environment: "test",
    sourceSha: "g2-test",
    actor: {
      userId: "00000000-0000-4000-8000-000000000001",
      platformRoleKey: null,
      platformPermissions: []
    },
    tenant: { tenantId: "10000000-0000-4000-8000-000000000001", roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions: [permission] },
    entitlements: [moduleEntitlementKey("foundation-test")],
    ...overrides
  };
}

describe("requireModuleAccess", () => {
  const enabled = new LocalFeatureFlagResolver(["module.foundation-test"]);

  it("requires lifecycle, feature flag, entitlement, and module permission", () => {
    expect(() =>
      requireModuleAccess(context(), "foundation-test", permission, {
        definitions: [definition],
        featureFlags: enabled
      })
    ).not.toThrow();

    expect(() =>
      requireModuleAccess(
        context({ authorization: { tenantPermissions: [], modulePermissions: [] } }),
        "foundation-test",
        permission,
        { definitions: [definition], featureFlags: enabled }
      )
    ).toThrow(ModuleAccessDeniedError);

    expect(() =>
      requireModuleAccess(context(), "foundation-test", permission, {
        definitions: [definition],
        featureFlags: new LocalFeatureFlagResolver()
      })
    ).toThrow(ModuleAccessDeniedError);
  });
});
