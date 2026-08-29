import type {
  ApiRequest,
  ApiResponse,
  ApiRouteHandler,
  ApiRouteRegistrar,
  ErrorCode,
  ErrorEnvelope,
  ModuleDefinition,
  RequestContext,
  ScientificGateway,
  WorkflowContext,
  WorkflowHandle,
  WorkflowLauncher
} from "@nox-os/contracts";
import { serverIdentity, type ServerIdentity } from "@nox-os/config";
import { createLogger, type LogSink } from "@nox-os/observability";
import { createOpaqueId } from "@nox-os/shared";

type RouteKey = string;
type RouteRegistration = {
  handler: ApiRouteHandler;
  moduleId?: string;
};
type DatabaseHealth = { healthy: boolean; unconfigured?: boolean };

/**
 * Keeps the foundation API comfortably below the Vercel Function hard limit.
 * Long-running work belongs behind WorkflowLauncher rather than an HTTP response.
 */
export const DEFAULT_API_TIMEOUT_MS = 8_000;

function key(method: string, path: string): RouteKey {
  return method.toUpperCase() + " " + path;
}

export class InternalApiRouter implements ApiRouteRegistrar {
  private readonly routes = new Map<RouteKey, RouteRegistration>();

  get(path: string, handler: ApiRouteHandler): void {
    this.register("GET", path, handler);
  }

  register(method: string, path: string, handler: ApiRouteHandler): void {
    this.registerRoute(method, path, handler);
  }

  registerModule(method: string, path: string, moduleId: string, handler: ApiRouteHandler): void {
    this.registerRoute(method, path, handler, moduleId);
  }

  moduleIdFor(request: ApiRequest): string | undefined {
    return this.routes.get(key(request.method, request.path))?.moduleId;
  }

  private registerRoute(
    method: string,
    path: string,
    handler: ApiRouteHandler,
    moduleId?: string
  ): void {
    const routeKey = key(method, path);
    if (this.routes.has(routeKey)) {
      throw new Error("Duplicate API route: " + routeKey);
    }
    this.routes.set(routeKey, { handler, moduleId });
  }

  async dispatch(request: ApiRequest): Promise<ApiResponse> {
    const route = this.routes.get(key(request.method, request.path));
    if (!route) {
      return {
        status: 404,
        body: toErrorEnvelope(
          "NOT_FOUND",
          "The requested API route was not found.",
          request.context.requestId
        )
      };
    }
    return route.handler(request);
  }
}

export function createRequestContext(
  identity: ServerIdentity,
  headers: Readonly<Record<string, string | undefined>>
): RequestContext {
  const suppliedCorrelationId = headers["x-correlation-id"];
  const correlationId =
    suppliedCorrelationId && suppliedCorrelationId.length <= 128
      ? suppliedCorrelationId
      : createOpaqueId("corr");

  return {
    requestId: createOpaqueId("req"),
    correlationId,
    environment: identity.environment,
    sourceSha: identity.sourceSha
  };
}

export function toErrorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string
): ErrorEnvelope {
  return { error: { code, message, requestId } };
}

export type FoundationApi = {
  dispatch: (request: ApiRequest) => Promise<ApiResponse>;
  identity: ServerIdentity;
};

export interface ModuleRequestAuthorizer {
  canAccess(request: ApiRequest, descriptor: ModuleDefinition["descriptor"]): Promise<boolean>;
}

export const denyModuleRequestAuthorizer: ModuleRequestAuthorizer = {
  async canAccess() {
    return false;
  }
};

export type FoundationApiOptions = {
  modules: readonly ModuleDefinition[];
  environment?: Record<string, string | undefined>;
  scientificGateway: ScientificGateway;
  moduleAuthorizer?: ModuleRequestAuthorizer;
  databaseProbe?: () => Promise<{ healthy: boolean }>;
  workflowLauncher?: WorkflowLauncher;
  diagnosticProbeToken?: string;
  logSink?: LogSink;
  apiTimeoutMs?: number;
};

class AuthorizedModuleApiRegistrar implements ApiRouteRegistrar {
  constructor(
    private readonly router: InternalApiRouter,
    private readonly descriptor: ModuleDefinition["descriptor"],
    private readonly authorizer: ModuleRequestAuthorizer
  ) {}

  get(path: string, handler: ApiRouteHandler): void {
    this.register("GET", path, handler);
  }

  register(method: string, path: string, handler: ApiRouteHandler): void {
    this.router.registerModule(method, path, this.descriptor.id, async (request) => {
      let allowed = false;
      try {
        allowed = await this.authorizer.canAccess(request, this.descriptor);
      } catch {
        allowed = false;
      }

      if (!allowed) {
        return {
          status: 403,
          body: toErrorEnvelope(
            "FORBIDDEN",
            "Module access is not authorized.",
            request.context.requestId
          )
        };
      }
      return handler(request);
    });
  }
}

export function createFoundationApi(options: FoundationApiOptions): FoundationApi {
  const identity = serverIdentity(options.environment ?? process.env);
  const apiTimeoutMs = resolveApiTimeout(options.apiTimeoutMs);
  const logger = createLogger(
    {
      service: "nox-api",
      environment: identity.environment,
      sourceSha: identity.sourceSha
    },
    options.logSink
  );
  const router = new InternalApiRouter();
  const moduleAuthorizer = options.moduleAuthorizer ?? denyModuleRequestAuthorizer;

  router.get("/health", async (request) => {
    const scientific = await options.scientificGateway.evaluate<undefined, undefined>(undefined);
    const database: DatabaseHealth = options.databaseProbe
      ? await options.databaseProbe()
      : { healthy: false, unconfigured: true };
    const status = database.healthy
      ? scientific.state === "UNAVAILABLE"
        ? "DEGRADED"
        : "HEALTHY"
      : database.unconfigured
        ? "DEGRADED"
        : "UNHEALTHY";

    return {
      status: 200,
      body: {
        status,
        environment: request.context.environment,
        sourceSha: request.context.sourceSha,
        service: "nox-api",
        version: "0.1.0",
        dependencies: {
          scientific: scientific.state,
          database: database.healthy
            ? "AVAILABLE"
            : database.unconfigured
              ? "UNCONFIGURED"
              : "UNAVAILABLE"
        }
      }
    };
  });

  router.get("/version", async (request) => ({
    status: 200,
    body: {
      service: "nox-api",
      version: "0.1.0",
      environment: request.context.environment,
      sourceSha: request.context.sourceSha,
      providerTargetEnvironment: identity.providerTargetEnvironment
    }
  }));

  const workflowLauncher = options.workflowLauncher;
  const diagnosticProbeToken = options.diagnosticProbeToken;
  if (workflowLauncher && diagnosticProbeToken) {
    router.register("POST", "/internal/diagnostics/workflow", async (request) => {
      if (
        !secureTokenMatches(request.headers["x-nox-diagnostic-probe-token"], diagnosticProbeToken)
      ) {
        return {
          status: 403,
          body: toErrorEnvelope(
            "FORBIDDEN",
            "Diagnostic workflow probe is not authorized.",
            request.context.requestId
          )
        };
      }

      const handle = await launchWorkflowProbe(workflowLauncher, {
        correlationId: request.context.correlationId,
        workflowId: diagnosticIdentifier(
          request.headers["x-nox-diagnostic-workflow-id"],
          "workflow_probe"
        ),
        idempotencyKey: diagnosticIdentifier(
          request.headers["x-nox-diagnostic-idempotency-key"],
          "idempotency"
        )
      });
      return {
        status: handle.state === "COMPLETED" ? 200 : 202,
        body: {
          workflowId: handle.id,
          state: handle.state,
          correlationId: handle.correlationId
        }
      };
    });
  }

  for (const moduleDefinition of options.modules) {
    if (
      moduleDefinition.descriptor.lifecycle === "DISABLED" ||
      moduleDefinition.descriptor.lifecycle === "DEPRECATED"
    ) {
      continue;
    }
    moduleDefinition.api.registerRoutes(
      new AuthorizedModuleApiRegistrar(router, moduleDefinition.descriptor, moduleAuthorizer)
    );
  }

  return {
    identity,
    async dispatch(request: ApiRequest): Promise<ApiResponse> {
      try {
        const response = await withApiTimeout(router.dispatch(request), apiTimeoutMs);
        logger.log("info", "API request completed.", {
          requestId: request.context.requestId,
          correlationId: request.context.correlationId,
          moduleId: router.moduleIdFor(request),
          details: { status: response.status }
        });
        return {
          ...response,
          headers: {
            "x-request-id": request.context.requestId,
            "x-correlation-id": request.context.correlationId,
            ...response.headers
          }
        };
      } catch (error) {
        if (error instanceof ApiTimeoutError) {
          logger.log("error", "API request exceeded the foundation timeout.", {
            requestId: request.context.requestId,
            correlationId: request.context.correlationId,
            moduleId: router.moduleIdFor(request)
          });
          return {
            status: 504,
            body: toErrorEnvelope(
              "REQUEST_TIMEOUT",
              "The request exceeded the configured time limit.",
              request.context.requestId
            ),
            headers: {
              "x-request-id": request.context.requestId,
              "x-correlation-id": request.context.correlationId
            }
          };
        }
        logger.log("error", "API request failed.", {
          requestId: request.context.requestId,
          correlationId: request.context.correlationId,
          moduleId: router.moduleIdFor(request)
        });
        return {
          status: 500,
          body: toErrorEnvelope(
            "INTERNAL_ERROR",
            "An unexpected internal error occurred.",
            request.context.requestId
          )
        };
      }
    }
  };
}

class ApiTimeoutError extends Error {
  constructor() {
    super("Foundation API request timed out.");
  }
}

function resolveApiTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_API_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) {
    throw new Error("Foundation API timeout must be an integer from 1 to 30000 milliseconds.");
  }
  return timeout;
}

function withApiTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new ApiTimeoutError()), timeoutMs);
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export interface WorkflowAuthorityRevalidator {
  revalidate(context: WorkflowContext): Promise<boolean>;
}

export class UnavailableWorkflowLauncher implements WorkflowLauncher {
  async start<T>(
    _workflowType: string,
    _input: T,
    context: WorkflowContext
  ): Promise<WorkflowHandle> {
    return {
      id: context.workflowId,
      state: "FAILED"
    };
  }
}

export type HttpWorkflowLauncherOptions = {
  endpoint: string;
  bearerToken?: string;
  request?: typeof fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class HttpWorkflowLauncher implements WorkflowLauncher {
  private readonly request: typeof fetch;

  constructor(private readonly options: HttpWorkflowLauncherOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:") {
      throw new Error("Workflow launcher endpoint must use HTTPS.");
    }
    if (
      options.maxAttempts !== undefined &&
      (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 3)
    ) {
      throw new Error("Workflow launcher maxAttempts must be an integer from 1 to 3.");
    }
    this.request = options.request ?? fetch;
  }

  async start<T>(
    workflowType: string,
    input: T,
    context: WorkflowContext
  ): Promise<WorkflowHandle> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(this.options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": context.idempotencyKey,
            ...(this.options.bearerToken
              ? { authorization: "Bearer " + this.options.bearerToken }
              : {})
          },
          body: JSON.stringify({ workflowType, input, context })
        });
      } catch {
        if (attempt === maxAttempts) {
          throw new Error("Workflow launcher endpoint was unreachable.");
        }
        await this.pauseBeforeRetry(attempt);
        continue;
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          await this.pauseBeforeRetry(attempt);
          continue;
        }
        throw new Error("Workflow launcher endpoint rejected the request.");
      }

      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !("id" in payload) ||
        !("state" in payload) ||
        !("correlationId" in payload) ||
        typeof payload.id !== "string" ||
        typeof payload.state !== "string" ||
        typeof payload.correlationId !== "string" ||
        !["QUEUED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"].includes(
          payload.state
        )
      ) {
        throw new Error("Workflow launcher endpoint returned an invalid handle.");
      }

      return {
        id: payload.id,
        state: payload.state as WorkflowHandle["state"],
        correlationId: payload.correlationId
      };
    }

    throw new Error("Workflow launcher exhausted retry attempts.");
  }

  private async pauseBeforeRetry(attempt: number): Promise<void> {
    const milliseconds = (this.options.retryDelayMs ?? 100) * 2 ** (attempt - 1);
    if (this.options.sleep) {
      await this.options.sleep(milliseconds);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

export type WorkflowProbeIdentity = Pick<RequestContext, "correlationId"> & {
  workflowId?: string;
  idempotencyKey?: string;
};

export async function launchWorkflowProbe(
  launcher: WorkflowLauncher,
  identity: WorkflowProbeIdentity = { correlationId: createOpaqueId("corr") }
): Promise<WorkflowHandle> {
  const context: WorkflowContext = {
    workflowId: identity.workflowId ?? createOpaqueId("workflow_probe"),
    scope: { type: "GLOBAL" },
    actor: { type: "SYSTEM" },
    correlationId: identity.correlationId,
    idempotencyKey: identity.idempotencyKey ?? createOpaqueId("idempotency")
  };
  const handle = await launcher.start(
    "nox.foundation.diagnostic",
    { purpose: "cloud-foundation-acceptance" },
    context
  );

  if (handle.id !== context.workflowId) {
    throw new Error("Workflow probe returned an unexpected workflow identifier.");
  }
  if (handle.state === "FAILED" || handle.state === "CANCELLED") {
    throw new Error("Workflow probe was rejected by the durable execution provider.");
  }
  if (handle.correlationId !== context.correlationId) {
    throw new Error("Workflow probe did not retain the API correlation identifier.");
  }
  return handle;
}

function diagnosticIdentifier(value: string | undefined, prefix: string): string {
  if (!value) {
    return createOpaqueId(prefix);
  }
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw new Error("Diagnostic workflow identifier has an invalid format.");
  }
  return value;
}

function secureTokenMatches(supplied: string | undefined, expected: string): boolean {
  if (!supplied || supplied.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function requireCurrentWorkflowAuthority(
  context: WorkflowContext,
  revalidator: WorkflowAuthorityRevalidator
): Promise<void> {
  const allowed = await revalidator.revalidate(context);
  if (!allowed) {
    throw new Error("Workflow authority must be revalidated before a consequential step.");
  }
}

export interface AccessAdmissionPort {
  admits(headers: Readonly<Record<string, string | undefined>>): Promise<boolean>;
}

export const noAccessAdmission: AccessAdmissionPort = {
  async admits(): Promise<boolean> {
    return false;
  }
};
