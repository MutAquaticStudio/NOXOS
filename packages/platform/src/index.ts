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
import { createLogger } from "@nox-os/observability";
import { createOpaqueId } from "@nox-os/shared";

type RouteKey = string;

function key(method: string, path: string): RouteKey {
  return method.toUpperCase() + " " + path;
}

export class InternalApiRouter implements ApiRouteRegistrar {
  private readonly routes = new Map<RouteKey, ApiRouteHandler>();

  get(path: string, handler: ApiRouteHandler): void {
    this.register("GET", path, handler);
  }

  register(method: string, path: string, handler: ApiRouteHandler): void {
    const routeKey = key(method, path);
    if (this.routes.has(routeKey)) {
      throw new Error("Duplicate API route: " + routeKey);
    }
    this.routes.set(routeKey, handler);
  }

  async dispatch(request: ApiRequest): Promise<ApiResponse> {
    const handler = this.routes.get(key(request.method, request.path));
    if (!handler) {
      return {
        status: 404,
        body: toErrorEnvelope(
          "NOT_FOUND",
          "The requested API route was not found.",
          request.context.requestId
        )
      };
    }
    return handler(request);
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

export type FoundationApiOptions = {
  modules: readonly ModuleDefinition[];
  environment?: Record<string, string | undefined>;
  scientificGateway: ScientificGateway;
};

export function createFoundationApi(options: FoundationApiOptions): FoundationApi {
  const identity = serverIdentity(options.environment ?? process.env);
  const logger = createLogger({
    service: "nox-api",
    environment: identity.environment,
    sourceSha: identity.sourceSha
  });
  const router = new InternalApiRouter();

  router.get("/health", async (request) => {
    const scientific = await options.scientificGateway.evaluate<undefined, undefined>(undefined);
    const status = scientific.state === "UNAVAILABLE" ? "DEGRADED" : "HEALTHY";

    return {
      status: 200,
      body: {
        status,
        environment: request.context.environment,
        sourceSha: request.context.sourceSha,
        service: "nox-api",
        version: "0.1.0",
        dependencies: { scientific: scientific.state }
      }
    };
  });

  router.get("/version", async (request) => ({
    status: 200,
    body: {
      service: "nox-api",
      version: "0.1.0",
      environment: request.context.environment,
      sourceSha: request.context.sourceSha
    }
  }));

  for (const moduleDefinition of options.modules) {
    moduleDefinition.api.registerRoutes(router);
  }

  return {
    identity,
    async dispatch(request: ApiRequest): Promise<ApiResponse> {
      try {
        const response = await router.dispatch(request);
        logger.log("info", "API request completed.", {
          requestId: request.context.requestId,
          correlationId: request.context.correlationId
        });
        return {
          ...response,
          headers: {
            "x-request-id": request.context.requestId,
            "x-correlation-id": request.context.correlationId,
            ...response.headers
          }
        };
      } catch {
        logger.log("error", "API request failed.", {
          requestId: request.context.requestId,
          correlationId: request.context.correlationId
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

export async function requireCurrentWorkflowAuthority(
  context: WorkflowContext,
  revalidator: WorkflowAuthorityRevalidator
): Promise<void> {
  const allowed = await revalidator.revalidate(context);
  if (!allowed) {
    throw new Error("Workflow authority must be revalidated before a consequential step.");
  }
}

export type TurnstileVerificationOptions = {
  secret: string;
  token: string;
  expectedHostname?: string;
  expectedAction?: string;
  remoteIp?: string;
  idempotencyKey?: string;
};

export type TurnstileVerificationResult = {
  valid: boolean;
  reason?: string;
};

type TurnstileResponse = {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export async function verifyTurnstile(
  options: TurnstileVerificationOptions,
  request: typeof fetch = fetch
): Promise<TurnstileVerificationResult> {
  if (!options.secret || !options.token || options.token.length > 2048) {
    return { valid: false, reason: "Turnstile token is invalid." };
  }

  const form = new URLSearchParams({
    secret: options.secret,
    response: options.token
  });
  if (options.remoteIp) {
    form.set("remoteip", options.remoteIp);
  }
  if (options.idempotencyKey) {
    form.set("idempotency_key", options.idempotencyKey);
  }

  const response = await request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  const result = (await response.json()) as TurnstileResponse;

  if (!result.success) {
    return { valid: false, reason: "Turnstile validation failed." };
  }
  if (options.expectedHostname && result.hostname !== options.expectedHostname) {
    return { valid: false, reason: "Turnstile hostname did not match." };
  }
  if (options.expectedAction && result.action !== options.expectedAction) {
    return { valid: false, reason: "Turnstile action did not match." };
  }

  return { valid: true };
}

export interface AccessAdmissionPort {
  admits(headers: Readonly<Record<string, string | undefined>>): Promise<boolean>;
}

export const noAccessAdmission: AccessAdmissionPort = {
  async admits(): Promise<boolean> {
    return false;
  }
};
