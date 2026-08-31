import { z } from "zod";
import { createHash } from "node:crypto";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ErrorCode,
  FileStore,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import {
  buildFormulaIntentFromAccords,
  developAccordIntent,
  validateAccordArchitecture
} from "./accords.js";
import {
  designStudioPermissions,
  DesignStudioApplication,
  requireDesignStudioPermission,
  type DesignStudioTenantContext
} from "./authorization.js";
import {
  budgetContextSchema,
  designWorkflowModeSchema,
  normalizedOlfactoryIntentSchema,
  sourceSignalSchema,
  taxonomyTargetSchema,
  trialContextSchema,
  type FormulaCandidate
} from "./contracts.js";
import { RuleBasedFormulaPerceptionScorer } from "./formula.js";
import { arbitrateIntent, confirmIntent, type ConfirmedIntent } from "./intent.js";
import type { DesignBrief, DesignStudioStore, FrozenFormulaVersion } from "./persistence.js";
import { DesignStudioProblem } from "./problem.js";

const MODULE_ID = "design-studio";
const ENTITLEMENT = "module.design-studio";
const uuid = z.string().uuid();
const fileReferenceId = z
  .string()
  .regex(/^file_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const nonEmpty = z.string().trim().min(1).max(4000);
const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional()
});
const briefCreateSchema = z.object({
  workflowMode: designWorkflowModeSchema,
  rawBrief: nonEmpty,
  applicationKey: z.string().trim().min(1).max(120),
  targetDosagePct: z.number().finite().positive().max(100),
  explicitTags: z.array(taxonomyTargetSchema).max(80).default([]),
  explicitExclusions: z
    .array(taxonomyTargetSchema.omit({ targetStrength: true }))
    .max(80)
    .default([]),
  signals: z.array(sourceSignalSchema).max(160).default([]),
  assetReferences: z
    .array(
      z.object({
        assetId: fileReferenceId,
        modality: z.enum(["IMAGE", "REFERENCE"]),
        sourceName: z.string().trim().min(1).max(240)
      })
    )
    .max(40)
    .default([])
});
const confirmSchema = z.object({ intent: normalizedOlfactoryIntentSchema });
const accordPlanSchema = z.object({ plan: z.unknown().optional() });
const generateSchema = z.object({
  budget: budgetContextSchema.default({ mode: "STANDARD" }),
  accordKey: z.string().trim().min(1).max(160).optional(),
  buildCompleteFromAccords: z.boolean().default(false)
});
const freezeSchema = generateSchema.extend({
  strategy: z.string().trim().min(1).max(80),
  formulaName: z.string().trim().min(1).max(160)
});
const assetUploadSchema = z.object({
  sourceName: z.string().trim().min(1).max(240),
  modality: z.enum(["IMAGE", "REFERENCE"]),
  mimeType: z.string().trim().min(1).max(120),
  contentsBase64: z.string().min(1).max(8_000_000)
});

export type DesignStudioApiOptions = {
  store: DesignStudioStore;
  application: DesignStudioApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
  fileStore?: FileStore;
};

function routeUuid(request: ApiRequest, name: string): string {
  const value = request.params?.[name];
  const result = uuid.safeParse(value);
  if (!result.success)
    throw new DesignStudioProblem(400, "BRIEF_NOT_FOUND", "Route identity is invalid.");
  return result.data;
}
function body<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  const result = schema.safeParse(request.body);
  if (!result.success)
    throw new DesignStudioProblem(400, "INVALID_TAXONOMY_TERM", "Request validation failed.");
  return result.data;
}
function tenantApplicationContext(context: TenantRequestContext): DesignStudioTenantContext {
  return {
    actorUserId: context.actor.userId,
    tenantId: context.tenant.tenantId,
    permissions: new Set(context.authorization.modulePermissions)
  };
}
function confirmedBrief(value: DesignBrief): ConfirmedIntent {
  if (value.status !== "INTENT_CONFIRMED" || !value.normalizedIntent || !value.confirmedByUserId) {
    throw new DesignStudioProblem(
      409,
      "HUMAN_CONFIRMATION_REQUIRED",
      "The brief requires authenticated human intent confirmation."
    );
  }
  const signals = z.array(sourceSignalSchema).safeParse(value.briefPayload.signals);
  return {
    status: "CONFIRMED",
    confirmedByUserId: value.confirmedByUserId,
    intent: normalizedOlfactoryIntentSchema.parse(value.normalizedIntent),
    provenance: signals.success ? signals.data : []
  };
}
function frozenPayload(value: FrozenFormulaVersion) {
  return {
    ...value,
    frozenAt: value.frozenAt.toISOString(),
    candidate: {
      ...value.candidate,
      lines: value.candidate.lines.map((line) => {
        const { scientificInternal: _scientificInternal, ...tenantSnapshot } =
          line.materialSnapshot;
        return { ...line, materialSnapshot: tenantSnapshot };
      })
    }
  };
}

export class DesignStudioApi {
  private readonly scorer = new RuleBasedFormulaPerceptionScorer();
  constructor(private readonly options: DesignStudioApiOptions) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.register(
      "POST",
      "/design-studio/assets",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.manageBrief);
        if (!this.options.fileStore)
          throw new DesignStudioProblem(
            503,
            "INTERPRETER_UNAVAILABLE",
            "Private source-asset storage is unavailable in this environment."
          );
        const input = body(assetUploadSchema, request);
        const contents = Buffer.from(input.contentsBase64, "base64");
        if (contents.length === 0 || contents.length > 5_000_000)
          throw new DesignStudioProblem(
            400,
            "INTERPRETER_UNAVAILABLE",
            "Source asset size is invalid."
          );
        const reference = await this.options.fileStore.put(
          {
            scope: "TENANT",
            tenantId: context.tenant.tenantId,
            checksum: createHash("sha256").update(contents).digest("hex"),
            mimeType: input.mimeType,
            purpose: "design-brief-source",
            classification: "PRIVATE"
          },
          contents,
          {
            actor: { id: context.actor.userId, type: "USER" },
            tenant: { id: context.tenant.tenantId },
            allowedPurposes: ["design-brief-source"]
          }
        );
        return {
          status: 201,
          body: {
            asset: {
              assetId: reference.id,
              sourceName: input.sourceName,
              modality: input.modality,
              mimeType: reference.mimeType,
              checksum: reference.checksum
            },
            interpretation: {
              state: "INTERPRETER_UNAVAILABLE",
              message: "Asset provenance is preserved; continue with manual taxonomy mapping."
            }
          }
        };
      })
    );
    registrar.get(
      "/design-studio/projects",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.read);
        return {
          status: 200,
          body: { projects: await this.options.store.listProjects(context.tenant.tenantId) }
        };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/projects",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.createProject);
        const input = body(projectCreateSchema, request);
        const project = await this.options.store.createProject({
          tenantId: context.tenant.tenantId,
          name: input.name,
          description: input.description ?? null,
          actorUserId: context.actor.userId
        });
        await this.audit(context, request, "project.created", "DesignProject", project.id);
        return { status: 201, body: { project } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/projects/:projectId/briefs",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.manageBrief);
        const projectId = routeUuid(request, "projectId");
        if (!(await this.options.store.findProject(context.tenant.tenantId, projectId)))
          throw new DesignStudioProblem(404, "PROJECT_NOT_FOUND", "Project was not found.");
        const input = body(briefCreateSchema, request);
        const draft = arbitrateIntent({
          rawBriefSummary: input.rawBrief,
          applicationProfile: {
            applicationKey: input.applicationKey,
            targetDosagePct: input.targetDosagePct
          },
          explicitTags: input.explicitTags,
          explicitExclusions: input.explicitExclusions,
          signals: input.signals
        });
        const designBrief = await this.options.store.createBrief({
          tenantId: context.tenant.tenantId,
          projectId,
          workflowMode: input.workflowMode,
          rawBrief: input.rawBrief,
          briefPayload: {
            signals: input.signals,
            assetReferences: input.assetReferences,
            interpreterState:
              input.assetReferences.length > 0 ? "INTERPRETER_UNAVAILABLE" : "TEXT_ONLY"
          },
          normalizedIntent: draft.intent,
          actorUserId: context.actor.userId
        });
        await this.audit(context, request, "brief.updated", "DesignBrief", designBrief.id, {
          operation: "CREATED"
        });
        return { status: 201, body: { brief: designBrief, intentDraft: draft } };
      })
    );
    registrar.get(
      "/design-studio/briefs/:briefId",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.read);
        const designBrief = await this.requireBrief(context, routeUuid(request, "briefId"));
        return { status: 200, body: { brief: designBrief } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/briefs/:briefId/confirm",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.confirmIntent);
        const briefId = routeUuid(request, "briefId");
        const existing = await this.requireBrief(context, briefId);
        const input = body(confirmSchema, request);
        const confirmation = confirmIntent(
          {
            status: "PENDING_CONFIRMATION",
            intent: input.intent,
            provenance:
              z.array(sourceSignalSchema).safeParse(existing.briefPayload.signals).data ?? []
          },
          { confirmed: true, confirmedByUserId: context.actor.userId }
        );
        const designBrief = await this.options.store.confirmBrief({
          tenantId: context.tenant.tenantId,
          briefId,
          intent: confirmation.intent,
          actorUserId: context.actor.userId
        });
        if (!designBrief)
          throw new DesignStudioProblem(
            409,
            "HUMAN_CONFIRMATION_REQUIRED",
            "Brief cannot be confirmed in its current state."
          );
        await this.audit(context, request, "intent.confirmed", "DesignBrief", designBrief.id);
        return { status: 200, body: { brief: designBrief } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/briefs/:briefId/accord-plan",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.planAccord);
        const existing = await this.requireBrief(context, routeUuid(request, "briefId"));
        const plan = this.options.application.planAccordArchitecture(
          tenantApplicationContext(context),
          {
            projectId: existing.projectId,
            sourceBriefId: existing.id,
            confirmedIntent: confirmedBrief(existing)
          }
        );
        const updated = await this.options.store.updateBrief({
          tenantId: context.tenant.tenantId,
          briefId: existing.id,
          accordArchitecturePlan: plan
        });
        await this.audit(context, request, "accord.plan.saved", "DesignBrief", existing.id);
        return { status: 200, body: { plan: updated?.accordArchitecturePlan ?? plan } };
      })
    );
    registrar.register(
      "PUT",
      "/design-studio/briefs/:briefId/accord-plan",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.planAccord);
        const existing = await this.requireBrief(context, routeUuid(request, "briefId"));
        const parsed = body(accordPlanSchema, request);
        const plan = (await import("./accords.js")).accordArchitecturePlanSchema.parse(parsed.plan);
        if (plan.projectId !== existing.projectId || plan.sourceBriefId !== existing.id)
          throw new DesignStudioProblem(400, "BRIEF_NOT_FOUND", "Accord plan lineage is invalid.");
        const issues = validateAccordArchitecture(plan);
        if (issues.length > 0)
          throw new DesignStudioProblem(
            400,
            "INVALID_TAXONOMY_TERM",
            "Accord plan validation failed."
          );
        const updated = await this.options.store.updateBrief({
          tenantId: context.tenant.tenantId,
          briefId: existing.id,
          accordArchitecturePlan: plan
        });
        await this.audit(context, request, "accord.plan.saved", "DesignBrief", existing.id);
        return { status: 200, body: { plan: updated?.accordArchitecturePlan } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/briefs/:briefId/generate",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.generateFormula);
        const input = body(generateSchema, request);
        const candidates = await this.generate(context, routeUuid(request, "briefId"), input);
        await this.audit(
          context,
          request,
          "formula.generated",
          "DesignBrief",
          routeUuid(request, "briefId"),
          { candidateCount: candidates.length }
        );
        return { status: 200, body: { candidates } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/briefs/:briefId/freeze",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.freezeFormula);
        const input = body(freezeSchema, request);
        const briefId = routeUuid(request, "briefId");
        const candidates = await this.generate(context, briefId, input);
        const candidate = candidates.find((value) => value.generationStrategy === input.strategy);
        if (!candidate)
          throw new DesignStudioProblem(
            409,
            "FORMULA_CONSTRAINTS_INFEASIBLE",
            "Selected deterministic candidate is unavailable."
          );
        const frozen = await this.options.store.freezeFormula({
          tenantId: context.tenant.tenantId,
          actorUserId: context.actor.userId,
          requestId: request.context.requestId,
          correlationId: request.context.correlationId,
          projectId: candidate.projectId,
          sourceBriefId: candidate.sourceBriefId,
          formulaName: input.formulaName,
          candidate,
          freshSnapshots: candidate.lines.map((line) => line.materialSnapshot)
        });
        return { status: 201, body: { formulaVersion: frozenPayload(frozen) } };
      })
    );
    registrar.get(
      "/design-studio/formula-versions/:formulaVersionId",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.read);
        const frozen = await this.options.store.findFrozenFormulaVersion(
          context.tenant.tenantId,
          routeUuid(request, "formulaVersionId")
        );
        if (!frozen)
          throw new DesignStudioProblem(
            404,
            "FORMULA_VERSION_NOT_FOUND",
            "Formula version was not found."
          );
        return { status: 200, body: { formulaVersion: frozenPayload(frozen) } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/formula-versions/:formulaVersionId/approve",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.approveFormula);
        const formulaVersion = await this.options.store.approveFrozenFormulaVersion({
          tenantId: context.tenant.tenantId,
          formulaVersionId: routeUuid(request, "formulaVersionId"),
          actorUserId: context.actor.userId,
          requestId: request.context.requestId,
          correlationId: request.context.correlationId
        });
        if (!formulaVersion)
          throw new DesignStudioProblem(
            409,
            "FORMULA_VERSION_NOT_FOUND",
            "Frozen Formula version cannot be approved in its current state."
          );
        return { status: 200, body: { formulaVersion: frozenPayload(formulaVersion) } };
      })
    );
    registrar.register(
      "POST",
      "/design-studio/formula-versions/:formulaVersionId/trial-context",
      this.handle(async (request) => {
        const context = await this.tenant(request, designStudioPermissions.read);
        const frozen = await this.options.store.findFrozenFormulaVersion(
          context.tenant.tenantId,
          routeUuid(request, "formulaVersionId")
        );
        if (!frozen)
          throw new DesignStudioProblem(
            404,
            "FORMULA_VERSION_NOT_FOUND",
            "Formula version was not found."
          );
        const trial = trialContextSchema.parse({
          formulaVersionId: frozen.formulaVersionId,
          preparationMode: "CONCENTRATE",
          applicationKey: frozen.candidate.intentSnapshot.applicationProfile.applicationKey,
          dosagePct: frozen.candidate.intentSnapshot.applicationProfile.targetDosagePct,
          targetMassMg: "1000000",
          evaluationMedium: "BLOTTER",
          sampleAgeMinutes: 0
        });
        return { status: 200, body: { trialContext: trial } };
      })
    );
  }

  private async generate(
    context: TenantRequestContext,
    briefId: string,
    input: z.infer<typeof generateSchema>
  ): Promise<FormulaCandidate[]> {
    const existing = await this.requireBrief(context, briefId);
    const original = confirmedBrief(existing);
    let confirmed = original;
    let compositionKind: "FULL_FORMULA" | "ACCORD_FORMULATION" = "FULL_FORMULA";
    if (input.accordKey) {
      requireDesignStudioPermission(
        tenantApplicationContext(context),
        designStudioPermissions.developAccord
      );
      if (!existing.accordArchitecturePlan)
        throw new DesignStudioProblem(404, "ACCORD_NOT_FOUND", "Accord plan was not found.");
      confirmed = {
        ...original,
        intent: developAccordIntent(existing.accordArchitecturePlan, input.accordKey, true)
      };
      compositionKind = "ACCORD_FORMULATION";
    } else if (input.buildCompleteFromAccords) {
      if (!existing.accordArchitecturePlan)
        throw new DesignStudioProblem(404, "ACCORD_NOT_FOUND", "Accord plan was not found.");
      confirmed = {
        ...original,
        intent: buildFormulaIntentFromAccords(existing.accordArchitecturePlan)
      };
    }
    return this.options.application.generateFormula(tenantApplicationContext(context), {
      projectId: existing.projectId,
      sourceBriefId: existing.id,
      confirmedIntent: confirmed,
      compositionKind,
      accordPlan: existing.accordArchitecturePlan ?? undefined,
      budget: input.budget,
      scorer: this.scorer
    });
  }

  private async requireBrief(context: TenantRequestContext, briefId: string): Promise<DesignBrief> {
    const value = await this.options.store.findBrief(context.tenant.tenantId, briefId);
    if (!value) throw new DesignStudioProblem(404, "BRIEF_NOT_FOUND", "Brief was not found.");
    return value;
  }

  private audit(
    context: TenantRequestContext,
    request: ApiRequest,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, string | number | boolean | null>
  ): Promise<void> {
    return this.options.store.recordAudit({
      tenantId: context.tenant.tenantId,
      actorUserId: context.actor.userId,
      action,
      resourceType,
      resourceId,
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
      metadata
    });
  }

  private async tenant(
    request: ApiRequest,
    permission: (typeof designStudioPermissions)[keyof typeof designStudioPermissions]
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
      throw new DesignStudioProblem(
        403,
        "TENANT_ACCESS_DENIED",
        "Design Studio access is not granted."
      );
    }
    return context;
  }

  private handle(handler: (request: ApiRequest) => Promise<ApiResponse>) {
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

export function createDesignStudioApi(options: DesignStudioApiOptions): DesignStudioApi {
  return new DesignStudioApi(options);
}
