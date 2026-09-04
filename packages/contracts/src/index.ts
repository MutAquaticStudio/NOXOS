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
  | "INVALID_COMPONENT_TOTAL"
  | "FORMULA_VERSION_NOT_FROZEN"
  | "UNSUPPORTED_COMPOSITION_KIND"
  | "TRIAL_NOT_FOUND"
  | "TRIAL_ALREADY_PREPARED"
  | "TRIAL_NOT_PREPARED"
  | "TRIAL_ALREADY_COMPLETED"
  | "TRIAL_CANCELLED"
  | "FORMULA_TOTAL_INVALID"
  | "BELOW_WEIGHABLE_RESOLUTION"
  | "EVALUATION_NOT_FOUND"
  | "EVALUATION_ALREADY_FINAL"
  | "EVALUATION_NOT_FINAL"
  | "INVALID_SENSORY_DELTA"
  | "PRODUCTION_ORDER_NOT_FOUND"
  | "PRODUCTION_ORDER_NOT_EDITABLE"
  | "PRODUCTION_ORDER_NOT_RELEASABLE"
  | "PRODUCTION_ORDER_ALREADY_RELEASED"
  | "PRODUCTION_ORDER_ALREADY_STARTED"
  | "PRODUCTION_ORDER_ALREADY_TERMINAL"
  | "PRODUCTION_ORDER_NOT_RELEASED"
  | "PRODUCTION_BATCH_NOT_FOUND"
  | "PRODUCTION_BATCH_NOT_IN_PROGRESS"
  | "PRODUCTION_FORMULA_NOT_APPROVED"
  | "PRODUCTION_FORMULA_NOT_FULL"
  | "PRODUCTION_FORMULA_NOT_FOUND"
  | "PRODUCTION_READINESS_MISSING"
  | "PRODUCTION_READINESS_AMBIGUOUS"
  | "PRODUCTION_NOT_READY"
  | "PRODUCTION_ALLOCATION_MISMATCH"
  | "PRODUCTION_ALLOCATION_INELIGIBLE"
  | "PRODUCTION_SHORTAGE"
  | "PRODUCTION_BELOW_WEIGHABLE_RESOLUTION"
  | "PRODUCTION_ABORT_REASON_REQUIRED"
  | "PRODUCTION_OUTPUT_INVALID"
  | "PRODUCTION_IDEMPOTENCY_CONFLICT"
  | "INTERPRETER_UNAVAILABLE"
  | "REVISION_NOT_ALLOWED"
  | "REVISION_CONTEXT_INVALID"
  | "APPROVAL_EVIDENCE_REQUIRED"
  | "APPROVAL_EVIDENCE_INVALID"
  | "MATERIAL_NOT_FOUND"
  | "MATERIAL_ACCESS_DENIED"
  | "LOCATION_NOT_FOUND"
  | "LOCATION_ARCHIVED"
  | "LOCATION_NOT_EMPTY"
  | "LOT_NOT_FOUND"
  | "LOT_CLOSED"
  | "LOT_ON_HOLD"
  | "LOT_EXPIRED"
  | "LOT_IDENTITY_IMMUTABLE"
  | "LOT_NOT_EMPTY"
  | "INSUFFICIENT_STOCK"
  | "INSUFFICIENT_AVAILABLE_STOCK"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_NOT_ACTIVE"
  | "RESERVATION_ALREADY_TERMINAL"
  | "RESERVATION_EXCEEDS_AVAILABLE_STOCK"
  | "TRIAL_INVENTORY_NOT_ALLOCATED"
  | "TRIAL_INVENTORY_ALLOCATION_MISMATCH"
  | "TRIAL_INVENTORY_INTEGRATION_UNAVAILABLE"
  | "TRIAL_INVENTORY_NOT_READY"
  | "INVALID_MOVEMENT"
  | "INVALID_MOVEMENT_DIRECTION"
  | "INVALID_QUANTITY"
  | "IDEMPOTENCY_CONFLICT"
  | "SUPPLIER_NOT_FOUND"
  | "SUPPLIER_ON_HOLD"
  | "SUPPLIER_ARCHIVED"
  | "SUPPLIER_OFFER_NOT_FOUND"
  | "SUPPLIER_OFFER_MISMATCH"
  | "PURCHASE_ORDER_NOT_FOUND"
  | "PURCHASE_ORDER_NOT_EDITABLE"
  | "PURCHASE_ORDER_NOT_APPROVABLE"
  | "PURCHASE_ORDER_ALREADY_TERMINAL"
  | "PURCHASE_ORDER_HAS_RECEIPTS"
  | "PURCHASE_ORDER_LINE_NOT_FOUND"
  | "GOODS_RECEIPT_NOT_FOUND"
  | "GOODS_RECEIPT_NOT_EDITABLE"
  | "GOODS_RECEIPT_ALREADY_POSTED"
  | "GOODS_RECEIPT_POST_FAILED"
  | "RECEIPT_PO_MISMATCH"
  | "RECEIPT_SUPPLIER_MISMATCH"
  | "RECEIPT_MATERIAL_MISMATCH"
  | "OVER_RECEIPT_NOT_ALLOWED"
  | "INVENTORY_RECEIPT_UNAVAILABLE"
  | "INVENTORY_LOT_IDENTITY_CONFLICT"
  | "INVALID_PRICE"
  | "INVALID_CURRENCY"
  | "LAB_CUSTOMER_NOT_FOUND"
  | "LAB_CUSTOMER_NOT_ACTIVE"
  | "LAB_CUSTOMER_ON_HOLD"
  | "LAB_CUSTOMER_ARCHIVED"
  | "LAB_CUSTOMER_HAS_OPEN_ORDERS"
  | "LAB_CUSTOMER_CODE_CONFLICT"
  | "LAB_CONTACT_NOT_FOUND"
  | "LAB_CONTACT_NOT_ACTIVE"
  | "LAB_CONTACT_CUSTOMER_MISMATCH"
  | "LAB_PRIMARY_CONTACT_CONFLICT"
  | "LAB_SERVICE_ORDER_NOT_FOUND"
  | "LAB_SERVICE_ORDER_NOT_EDITABLE"
  | "LAB_SERVICE_ORDER_NOT_CONFIRMABLE"
  | "LAB_SERVICE_ORDER_ALREADY_TERMINAL"
  | "LAB_SERVICE_ORDER_LINES_REQUIRED"
  | "LAB_SERVICE_ORDER_CONTACT_INVALID"
  | "LAB_SERVICE_ORDER_SCOPE_IMMUTABLE"
  | "LAB_INTERACTION_INVALID"
  | "LAB_INTERACTION_ORDER_MISMATCH";

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
