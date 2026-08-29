import { z } from "zod";

export const moduleLifecycleSchema = z.enum([
  "INTERNAL",
  "BETA",
  "ACTIVE",
  "DISABLED",
  "DEPRECATED"
]);

export type ModuleLifecycle = z.infer<typeof moduleLifecycleSchema>;

export const moduleAvailabilityStateSchema = z.enum([
  "AVAILABLE",
  "NOT_ENTITLED",
  "NO_PERMISSION",
  "DISABLED",
  "BETA_RESTRICTED"
]);

export type ModuleAvailabilityState = z.infer<typeof moduleAvailabilityStateSchema>;

export type IconToken =
  | "admin"
  | "atom"
  | "box"
  | "cart"
  | "factory"
  | "sense"
  | "shield"
  | "briefcase"
  | "community"
  | "settings"
  | "support"
  | "studio";

export type ModuleUxArchetype =
  "data-grid" | "studio" | "workflow" | "operations" | "analytics" | "registry" | "configuration";

export type ModuleUxDensity = "compact" | "default" | "comfortable";

export type ModuleUxState =
  | "default"
  | "loading"
  | "empty"
  | "error"
  | "partial-data"
  | "permission-denied"
  | "selection"
  | "unsaved"
  | "offline";

export type ModuleUxProfile = {
  id: string;
  name: string;
  archetype: ModuleUxArchetype;
  secondaryArchetype?: ModuleUxArchetype;
  density: ModuleUxDensity;
  primaryObject?: string;
  primaryTasks: readonly string[];
  navigation: {
    inspector: boolean;
    aiSidecar: boolean;
    workspaceTabs: boolean;
    splitView: boolean;
  };
  supportedViews: readonly (
    "table" | "list" | "board" | "timeline" | "canvas" | "chart" | "form"
  )[];
  mobilePriority: readonly string[];
  reactBitsIntensity: "none" | "low" | "medium";
  states: readonly ModuleUxState[];
};

export type ModuleDescriptor = {
  id: string;
  displayName: string;
  routeRoot: string;
  childRoutes: readonly string[];
  apiNamespace: string;
  navigationGroup: string;
  lifecycle: ModuleLifecycle;
  dependencies: readonly string[];
  permissions: readonly string[];
  entitlement?: string;
  featureFlag?: string;
  uxProfileId: string;
  mobilePriority: readonly string[];
  owner: string;
};

export type ModuleUiManifest = {
  moduleId: string;
  icon: IconToken;
  load: () => Promise<unknown>;
};

export type ApiRequest = {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  /** Query values are transport-normalized before an API handler receives them. */
  query?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
  params?: Readonly<Record<string, string>>;
  context: RequestContext;
};

export type ApiResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type ApiRouteHandler = (request: ApiRequest) => Promise<ApiResponse>;

export type ApiRouteRegistrar = {
  get: (path: string, handler: ApiRouteHandler) => void;
  register: (method: string, path: string, handler: ApiRouteHandler) => void;
};

export type ModuleApiManifest = {
  moduleId: string;
  apiNamespace: string;
  registerRoutes: (registrar: ApiRouteRegistrar) => void;
};

/**
 * Runtime-neutral extension point for a domain module's tenant-scoped permissions.
 * Core Platform permissions deliberately remain outside this manifest.
 */
export type ModuleAuthorizationManifest = {
  moduleId: string;
  permissions: readonly string[];
  defaultRoleGrants: Readonly<Partial<Record<TenantRoleKey, readonly string[]>>>;
};

export type ModuleDefinition = {
  descriptor: ModuleDescriptor;
  uxProfile: ModuleUxProfile;
  ui: ModuleUiManifest;
  api: ModuleApiManifest;
  authorization: ModuleAuthorizationManifest;
};

export type ModuleAvailability = {
  moduleId: string;
  state: ModuleAvailabilityState;
  visible: boolean;
  enabled: boolean;
  reason?: string;
};

export type NoxEnvironment = "preview" | "staging" | "production" | "development" | "test";

export type ActorContext = {
  id?: string;
  type: "USER" | "SYSTEM";
};

export type TenantContext = {
  id: string;
};

export type RequestContext = {
  requestId: string;
  correlationId: string;
  environment: NoxEnvironment;
  sourceSha: string;
  actor?: ActorContext;
  tenant?: TenantContext;
};

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFIGURATION_ERROR"
  | "REQUEST_TIMEOUT"
  | "INTERNAL_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "PLATFORM_USER_NOT_PROVISIONED"
  | "PLATFORM_USER_DISABLED"
  | "PLATFORM_ACCESS_DENIED"
  | "TENANT_CONTEXT_REQUIRED"
  | "TENANT_CONTEXT_INVALID"
  | "TENANT_ACCESS_DENIED"
  | "TENANT_SUSPENDED"
  | "MEMBERSHIP_DISABLED"
  | "PERMISSION_DENIED"
  | "PLATFORM_USER_NOT_FOUND"
  | "MEMBER_NOT_FOUND"
  | "PLATFORM_USER_ALREADY_PROVISIONED"
  | "TENANT_SLUG_CONFLICT"
  | "MEMBERSHIP_ALREADY_EXISTS"
  | "LAST_ACTIVE_PLATFORM_OWNER_REQUIRED"
  | "LAST_ACTIVE_TENANT_OWNER_REQUIRED"
  | "TENANT_OWNER_DEPENDENCY_EXISTS"
  | "UNKNOWN_ENTITLEMENT_KEY"
  | "ALREADY_RESOLVED"
  | "POSSIBLE_MATCH"
  | "INVALID_MATERIAL_TYPE_OPERATION"
  | "INVALID_TAXONOMY_TERM"
  | "INVALID_COMPONENT_TOTAL";

export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
};

export const platformRoleKeySchema = z.literal("PLATFORM_OWNER");
export type PlatformRoleKey = z.infer<typeof platformRoleKeySchema>;

export const tenantRoleKeySchema = z.enum(["TENANT_OWNER", "TENANT_ADMIN", "TENANT_MEMBER"]);
export type TenantRoleKey = z.infer<typeof tenantRoleKeySchema>;

export const platformPermissionSchema = z.enum([
  "platform.user.read",
  "platform.user.provision",
  "platform.user.status.manage",
  "platform.owner.manage",
  "platform.tenant.read",
  "platform.tenant.create",
  "platform.tenant.status.manage",
  "platform.membership.read",
  "platform.membership.manage",
  "platform.membership.owner.manage",
  "platform.entitlement.read",
  "platform.entitlement.manage",
  "platform.audit.read",
  "module.material-intelligence.reference.read",
  "module.material-intelligence.reference.manage",
  "module.material-intelligence.review.approve"
]);
export type PlatformPermission = z.infer<typeof platformPermissionSchema>;

export const tenantPermissionSchema = z.enum([
  "tenant.profile.read",
  "tenant.profile.manage",
  "tenant.membership.read",
  "tenant.membership.manage",
  "tenant.membership.owner.manage",
  "tenant.entitlement.read"
]);
export type TenantPermission = z.infer<typeof tenantPermissionSchema>;

export const platformUserStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export type PlatformUserStatus = z.infer<typeof platformUserStatusSchema>;

export const tenantStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const membershipStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const uuidSchema = z.string().uuid();

export const tenantNameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value === value.trim(), "Tenant name must be trimmed.");

export const tenantSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type PlatformUserRecord = {
  id: string;
  displayName: string | null;
  status: PlatformUserStatus;
  platformRoleKey: PlatformRoleKey | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantRecord = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantMembershipRecord = {
  tenantId: string;
  userId: string;
  roleKey: TenantRoleKey;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthenticatedRequestContext = Omit<RequestContext, "actor"> & {
  actor: {
    userId: string;
    platformRoleKey: PlatformRoleKey | null;
    platformPermissions: readonly PlatformPermission[];
  };
};

export type TenantRequestContext = Omit<AuthenticatedRequestContext, "tenant"> & {
  tenant: {
    tenantId: string;
    roleKey: TenantRoleKey;
  };
  authorization: {
    tenantPermissions: readonly TenantPermission[];
    modulePermissions: readonly string[];
  };
  entitlements: readonly string[];
};

export type WorkflowState = "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type WorkflowContext = {
  workflowId: string;
  scope: { type: "GLOBAL" } | { type: "TENANT"; tenantId: string };
  actor: ActorContext;
  correlationId: string;
  idempotencyKey: string;
};

export type WorkflowHandle = {
  id: string;
  state: WorkflowState;
  correlationId?: string;
};

export interface WorkflowLauncher {
  start<T>(workflowType: string, input: T, context: WorkflowContext): Promise<WorkflowHandle>;
}

export type ScientificState = "AVAILABLE" | "UNAVAILABLE" | "DEGRADED";

export type ScientificResult<T> = {
  state: ScientificState;
  value?: T;
  reason?: string;
};

export interface ScientificGateway {
  evaluate<TInput, TResult>(input: TInput): Promise<ScientificResult<TResult>>;
}

export type FileReference = {
  id: string;
  scope: "GLOBAL" | "TENANT";
  tenantId?: string;
  checksum: string;
  mimeType: string;
  purpose: string;
  classification: string;
  storagePath: string;
};

export type FileAuthorization = {
  actor: ActorContext;
  tenant?: TenantContext;
  allowedPurposes: readonly string[];
};

export interface FileStore {
  put(
    reference: Omit<FileReference, "id" | "storagePath">,
    contents: Uint8Array,
    authorization: FileAuthorization
  ): Promise<FileReference>;
  stat(reference: FileReference, authorization: FileAuthorization): Promise<FileReference>;
  delete(reference: FileReference, authorization: FileAuthorization): Promise<void>;
  createDownloadGrant(reference: FileReference, authorization: FileAuthorization): Promise<string>;
}
