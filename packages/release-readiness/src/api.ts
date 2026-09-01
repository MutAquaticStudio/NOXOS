import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ErrorCode,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import { ReleaseReadinessApplication } from "./application.js";
import { releaseProfileSchema, type ReleaseAssessment } from "./contracts.js";
import { releaseReadinessPermissions, type ReleaseReadinessPermission } from "./authorization.js";
import { ReleaseReadinessProblem } from "./problem.js";

const MODULE_ID = "release-readiness";
const ENTITLEMENT = "module.release-readiness";
const uuid = z.string().uuid();

export type ReleaseReadinessApiOptions = {
  application: ReleaseReadinessApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
};

function routeUuid(request: ApiRequest, name: string): string {
  const result = uuid.safeParse(request.params?.[name]);
  if (!result.success)
    throw new ReleaseReadinessProblem(404, "NOT_FOUND", "Route identity is invalid.");
  return result.data;
}

function commandContext(context: TenantRequestContext, request: ApiRequest) {
  return {
    tenantId: context.tenant.tenantId,
    actorUserId: context.actor.userId,
    requestId: request.context.requestId,
    correlationId: request.context.correlationId
  };
}

function payload(value: ReleaseAssessment) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    assessedAt: value.assessedAt.toISOString()
  };
}

export class ReleaseReadinessApi {
  constructor(private readonly options: ReleaseReadinessApiOptions) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/release-readiness",
      this.handle(async (request) => {
        const context = await this.tenant(request, releaseReadinessPermissions.read);
        const assessments = await this.options.application.list(context.tenant.tenantId);
        return { status: 200, body: { assessments: assessments.map(payload) } };
      })
    );

    registrar.register(
      "POST",
      "/release-readiness/assessments",
      this.handle(async (request) => {
        const context = await this.tenant(request, releaseReadinessPermissions.create);
        await this.requirePermission(context, releaseReadinessPermissions.run);
        const profile = releaseProfileSchema.parse(request.body);
        const assessment = await this.options.application.assess(
          commandContext(context, request),
          profile
        );
        return { status: 201, body: { assessment: payload(assessment) } };
      })
    );

    registrar.get(
      "/release-readiness/assessments/:assessmentId",
      this.handle(async (request) => {
        const context = await this.tenant(request, releaseReadinessPermissions.read);
        const assessment = await this.options.application.requireAssessment(
          context.tenant.tenantId,
          routeUuid(request, "assessmentId")
        );
        return { status: 200, body: { assessment: payload(assessment) } };
      })
    );

    registrar.register(
      "POST",
      "/release-readiness/assessments/:assessmentId/reassess",
      this.handle(async (request) => {
        const context = await this.tenant(request, releaseReadinessPermissions.run);
        await this.requirePermission(context, releaseReadinessPermissions.review);
        const assessment = await this.options.application.reassess(
          commandContext(context, request),
          routeUuid(request, "assessmentId")
        );
        return { status: 201, body: { assessment: payload(assessment) } };
      })
    );
  }

  private async requirePermission(
    context: TenantRequestContext,
    permission: ReleaseReadinessPermission
  ): Promise<void> {
    if (!context.authorization.modulePermissions.includes(permission)) {
      throw new ReleaseReadinessProblem(
        403,
        "PERMISSION_DENIED",
        "Release Readiness permission denied."
      );
    }
  }

  private async tenant(
    request: ApiRequest,
    permission: ReleaseReadinessPermission
  ): Promise<TenantRequestContext> {
    const context = await this.options.authorization.tenantContext(request);
    const definition = this.options.definitions.find((item) => item.descriptor.id === MODULE_ID);
    if (
      !definition ||
      definition.descriptor.lifecycle === "DISABLED" ||
      definition.descriptor.lifecycle === "DEPRECATED" ||
      !this.options.featureFlags.isEnabled(definition.descriptor.featureFlag) ||
      !context.entitlements.includes(ENTITLEMENT) ||
      !context.authorization.modulePermissions.includes(permission)
    ) {
      throw new ReleaseReadinessProblem(
        403,
        "PERMISSION_DENIED",
        "Release Readiness access denied."
      );
    }
    return context;
  }

  private handle(handler: (request: ApiRequest) => Promise<ApiResponse | never>) {
    return async (request: ApiRequest): Promise<ApiResponse> => {
      try {
        return await handler(request);
      } catch (error) {
        if (isProblem(error))
          return {
            status: error.status,
            body: {
              error: {
                code: error.code,
                message: error.message,
                requestId: request.context.requestId
              }
            }
          };
        if (error instanceof z.ZodError)
          return {
            status: 400,
            body: {
              error: {
                code: "VALIDATION_FAILED",
                message: "Request validation failed.",
                requestId: request.context.requestId
              }
            }
          };
        throw error;
      }
    };
  }
}

function isProblem(value: unknown): value is { status: number; code: ErrorCode; message: string } {
  return Boolean(
    value && typeof value === "object" && "status" in value && "code" in value && "message" in value
  );
}

export function createReleaseReadinessApi(
  options: ReleaseReadinessApiOptions
): ReleaseReadinessApi {
  return new ReleaseReadinessApi(options);
}
