import type { ModuleDefinition } from "@nox-os/contracts";
import { moduleDefinitions } from "./definitions.js";

/**
 * Staging-only authorization fixture. It is deliberately not part of the
 * canonical twelve-module registry and is never enabled outside G2 acceptance.
 */
export function foundationTestModuleDefinition(): ModuleDefinition {
  const base = moduleDefinitions[0];
  return {
    ...base,
    descriptor: {
      ...base.descriptor,
      id: "foundation-test",
      displayName: "Foundation Test",
      routeRoot: "/foundation-test",
      childRoutes: [],
      apiNamespace: "foundation-test",
      dependencies: [],
      permissions: [],
      entitlement: undefined,
      featureFlag: "module.foundation-test"
    },
    ui: { ...base.ui, moduleId: "foundation-test" },
    api: { ...base.api, moduleId: "foundation-test", apiNamespace: "foundation-test" },
    authorization: {
      moduleId: "foundation-test",
      permissions: ["module.foundation-test.workspace.read"],
      defaultRoleGrants: {
        TENANT_OWNER: ["module.foundation-test.workspace.read"]
      }
    }
  };
}
