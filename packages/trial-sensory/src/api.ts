import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ErrorCode,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FormulaRevisionPort } from "@nox-os/design-studio";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import { TrialSensoryApplication } from "./application.js";
import {
  createEvaluationSchema,
  createTrialSchema,
  finalizeEvaluationSchema,
  updateEvaluationSchema,
  type SensoryEvaluation,
  type Trial
} from "./contracts.js";
import {
  trialSensoryPermissions,
  type TrialSensoryPermission,
  type TrialSensoryTenantContext
} from "./authorization.js";
import { TrialSensoryProblem } from "./problem.js";

const MODULE_ID = "trial-sensory";
const ENTITLEMENT = "module.trial-sensory";
const uuid = z.string().uuid();

export type TrialSensoryApiOptions = {
  application: TrialSensoryApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
  revisionPortFactory: (context: TrialSensoryTenantContext) => FormulaRevisionPort;
};

function routeUuid(request: ApiRequest, name: string): string {
  const result = uuid.safeParse(request.params?.[name]);
  if (!result.success)
    throw new TrialSensoryProblem(404, "TRIAL_NOT_FOUND", "Route identity is invalid.");
  return result.data;
}

function body<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  const result = schema.safeParse(request.body);
  if (!result.success) throw result.error;
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

function tenantApplicationContext(context: TenantRequestContext): TrialSensoryTenantContext {
  return {
    tenantId: context.tenant.tenantId,
    actorUserId: context.actor.userId,
    permissions: new Set(context.authorization.modulePermissions)
  };
}

function trialPayload(value: Trial | SensoryEvaluation) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    ...("formulaVersionId" in value
      ? {
          preparedAt: value.preparedAt?.toISOString() ?? null,
          cancelledAt: value.cancelledAt?.toISOString() ?? null
        }
      : {}),
    ...("evaluationText" in value
      ? {
          finalizedAt: value.finalizedAt?.toISOString() ?? null
        }
      : {})
  };
}

export class TrialSensoryApi {
  constructor(private readonly options: TrialSensoryApiOptions) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/trials",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.readTrial);
        const trials = await this.options.application.listTrials(context.tenant.tenantId);
        return { status: 200, body: { trials: trials.map(trialPayload) } };
      })
    );

    registrar.register(
      "POST",
      "/trials",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.createTrial);
        const trial = await this.options.application.createTrial(
          commandContext(context, request),
          body(createTrialSchema, request)
        );
        return { status: 201, body: { trial: trialPayload(trial) } };
      })
    );

    registrar.get(
      "/trials/:trialId",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.readTrial);
        const trial = await this.options.application.requireTrial(
          context.tenant.tenantId,
          routeUuid(request, "trialId")
        );
        const evaluation = await this.options.application.findEvaluationForTrial(
          context.tenant.tenantId,
          trial.id
        );
        const formula = await this.options.application.findFormulaForTrial(
          context.tenant.tenantId,
          trial
        );
        return {
          status: 200,
          body: {
            trial: trialPayload(trial),
            evaluation: evaluation ? trialPayload(evaluation) : null,
            formula: formula
              ? {
                  formulaVersionId: formula.formulaVersionId,
                  name: formula.name,
                  versionNumber: formula.versionNumber,
                  compositionKind: formula.compositionKind,
                  lines: formula.candidate.lines.map((line) => ({
                    materialId: line.materialId,
                    displayName: line.materialSnapshot.material.displayName
                  }))
                }
              : null
          }
        };
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/prepare",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.prepareTrial);
        const trial = await this.options.application.prepareTrial(
          commandContext(context, request),
          routeUuid(request, "trialId")
        );
        return { status: 200, body: { trial: trialPayload(trial) } };
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/cancel",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.cancelTrial);
        const trial = await this.options.application.cancelTrial(
          commandContext(context, request),
          routeUuid(request, "trialId")
        );
        return { status: 200, body: { trial: trialPayload(trial) } };
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/evaluations",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.createEvaluation);
        const trialId = routeUuid(request, "trialId");
        const evaluation = await this.options.application.createEvaluation(
          commandContext(context, request),
          trialId,
          body(createEvaluationSchema, request)
        );
        return { status: 201, body: { evaluation: trialPayload(evaluation) } };
      })
    );

    registrar.get(
      "/trials/:trialId/evaluations/:evaluationId",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.readTrial);
        const evaluation = await this.options.application.requireEvaluation(
          context.tenant.tenantId,
          routeUuid(request, "trialId"),
          routeUuid(request, "evaluationId")
        );
        return { status: 200, body: { evaluation: trialPayload(evaluation) } };
      })
    );

    registrar.register(
      "PUT",
      "/trials/:trialId/evaluations/:evaluationId",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.editEvaluation);
        const evaluation = await this.options.application.updateEvaluation(
          commandContext(context, request),
          routeUuid(request, "trialId"),
          routeUuid(request, "evaluationId"),
          body(updateEvaluationSchema, request)
        );
        return { status: 200, body: { evaluation: trialPayload(evaluation) } };
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/evaluations/:evaluationId/interpret",
      this.handle(async (request) => {
        await this.tenant(request, trialSensoryPermissions.editEvaluation);
        this.options.application.interpret();
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/evaluations/:evaluationId/finalize",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.finalizeEvaluation);
        const evaluation = await this.options.application.finalizeEvaluation(
          commandContext(context, request),
          routeUuid(request, "trialId"),
          routeUuid(request, "evaluationId"),
          body(finalizeEvaluationSchema, request)
        );
        return { status: 200, body: { evaluation: trialPayload(evaluation) } };
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/evaluations/:evaluationId/create-revision",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.requestRevision);
        const sourceTrialId = routeUuid(request, "trialId");
        const sourceEvaluationId = routeUuid(request, "evaluationId");
        const revisionContext = await this.options.application.findRevisionContext({
          tenantId: context.tenant.tenantId,
          sourceTrialId,
          sourceEvaluationId
        });
        if (!revisionContext)
          throw new TrialSensoryProblem(
            409,
            "REVISION_NOT_ALLOWED",
            "A FINAL REVISION_REQUIRED evaluation is required."
          );
        const candidates = await this.options
          .revisionPortFactory(tenantApplicationContext(context))
          .createRevisionCandidate(revisionContext);
        await this.options.application.store.recordAudit({
          ...commandContext(context, request),
          action: "revision.requested",
          resourceType: "SensoryEvaluation",
          resourceId: sourceEvaluationId,
          metadata: {
            sourceTrialId,
            parentFormulaVersionId: revisionContext.parentFormulaVersionId
          }
        });
        return { status: 200, body: { revisionContext, candidates } };
      })
    );

    registrar.register(
      "POST",
      "/trials/:trialId/evaluations/:evaluationId/recommend-approval",
      this.handle(async (request) => {
        const context = await this.tenant(request, trialSensoryPermissions.recommendApproval);
        const sourceTrialId = routeUuid(request, "trialId");
        const sourceEvaluationId = routeUuid(request, "evaluationId");
        const trial = await this.options.application.requireTrial(
          context.tenant.tenantId,
          sourceTrialId
        );
        const evidence = await this.options.application.findApprovalEvidence({
          tenantId: context.tenant.tenantId,
          formulaVersionId: trial.formulaVersionId,
          sourceTrialId,
          sourceEvaluationId
        });
        if (!evidence)
          throw new TrialSensoryProblem(
            409,
            "APPROVAL_EVIDENCE_INVALID",
            "A FINAL READY_FOR_APPROVAL evaluation is required."
          );
        await this.options.application.store.recordAudit({
          ...commandContext(context, request),
          action: "approval.recommended",
          resourceType: "SensoryEvaluation",
          resourceId: sourceEvaluationId,
          metadata: { sourceTrialId, formulaVersionId: trial.formulaVersionId }
        });
        return { status: 200, body: { evidence } };
      })
    );
  }

  private async tenant(
    request: ApiRequest,
    permission: TrialSensoryPermission
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
      throw new TrialSensoryProblem(403, "PERMISSION_DENIED", "Trial & Sensory access denied.");
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

export function createTrialSensoryApi(options: TrialSensoryApiOptions): TrialSensoryApi {
  return new TrialSensoryApi(options);
}
