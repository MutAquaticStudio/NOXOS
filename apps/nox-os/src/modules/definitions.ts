import type {
  ApiRouteRegistrar,
  IconToken,
  ModuleDefinition,
  ModuleDescriptor,
  ModuleUxProfile
} from "@nox-os/contracts";

type DefinitionInput = Omit<ModuleDescriptor, "mobilePriority"> & {
  icon: IconToken;
  mobilePriority?: readonly string[];
};

function registerFoundationApi(namespace: string, registrar: ApiRouteRegistrar): void {
  registrar.get("/" + namespace + "/foundation", async (request) => ({
    status: 200,
    body: {
      module: namespace,
      status: "FOUNDATION_ONLY",
      requestId: request.context.requestId
    }
  }));
}

function defineModule(input: DefinitionInput): ModuleDefinition {
  const descriptor: ModuleDescriptor = {
    ...input,
    mobilePriority: input.mobilePriority ?? ["PRIMARY", "SECONDARY"]
  };

  return {
    descriptor,
    ui: {
      moduleId: descriptor.id,
      icon: input.icon,
      load: () => import("./foundation-module")
    },
    api: {
      moduleId: descriptor.id,
      apiNamespace: descriptor.apiNamespace,
      registerRoutes: (registrar) => registerFoundationApi(descriptor.apiNamespace, registrar)
    }
  };
}

const profile = {
  platform: "CONFIGURATION_DATA_GRID",
  materials: "DATA_GRID_REGISTRY",
  operations: "DATA_GRID_OPERATIONS",
  workflow: "OPERATIONS_WORKFLOW",
  studioAnalytics: "STUDIO_ANALYTICS",
  workflowRegistry: "WORKFLOW_REGISTRY",
  studio: "STUDIO"
} as const satisfies Record<string, ModuleUxProfile>;

export const moduleDefinitions: readonly ModuleDefinition[] = [
  defineModule({
    id: "platform",
    displayName: "Platform Admin",
    routeRoot: "/admin",
    childRoutes: ["/login", "/signup", "/dashboard", "/admin/tenants"],
    apiNamespace: "platform",
    navigationGroup: "System",
    lifecycle: "INTERNAL",
    dependencies: [],
    permissions: ["platform.read"],
    entitlement: "core.platform",
    featureFlag: "module.platform",
    uxProfileId: profile.platform,
    owner: "Platform owner",
    icon: "admin"
  }),
  defineModule({
    id: "material-intelligence",
    displayName: "Material Intelligence",
    routeRoot: "/material-intelligence",
    childRoutes: ["/material-intelligence/:materialId"],
    apiNamespace: "materials",
    navigationGroup: "R&D",
    lifecycle: "INTERNAL",
    dependencies: ["platform"],
    permissions: ["materials.read"],
    entitlement: "core.materials",
    featureFlag: "module.material-intelligence",
    uxProfileId: profile.materials,
    owner: "Material Intelligence owner",
    icon: "atom"
  }),
  defineModule({
    id: "inventory",
    displayName: "Inventory",
    routeRoot: "/inventory",
    childRoutes: [],
    apiNamespace: "inventory",
    navigationGroup: "Operations",
    lifecycle: "DISABLED",
    dependencies: ["platform", "material-intelligence"],
    permissions: ["inventory.read"],
    entitlement: "module.inventory",
    featureFlag: "module.inventory",
    uxProfileId: profile.operations,
    owner: "Inventory owner",
    icon: "box"
  }),
  defineModule({
    id: "procurement",
    displayName: "Procurement",
    routeRoot: "/procurement",
    childRoutes: [],
    apiNamespace: "procurement",
    navigationGroup: "Operations",
    lifecycle: "DISABLED",
    dependencies: ["platform", "material-intelligence", "inventory"],
    permissions: ["procurement.read"],
    entitlement: "module.procurement",
    featureFlag: "module.procurement",
    uxProfileId: profile.operations,
    owner: "Procurement owner",
    icon: "cart"
  }),
  defineModule({
    id: "production",
    displayName: "Production",
    routeRoot: "/production",
    childRoutes: [],
    apiNamespace: "production",
    navigationGroup: "Operations",
    lifecycle: "DISABLED",
    dependencies: ["platform", "material-intelligence", "inventory", "procurement"],
    permissions: ["production.read"],
    entitlement: "module.production",
    featureFlag: "module.production",
    uxProfileId: profile.workflow,
    owner: "Production owner",
    icon: "factory"
  }),
  defineModule({
    id: "sensory-intelligence",
    displayName: "Sensory Intelligence",
    routeRoot: "/sensory-intelligence",
    childRoutes: [],
    apiNamespace: "sensory",
    navigationGroup: "R&D",
    lifecycle: "DISABLED",
    dependencies: ["platform", "material-intelligence"],
    permissions: ["sensory.read"],
    entitlement: "module.sensory",
    featureFlag: "module.sensory-intelligence",
    uxProfileId: profile.studioAnalytics,
    owner: "Sensory Intelligence owner",
    icon: "sense"
  }),
  defineModule({
    id: "compliance",
    displayName: "Compliance",
    routeRoot: "/compliance",
    childRoutes: [],
    apiNamespace: "compliance",
    navigationGroup: "Compliance",
    lifecycle: "DISABLED",
    dependencies: ["platform", "material-intelligence", "procurement", "production"],
    permissions: ["compliance.read"],
    entitlement: "module.compliance",
    featureFlag: "module.compliance",
    uxProfileId: profile.workflowRegistry,
    owner: "Compliance owner",
    icon: "shield"
  }),
  defineModule({
    id: "commercial",
    displayName: "Commercial",
    routeRoot: "/commercial",
    childRoutes: [],
    apiNamespace: "commercial",
    navigationGroup: "Commercial",
    lifecycle: "DISABLED",
    dependencies: ["platform", "inventory", "procurement", "production", "compliance"],
    permissions: ["commercial.read"],
    entitlement: "module.commercial",
    featureFlag: "module.commercial",
    uxProfileId: profile.operations,
    owner: "Commercial owner",
    icon: "briefcase"
  }),
  defineModule({
    id: "community",
    displayName: "Community",
    routeRoot: "/community",
    childRoutes: [],
    apiNamespace: "community",
    navigationGroup: "Knowledge",
    lifecycle: "DISABLED",
    dependencies: ["platform"],
    permissions: ["community.read"],
    entitlement: "module.community",
    featureFlag: "module.community",
    uxProfileId: profile.workflowRegistry,
    owner: "Community owner",
    icon: "community"
  }),
  defineModule({
    id: "settings",
    displayName: "Settings",
    routeRoot: "/settings",
    childRoutes: ["/settings"],
    apiNamespace: "settings",
    navigationGroup: "System",
    lifecycle: "INTERNAL",
    dependencies: ["platform"],
    permissions: ["settings.personal.read"],
    entitlement: "core.settings",
    featureFlag: "module.settings",
    uxProfileId: profile.platform,
    owner: "Platform experience owner",
    icon: "settings"
  }),
  defineModule({
    id: "support",
    displayName: "Support / Messaging",
    routeRoot: "/support",
    childRoutes: ["/support", "/admin/support"],
    apiNamespace: "support",
    navigationGroup: "System",
    lifecycle: "INTERNAL",
    dependencies: ["platform"],
    permissions: ["support.read"],
    entitlement: "core.support",
    featureFlag: "module.support",
    uxProfileId: profile.workflowRegistry,
    owner: "Platform support owner",
    icon: "support"
  }),
  defineModule({
    id: "design-studio",
    displayName: "Design Studio",
    routeRoot: "/design-studio",
    childRoutes: [],
    apiNamespace: "design-studio",
    navigationGroup: "Creative",
    lifecycle: "DISABLED",
    dependencies: ["platform", "material-intelligence", "inventory"],
    permissions: ["design-studio.read"],
    entitlement: "future.design-studio",
    featureFlag: "module.design-studio",
    uxProfileId: profile.studio,
    owner: "Future R&D owner",
    icon: "studio"
  })
];

export const declaredModuleIds = moduleDefinitions.map((definition) => definition.descriptor.id);
