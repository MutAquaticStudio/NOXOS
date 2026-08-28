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
  body?: unknown;
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

export type ModuleDefinition = {
  descriptor: ModuleDescriptor;
  uxProfile: ModuleUxProfile;
  ui: ModuleUiManifest;
  api: ModuleApiManifest;
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
  | "INTERNAL_ERROR";

export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
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
