import type { ModuleDefinition } from "@nox-os/contracts";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

/** Test-only manifest: it is never added to the canonical twelve-module registry. */
export function foundationTestDefinition(): ModuleDefinition {
  const base = moduleDefinitions[0];
  return {
    ...base,
    descriptor: {
      ...base.descriptor,
      id: "foundation-test",
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
