import type {
  ApiRouteRegistrar,
  IconToken,
  ModuleAuthorizationManifest,
  ModuleDefinition,
  ModuleDescriptor,
  ModuleUxProfile,
  ModuleUxState
} from "@nox-os/contracts";

type DefinitionInput = Omit<ModuleDescriptor, "mobilePriority" | "uxProfileId"> & {
  icon: IconToken;
  uxProfile: ModuleUxProfile;
  mobilePriority?: readonly string[];
  authorization?: Omit<ModuleAuthorizationManifest, "moduleId">;
};

const foundationStates = [
  "default",
  "loading",
  "empty",
  "error",
  "partial-data",
  "permission-denied",
  "selection",
  "unsaved",
  "offline"
] as const satisfies readonly ModuleUxState[];

function profile(
  input: Omit<ModuleUxProfile, "states"> & { states?: readonly ModuleUxState[] }
): ModuleUxProfile {
  return { ...input, states: input.states ?? foundationStates };
}

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

function defineModule({
  icon,
  mobilePriority,
  uxProfile,
  authorization,
  ...input
}: DefinitionInput): ModuleDefinition {
  const descriptor: ModuleDescriptor = {
    ...input,
    uxProfileId: uxProfile.id,
    mobilePriority: mobilePriority ?? uxProfile.mobilePriority
  };

  return {
    descriptor,
    uxProfile,
    ui: {
      moduleId: descriptor.id,
      icon,
      load: () => import("./foundation-module.js")
    },
    api: {
      moduleId: descriptor.id,
      apiNamespace: descriptor.apiNamespace,
      registerRoutes: (registrar) => registerFoundationApi(descriptor.apiNamespace, registrar)
    },
    // Gate 2 establishes the extension boundary. Existing Gate 0 modules do
    // not receive speculative business permissions until their own Gate.
    authorization: authorization
      ? { moduleId: descriptor.id, ...authorization }
      : {
          moduleId: descriptor.id,
          permissions: [],
          defaultRoleGrants: {}
        }
  };
}

export const moduleProfiles = {
  platform: profile({
    id: "platform",
    name: "Platform Admin",
    archetype: "configuration",
    secondaryArchetype: "data-grid",
    density: "compact",
    primaryObject: "Tenant",
    primaryTasks: ["review tenant scope", "review feature operations"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "form"],
    mobilePriority: ["review tenant status", "review operational alerts"],
    reactBitsIntensity: "none"
  }),
  materialIntelligence: profile({
    id: "material-intelligence",
    name: "Material Intelligence",
    archetype: "data-grid",
    secondaryArchetype: "registry",
    density: "compact",
    primaryObject: "GlobalMaterial",
    primaryTasks: ["search materials", "inspect evidence", "save view"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "list"],
    mobilePriority: ["search materials", "inspect evidence"],
    reactBitsIntensity: "low"
  }),
  inventory: profile({
    id: "inventory",
    name: "Inventory",
    archetype: "data-grid",
    secondaryArchetype: "operations",
    density: "compact",
    primaryObject: "InventoryLot",
    primaryTasks: ["scan stock", "inspect lot", "identify shortages"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: false },
    supportedViews: ["table", "list"],
    mobilePriority: ["scan stock", "inspect lot", "identify shortages"],
    reactBitsIntensity: "none"
  }),
  procurement: profile({
    id: "procurement",
    name: "Procurement",
    archetype: "operations",
    secondaryArchetype: "data-grid",
    density: "compact",
    primaryObject: "PurchaseOrder",
    primaryTasks: ["review order", "inspect supplier", "receive delivery"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: false },
    supportedViews: ["table", "form"],
    mobilePriority: ["review order", "receive delivery"],
    reactBitsIntensity: "none"
  }),
  labServices: profile({
    id: "lab-services",
    name: "NØX Lab Services",
    archetype: "data-grid",
    secondaryArchetype: "operations",
    density: "compact",
    primaryObject: "LabServiceOrder",
    primaryTasks: ["find customer", "confirm service scope", "record interaction"],
    navigation: { inspector: true, aiSidecar: false, workspaceTabs: true, splitView: false },
    supportedViews: ["table", "form", "list"],
    mobilePriority: ["find customer", "review service order", "record interaction"],
    reactBitsIntensity: "none"
  }),
  projectOperations: profile({
    id: "project-operations",
    name: "Project Operations",
    archetype: "operations",
    secondaryArchetype: "data-grid",
    density: "compact",
    primaryObject: "OperationalProject",
    primaryTasks: ["review operational plan", "track required work", "record internal update"],
    navigation: { inspector: true, aiSidecar: false, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "form", "list"],
    mobilePriority: ["find project", "view phase state", "complete task"],
    reactBitsIntensity: "none"
  }),
  production: profile({
    id: "production",
    name: "Production",
    archetype: "operations",
    secondaryArchetype: "workflow",
    density: "compact",
    primaryObject: "ProductionRun",
    primaryTasks: ["review queue", "scan batch", "flag issue"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: false },
    supportedViews: ["table", "board", "form"],
    mobilePriority: ["scan batch", "flag issue", "review queue"],
    reactBitsIntensity: "none"
  }),
  qualityControl: profile({
    id: "quality-control",
    name: "Quality Control",
    archetype: "workflow",
    secondaryArchetype: "data-grid",
    density: "compact",
    primaryObject: "ProductionBatch",
    primaryTasks: ["inspect completed batch", "record evidence", "decide disposition"],
    navigation: { inspector: true, aiSidecar: false, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "form"],
    mobilePriority: ["inspect batch", "record result", "review disposition"],
    reactBitsIntensity: "none"
  }),
  sensoryIntelligence: profile({
    id: "sensory-intelligence",
    name: "Sensory Intelligence",
    archetype: "studio",
    secondaryArchetype: "analytics",
    density: "default",
    primaryObject: "SensorySession",
    primaryTasks: ["review session", "record observation", "compare evidence"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: true },
    supportedViews: ["canvas", "table", "chart"],
    mobilePriority: ["review session", "record observation"],
    reactBitsIntensity: "low"
  }),
  compliance: profile({
    id: "compliance",
    name: "Compliance",
    archetype: "workflow",
    secondaryArchetype: "registry",
    density: "compact",
    primaryObject: "ComplianceRecord",
    primaryTasks: ["review status", "inspect evidence", "flag exception"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "board", "form"],
    mobilePriority: ["review status", "flag exception"],
    reactBitsIntensity: "none"
  }),
  commercialOrders: profile({
    id: "commercial-orders",
    name: "Commercial Orders",
    archetype: "operations",
    secondaryArchetype: "data-grid",
    density: "compact",
    primaryObject: "CommercialOrder",
    primaryTasks: ["quote commercial offer", "allocate order", "confirm fulfillment"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: false },
    supportedViews: ["table", "form"],
    mobilePriority: ["review order", "confirm fulfillment", "mark shipment"],
    reactBitsIntensity: "none"
  }),
  community: profile({
    id: "community",
    name: "Community",
    archetype: "workflow",
    secondaryArchetype: "registry",
    density: "default",
    primaryObject: "Post / SharedReference",
    primaryTasks: ["read shared reference", "review discussion", "inspect sharing scope"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: false },
    supportedViews: ["list", "table"],
    mobilePriority: ["read shared reference", "review discussion"],
    reactBitsIntensity: "low"
  }),
  settings: profile({
    id: "settings",
    name: "Settings",
    archetype: "configuration",
    density: "default",
    primaryObject: "Settings section",
    primaryTasks: ["review preference", "change a focused setting"],
    navigation: { inspector: false, aiSidecar: false, workspaceTabs: true, splitView: false },
    supportedViews: ["form", "list"],
    mobilePriority: ["review preference", "change a focused setting"],
    reactBitsIntensity: "none"
  }),
  support: profile({
    id: "support",
    name: "Support / Messaging",
    archetype: "workflow",
    secondaryArchetype: "registry",
    density: "default",
    primaryObject: "SupportConversation",
    primaryTasks: ["review conversation", "inspect access scope", "attach diagnostic"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: true },
    supportedViews: ["list", "table", "form"],
    mobilePriority: ["review conversation", "inspect access scope"],
    reactBitsIntensity: "none"
  }),
  designStudio: profile({
    id: "design-studio",
    name: "Design Studio",
    archetype: "studio",
    density: "comfortable",
    primaryObject: "DesignIntent",
    primaryTasks: ["review brief", "inspect intent", "review proposal"],
    navigation: { inspector: true, aiSidecar: true, workspaceTabs: true, splitView: true },
    supportedViews: ["canvas", "list"],
    mobilePriority: ["review brief", "inspect intent"],
    reactBitsIntensity: "low"
  }),
  trialSensory: profile({
    id: "trial-sensory",
    name: "Trial & Sensory",
    archetype: "workflow",
    secondaryArchetype: "data-grid",
    density: "compact",
    primaryObject: "Trial",
    primaryTasks: ["prepare trial", "record sensory evidence", "request formula revision"],
    navigation: { inspector: true, aiSidecar: false, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "form"],
    mobilePriority: ["review trial", "record sensory evidence"],
    reactBitsIntensity: "none"
  }),
  releaseReadiness: profile({
    id: "release-readiness",
    name: "Release Readiness",
    archetype: "workflow",
    secondaryArchetype: "registry",
    density: "compact",
    primaryObject: "ReleaseAssessment",
    primaryTasks: ["assess release profile", "review checks", "reassess evidence"],
    navigation: { inspector: true, aiSidecar: false, workspaceTabs: true, splitView: true },
    supportedViews: ["table", "form"],
    mobilePriority: ["review decision", "inspect blocking evidence"],
    reactBitsIntensity: "none"
  })
} as const satisfies Record<string, ModuleUxProfile>;

export const moduleDefinitions: readonly ModuleDefinition[] = [
  defineModule({
    id: "platform",
    displayName: "Platform Admin",
    routeRoot: "/admin",
    childRoutes: ["/dashboard", "/admin/tenants"],
    apiNamespace: "platform",
    navigationGroup: "System",
    lifecycle: "INTERNAL",
    dependencies: [],
    permissions: ["platform.read"],
    entitlement: "core.platform",
    featureFlag: "module.platform",
    uxProfile: moduleProfiles.platform,
    owner: "Platform owner",
    icon: "admin"
  }),
  defineModule({
    id: "material-intelligence",
    displayName: "Material Intelligence",
    routeRoot: "/materials",
    childRoutes: [
      "/materials/new",
      "/materials/:materialId",
      "/materials/review",
      "/materials/review/:requestId"
    ],
    apiNamespace: "materials",
    navigationGroup: "R&D",
    lifecycle: "INTERNAL",
    dependencies: ["platform"],
    permissions: [
      "module.material-intelligence.material.read",
      "module.material-intelligence.material.create",
      "module.material-intelligence.material.request-change",
      "module.material-intelligence.material.approve",
      "module.material-intelligence.material.share"
    ],
    entitlement: "module.material-intelligence",
    featureFlag: "module.material-intelligence",
    uxProfile: moduleProfiles.materialIntelligence,
    owner: "Material Intelligence owner",
    icon: "atom",
    authorization: {
      permissions: [
        "module.material-intelligence.material.read",
        "module.material-intelligence.material.create",
        "module.material-intelligence.material.request-change",
        "module.material-intelligence.material.approve",
        "module.material-intelligence.material.share"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.material-intelligence.material.read",
          "module.material-intelligence.material.create",
          "module.material-intelligence.material.request-change",
          "module.material-intelligence.material.approve",
          "module.material-intelligence.material.share"
        ],
        TENANT_ADMIN: [
          "module.material-intelligence.material.read",
          "module.material-intelligence.material.create",
          "module.material-intelligence.material.request-change",
          "module.material-intelligence.material.approve",
          "module.material-intelligence.material.share"
        ],
        TENANT_MEMBER: [
          "module.material-intelligence.material.read",
          "module.material-intelligence.material.create",
          "module.material-intelligence.material.request-change"
        ]
      }
    }
  }),
  defineModule({
    id: "inventory",
    displayName: "Inventory",
    routeRoot: "/inventory",
    childRoutes: ["/inventory/lots/:lotId"],
    apiNamespace: "inventory",
    navigationGroup: "Operations",
    lifecycle: "ACTIVE",
    dependencies: ["platform", "material-intelligence"],
    permissions: ["module.inventory.read"],
    entitlement: "module.inventory",
    featureFlag: "module.inventory",
    uxProfile: moduleProfiles.inventory,
    owner: "Inventory owner",
    icon: "box",
    authorization: {
      permissions: [
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
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
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
        ],
        TENANT_ADMIN: [
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
        ],
        TENANT_MEMBER: ["module.inventory.read"]
      }
    }
  }),
  defineModule({
    id: "procurement",
    displayName: "Procurement",
    routeRoot: "/procurement",
    childRoutes: [],
    apiNamespace: "procurement",
    navigationGroup: "Operations",
    lifecycle: "ACTIVE",
    dependencies: ["platform", "material-intelligence", "inventory"],
    permissions: ["module.procurement.read"],
    entitlement: "module.procurement",
    featureFlag: "module.procurement",
    uxProfile: moduleProfiles.procurement,
    owner: "Procurement owner",
    icon: "cart",
    authorization: {
      permissions: [
        "module.procurement.read",
        "module.procurement.supplier.manage",
        "module.procurement.offer.manage",
        "module.procurement.purchase-order.create",
        "module.procurement.purchase-order.edit",
        "module.procurement.purchase-order.approve",
        "module.procurement.purchase-order.close",
        "module.procurement.purchase-order.cancel",
        "module.procurement.receipt.create",
        "module.procurement.receipt.edit",
        "module.procurement.receipt.post",
        "module.procurement.receipt.cancel"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.procurement.read",
          "module.procurement.supplier.manage",
          "module.procurement.offer.manage",
          "module.procurement.purchase-order.create",
          "module.procurement.purchase-order.edit",
          "module.procurement.purchase-order.approve",
          "module.procurement.purchase-order.close",
          "module.procurement.purchase-order.cancel",
          "module.procurement.receipt.create",
          "module.procurement.receipt.edit",
          "module.procurement.receipt.post",
          "module.procurement.receipt.cancel"
        ],
        TENANT_ADMIN: [
          "module.procurement.read",
          "module.procurement.supplier.manage",
          "module.procurement.offer.manage",
          "module.procurement.purchase-order.create",
          "module.procurement.purchase-order.edit",
          "module.procurement.purchase-order.approve",
          "module.procurement.purchase-order.close",
          "module.procurement.purchase-order.cancel",
          "module.procurement.receipt.create",
          "module.procurement.receipt.edit",
          "module.procurement.receipt.post",
          "module.procurement.receipt.cancel"
        ],
        TENANT_MEMBER: ["module.procurement.read"]
      }
    }
  }),
  defineModule({
    id: "project-operations",
    displayName: "Project Operations",
    routeRoot: "/project-operations",
    childRoutes: ["/project-operations/projects/:projectId"],
    apiNamespace: "project-operations",
    navigationGroup: "Operations",
    lifecycle: "ACTIVE",
    dependencies: [
      "platform",
      "lab-services",
      "design-studio",
      "trial-sensory",
      "release-readiness",
      "production",
      "quality-control"
    ],
    permissions: ["module.project-operations.read"],
    entitlement: "module.project-operations",
    featureFlag: "module.project-operations",
    uxProfile: moduleProfiles.projectOperations,
    owner: "Project Operations owner",
    icon: "briefcase",
    authorization: {
      permissions: [
        "module.project-operations.read",
        "module.project-operations.project.create",
        "module.project-operations.project.edit",
        "module.project-operations.project.activate",
        "module.project-operations.project.hold",
        "module.project-operations.project.resume",
        "module.project-operations.project.complete",
        "module.project-operations.project.cancel",
        "module.project-operations.phase.manage",
        "module.project-operations.task.create",
        "module.project-operations.task.edit",
        "module.project-operations.task.start",
        "module.project-operations.task.complete",
        "module.project-operations.task.cancel",
        "module.project-operations.dependency.manage",
        "module.project-operations.artifact-link.manage",
        "module.project-operations.update.create"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.project-operations.read",
          "module.project-operations.project.create",
          "module.project-operations.project.edit",
          "module.project-operations.project.activate",
          "module.project-operations.project.hold",
          "module.project-operations.project.resume",
          "module.project-operations.project.complete",
          "module.project-operations.project.cancel",
          "module.project-operations.phase.manage",
          "module.project-operations.task.create",
          "module.project-operations.task.edit",
          "module.project-operations.task.start",
          "module.project-operations.task.complete",
          "module.project-operations.task.cancel",
          "module.project-operations.dependency.manage",
          "module.project-operations.artifact-link.manage",
          "module.project-operations.update.create"
        ],
        TENANT_ADMIN: [
          "module.project-operations.read",
          "module.project-operations.project.create",
          "module.project-operations.project.edit",
          "module.project-operations.project.activate",
          "module.project-operations.project.hold",
          "module.project-operations.project.resume",
          "module.project-operations.project.complete",
          "module.project-operations.project.cancel",
          "module.project-operations.phase.manage",
          "module.project-operations.task.create",
          "module.project-operations.task.edit",
          "module.project-operations.task.start",
          "module.project-operations.task.complete",
          "module.project-operations.task.cancel",
          "module.project-operations.dependency.manage",
          "module.project-operations.artifact-link.manage",
          "module.project-operations.update.create"
        ],
        TENANT_MEMBER: ["module.project-operations.read"]
      }
    }
  }),
  defineModule({
    id: "lab-services",
    displayName: "NØX Lab Services",
    routeRoot: "/lab-services",
    childRoutes: [
      "/lab-services/customers/:customerId",
      "/lab-services/service-orders/:serviceOrderId"
    ],
    apiNamespace: "lab-services",
    navigationGroup: "Commercial",
    lifecycle: "ACTIVE",
    dependencies: ["platform"],
    permissions: ["module.lab-services.read"],
    entitlement: "module.lab-services",
    featureFlag: "module.lab-services",
    uxProfile: moduleProfiles.labServices,
    owner: "Lab Services owner",
    icon: "briefcase",
    authorization: {
      permissions: [
        "module.lab-services.read",
        "module.lab-services.customer.manage",
        "module.lab-services.contact.manage",
        "module.lab-services.service-order.create",
        "module.lab-services.service-order.edit",
        "module.lab-services.service-order.confirm",
        "module.lab-services.service-order.start",
        "module.lab-services.service-order.complete",
        "module.lab-services.service-order.cancel",
        "module.lab-services.interaction.create"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.lab-services.read",
          "module.lab-services.customer.manage",
          "module.lab-services.contact.manage",
          "module.lab-services.service-order.create",
          "module.lab-services.service-order.edit",
          "module.lab-services.service-order.confirm",
          "module.lab-services.service-order.start",
          "module.lab-services.service-order.complete",
          "module.lab-services.service-order.cancel",
          "module.lab-services.interaction.create"
        ],
        TENANT_ADMIN: [
          "module.lab-services.read",
          "module.lab-services.customer.manage",
          "module.lab-services.contact.manage",
          "module.lab-services.service-order.create",
          "module.lab-services.service-order.edit",
          "module.lab-services.service-order.confirm",
          "module.lab-services.service-order.start",
          "module.lab-services.service-order.complete",
          "module.lab-services.service-order.cancel",
          "module.lab-services.interaction.create"
        ],
        TENANT_MEMBER: ["module.lab-services.read"]
      }
    }
  }),
  defineModule({
    id: "production",
    displayName: "Production",
    routeRoot: "/production",
    childRoutes: [],
    apiNamespace: "production",
    navigationGroup: "Operations",
    lifecycle: "ACTIVE",
    dependencies: ["platform", "material-intelligence", "inventory"],
    permissions: [
      "module.production.read",
      "module.production.order.create",
      "module.production.order.edit",
      "module.production.allocation.manage",
      "module.production.order.release",
      "module.production.order.cancel",
      "module.production.batch.start",
      "module.production.batch.complete",
      "module.production.batch.abort"
    ],
    entitlement: "module.production",
    featureFlag: "module.production",
    uxProfile: moduleProfiles.production,
    owner: "Production owner",
    icon: "factory",
    authorization: {
      permissions: [
        "module.production.read",
        "module.production.order.create",
        "module.production.order.edit",
        "module.production.allocation.manage",
        "module.production.order.release",
        "module.production.order.cancel",
        "module.production.batch.start",
        "module.production.batch.complete",
        "module.production.batch.abort"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.production.read",
          "module.production.order.create",
          "module.production.order.edit",
          "module.production.allocation.manage",
          "module.production.order.release",
          "module.production.order.cancel",
          "module.production.batch.start",
          "module.production.batch.complete",
          "module.production.batch.abort"
        ],
        TENANT_ADMIN: [
          "module.production.read",
          "module.production.order.create",
          "module.production.order.edit",
          "module.production.allocation.manage",
          "module.production.order.release",
          "module.production.order.cancel",
          "module.production.batch.start",
          "module.production.batch.complete",
          "module.production.batch.abort"
        ],
        TENANT_MEMBER: ["module.production.read"]
      }
    }
  }),
  defineModule({
    id: "quality-control",
    displayName: "Quality Control",
    routeRoot: "/quality-control",
    childRoutes: [
      "/quality-control/specifications",
      "/quality-control/specifications/:specificationId",
      "/quality-control/batches/:batchId",
      "/quality-control/inspections/:inspectionId"
    ],
    apiNamespace: "quality-control",
    navigationGroup: "Operations",
    lifecycle: "ACTIVE",
    dependencies: ["platform", "production", "release-readiness"],
    permissions: [
      "module.quality-control.read",
      "module.quality-control.specification.manage",
      "module.quality-control.inspection.create",
      "module.quality-control.inspection.edit",
      "module.quality-control.inspection.finalize",
      "module.quality-control.inspection.cancel",
      "module.quality-control.batch.hold",
      "module.quality-control.batch.release",
      "module.quality-control.batch.reject"
    ],
    entitlement: "module.quality-control",
    featureFlag: "module.quality-control",
    uxProfile: moduleProfiles.qualityControl,
    owner: "Quality owner",
    icon: "shield",
    authorization: {
      permissions: [
        "module.quality-control.read",
        "module.quality-control.specification.manage",
        "module.quality-control.inspection.create",
        "module.quality-control.inspection.edit",
        "module.quality-control.inspection.finalize",
        "module.quality-control.inspection.cancel",
        "module.quality-control.batch.hold",
        "module.quality-control.batch.release",
        "module.quality-control.batch.reject"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.quality-control.read",
          "module.quality-control.specification.manage",
          "module.quality-control.inspection.create",
          "module.quality-control.inspection.edit",
          "module.quality-control.inspection.finalize",
          "module.quality-control.inspection.cancel",
          "module.quality-control.batch.hold",
          "module.quality-control.batch.release",
          "module.quality-control.batch.reject"
        ],
        TENANT_ADMIN: [
          "module.quality-control.read",
          "module.quality-control.specification.manage",
          "module.quality-control.inspection.create",
          "module.quality-control.inspection.edit",
          "module.quality-control.inspection.finalize",
          "module.quality-control.inspection.cancel",
          "module.quality-control.batch.hold",
          "module.quality-control.batch.release",
          "module.quality-control.batch.reject"
        ],
        TENANT_MEMBER: ["module.quality-control.read"]
      }
    }
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
    uxProfile: moduleProfiles.sensoryIntelligence,
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
    uxProfile: moduleProfiles.compliance,
    owner: "Compliance owner",
    icon: "shield"
  }),
  defineModule({
    id: "commercial-orders",
    displayName: "Commercial Orders",
    routeRoot: "/commercial-orders",
    childRoutes: [
      "/commercial-orders/quotes",
      "/commercial-orders/quotes/new",
      "/commercial-orders/quotes/:quoteId",
      "/commercial-orders/new",
      "/commercial-orders/:orderId"
    ],
    apiNamespace: "commercial-orders",
    navigationGroup: "Commercial",
    lifecycle: "ACTIVE",
    dependencies: [
      "platform",
      "material-intelligence",
      "inventory",
      "production",
      "quality-control",
      "lab-services",
      "project-operations"
    ],
    permissions: ["module.commercial-orders.read"],
    entitlement: "module.commercial-orders",
    featureFlag: "module.commercial-orders",
    uxProfile: moduleProfiles.commercialOrders,
    owner: "Commercial Orders owner",
    icon: "briefcase",
    authorization: {
      permissions: [
        "module.commercial-orders.read",
        "module.commercial-orders.quote.create",
        "module.commercial-orders.quote.edit",
        "module.commercial-orders.quote.issue",
        "module.commercial-orders.quote.accept",
        "module.commercial-orders.quote.decline",
        "module.commercial-orders.quote.cancel",
        "module.commercial-orders.quote.revise",
        "module.commercial-orders.order.create",
        "module.commercial-orders.order.edit",
        "module.commercial-orders.order.confirm",
        "module.commercial-orders.order.cancel",
        "module.commercial-orders.order.close",
        "module.commercial-orders.allocation.manage",
        "module.commercial-orders.fulfillment.create",
        "module.commercial-orders.fulfillment.edit",
        "module.commercial-orders.fulfillment.confirm",
        "module.commercial-orders.fulfillment.cancel",
        "module.commercial-orders.shipment.create",
        "module.commercial-orders.shipment.edit",
        "module.commercial-orders.shipment.ship",
        "module.commercial-orders.shipment.deliver",
        "module.commercial-orders.shipment.cancel"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.commercial-orders.read",
          "module.commercial-orders.quote.create",
          "module.commercial-orders.quote.edit",
          "module.commercial-orders.quote.issue",
          "module.commercial-orders.quote.accept",
          "module.commercial-orders.quote.decline",
          "module.commercial-orders.quote.cancel",
          "module.commercial-orders.quote.revise",
          "module.commercial-orders.order.create",
          "module.commercial-orders.order.edit",
          "module.commercial-orders.order.confirm",
          "module.commercial-orders.order.cancel",
          "module.commercial-orders.order.close",
          "module.commercial-orders.allocation.manage",
          "module.commercial-orders.fulfillment.create",
          "module.commercial-orders.fulfillment.edit",
          "module.commercial-orders.fulfillment.confirm",
          "module.commercial-orders.fulfillment.cancel",
          "module.commercial-orders.shipment.create",
          "module.commercial-orders.shipment.edit",
          "module.commercial-orders.shipment.ship",
          "module.commercial-orders.shipment.deliver",
          "module.commercial-orders.shipment.cancel"
        ],
        TENANT_ADMIN: [
          "module.commercial-orders.read",
          "module.commercial-orders.quote.create",
          "module.commercial-orders.quote.edit",
          "module.commercial-orders.quote.issue",
          "module.commercial-orders.quote.accept",
          "module.commercial-orders.quote.decline",
          "module.commercial-orders.quote.cancel",
          "module.commercial-orders.quote.revise",
          "module.commercial-orders.order.create",
          "module.commercial-orders.order.edit",
          "module.commercial-orders.order.confirm",
          "module.commercial-orders.order.cancel",
          "module.commercial-orders.allocation.manage",
          "module.commercial-orders.fulfillment.create",
          "module.commercial-orders.fulfillment.edit",
          "module.commercial-orders.fulfillment.confirm",
          "module.commercial-orders.fulfillment.cancel",
          "module.commercial-orders.shipment.create",
          "module.commercial-orders.shipment.edit",
          "module.commercial-orders.shipment.ship",
          "module.commercial-orders.shipment.deliver",
          "module.commercial-orders.shipment.cancel"
        ],
        TENANT_MEMBER: ["module.commercial-orders.read"]
      }
    }
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
    uxProfile: moduleProfiles.community,
    owner: "Community owner",
    icon: "community"
  }),
  defineModule({
    id: "settings",
    displayName: "Settings",
    routeRoot: "/settings",
    childRoutes: ["/settings/tenant"],
    apiNamespace: "settings",
    navigationGroup: "System",
    lifecycle: "INTERNAL",
    dependencies: ["platform"],
    permissions: ["settings.personal.read"],
    entitlement: "core.settings",
    featureFlag: "module.settings",
    uxProfile: moduleProfiles.settings,
    owner: "Platform experience owner",
    icon: "settings"
  }),
  defineModule({
    id: "support",
    displayName: "Support / Messaging",
    routeRoot: "/support",
    childRoutes: ["/admin/support"],
    apiNamespace: "support",
    navigationGroup: "System",
    lifecycle: "INTERNAL",
    dependencies: ["platform"],
    permissions: ["support.read"],
    entitlement: "core.support",
    featureFlag: "module.support",
    uxProfile: moduleProfiles.support,
    owner: "Platform support owner",
    icon: "support"
  }),
  defineModule({
    id: "design-studio",
    displayName: "Design Studio",
    routeRoot: "/design-studio",
    childRoutes: [
      "/design-studio/formula",
      "/design-studio/accords",
      "/design-studio/formula-versions/:formulaVersionId"
    ],
    apiNamespace: "design-studio",
    navigationGroup: "Creative",
    lifecycle: "INTERNAL",
    dependencies: ["platform", "material-intelligence"],
    permissions: ["module.design-studio.studio.read"],
    entitlement: "module.design-studio",
    featureFlag: "module.design-studio",
    uxProfile: moduleProfiles.designStudio,
    owner: "Design Studio owner",
    icon: "studio",
    authorization: {
      permissions: [
        "module.design-studio.studio.read",
        "module.design-studio.project.create",
        "module.design-studio.brief.manage",
        "module.design-studio.intent.confirm",
        "module.design-studio.formula.generate",
        "module.design-studio.accord.plan",
        "module.design-studio.accord.develop",
        "module.design-studio.formula.freeze",
        "module.design-studio.formula.approve",
        "module.design-studio.scientific-artifact.read"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.design-studio.studio.read",
          "module.design-studio.project.create",
          "module.design-studio.brief.manage",
          "module.design-studio.intent.confirm",
          "module.design-studio.formula.generate",
          "module.design-studio.accord.plan",
          "module.design-studio.accord.develop",
          "module.design-studio.formula.freeze",
          "module.design-studio.formula.approve",
          "module.design-studio.scientific-artifact.read"
        ],
        TENANT_ADMIN: [
          "module.design-studio.studio.read",
          "module.design-studio.project.create",
          "module.design-studio.brief.manage",
          "module.design-studio.intent.confirm",
          "module.design-studio.formula.generate",
          "module.design-studio.accord.plan",
          "module.design-studio.accord.develop",
          "module.design-studio.scientific-artifact.read"
        ],
        TENANT_MEMBER: ["module.design-studio.studio.read"]
      }
    }
  }),
  defineModule({
    id: "trial-sensory",
    displayName: "Trial & Sensory",
    routeRoot: "/trials",
    childRoutes: ["/trials/:trialId"],
    apiNamespace: "trials",
    navigationGroup: "R&D",
    lifecycle: "INTERNAL",
    dependencies: ["platform", "design-studio"],
    permissions: ["module.trial-sensory.trial.read"],
    entitlement: "module.trial-sensory",
    featureFlag: "module.trial-sensory",
    uxProfile: moduleProfiles.trialSensory,
    owner: "Trial & Sensory owner",
    icon: "sense",
    authorization: {
      permissions: [
        "module.trial-sensory.trial.read",
        "module.trial-sensory.trial.create",
        "module.trial-sensory.trial.prepare",
        "module.trial-sensory.trial.cancel",
        "module.trial-sensory.evaluation.create",
        "module.trial-sensory.evaluation.edit",
        "module.trial-sensory.evaluation.finalize",
        "module.trial-sensory.revision.request",
        "module.trial-sensory.approval.recommend"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.trial-sensory.trial.read",
          "module.trial-sensory.trial.create",
          "module.trial-sensory.trial.prepare",
          "module.trial-sensory.trial.cancel",
          "module.trial-sensory.evaluation.create",
          "module.trial-sensory.evaluation.edit",
          "module.trial-sensory.evaluation.finalize",
          "module.trial-sensory.revision.request",
          "module.trial-sensory.approval.recommend"
        ],
        TENANT_ADMIN: [
          "module.trial-sensory.trial.read",
          "module.trial-sensory.trial.create",
          "module.trial-sensory.trial.prepare",
          "module.trial-sensory.trial.cancel",
          "module.trial-sensory.evaluation.create",
          "module.trial-sensory.evaluation.edit",
          "module.trial-sensory.evaluation.finalize",
          "module.trial-sensory.revision.request",
          "module.trial-sensory.approval.recommend"
        ],
        TENANT_MEMBER: [
          "module.trial-sensory.trial.read",
          "module.trial-sensory.trial.create",
          "module.trial-sensory.trial.prepare",
          "module.trial-sensory.evaluation.create",
          "module.trial-sensory.evaluation.edit",
          "module.trial-sensory.evaluation.finalize",
          "module.trial-sensory.revision.request",
          "module.trial-sensory.approval.recommend"
        ]
      }
    }
  }),
  defineModule({
    id: "release-readiness",
    displayName: "Release Readiness",
    routeRoot: "/release-readiness",
    childRoutes: ["/release-readiness/new", "/release-readiness/:assessmentId"],
    apiNamespace: "release-readiness",
    navigationGroup: "Compliance",
    lifecycle: "INTERNAL",
    dependencies: ["platform", "material-intelligence", "design-studio", "trial-sensory"],
    permissions: ["module.release-readiness.assessment.read"],
    entitlement: "module.release-readiness",
    featureFlag: "module.release-readiness",
    uxProfile: moduleProfiles.releaseReadiness,
    owner: "Release Readiness owner",
    icon: "shield",
    authorization: {
      permissions: [
        "module.release-readiness.assessment.read",
        "module.release-readiness.assessment.create",
        "module.release-readiness.assessment.run",
        "module.release-readiness.assessment.review"
      ],
      defaultRoleGrants: {
        TENANT_OWNER: [
          "module.release-readiness.assessment.read",
          "module.release-readiness.assessment.create",
          "module.release-readiness.assessment.run",
          "module.release-readiness.assessment.review"
        ],
        TENANT_ADMIN: [
          "module.release-readiness.assessment.read",
          "module.release-readiness.assessment.create",
          "module.release-readiness.assessment.run",
          "module.release-readiness.assessment.review"
        ],
        TENANT_MEMBER: ["module.release-readiness.assessment.read"]
      }
    }
  })
];

export const declaredModuleIds = moduleDefinitions.map((definition) => definition.descriptor.id);
