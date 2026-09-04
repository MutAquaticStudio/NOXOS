import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import { QualityControlApplication } from "./application.js";
import { qualityControlPermissions, type QualityControlPermission } from "./authorization.js";
import {
  createInspectionSchema,
  createSpecificationSchema,
  reasonSchema,
  reinspectionSchema,
  replaceInspectionResultsSchema,
  replaceSpecificationItemsSchema,
  updateInspectionSchema,
  updateSpecificationSchema,
  uuidSchema
} from "./contracts.js";
import { QualityControlProblem } from "./problem.js";

const MODULE_ID = "quality-control";
const ENTITLEMENT = "module.quality-control";
const json = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(json)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]))
        : value;

function parameter(
  request: ApiRequest,
  name: string,
  code: "QC_BATCH_NOT_FOUND" | "QC_INSPECTION_NOT_FOUND" | "QC_SPECIFICATION_NOT_FOUND"
): string {
  const value = request.params?.[name];
  if (!value || !uuidSchema.safeParse(value).success) {
    throw new QualityControlProblem(404, code, "Quality Control identity was not found.");
  }
  return value;
}

function body<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  return schema.parse(request.body);
}

export class QualityControlApi {
  constructor(
    private readonly options: {
      application: QualityControlApplication;
      authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
      definitions: readonly ModuleDefinition[];
      featureFlags: FeatureFlagResolver;
    }
  ) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/quality-control",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.read);
        return {
          status: 200,
          body: {
            batches: json(await this.options.application.listBatches(context.tenant.tenantId))
          }
        };
      })
    );
    registrar.get(
      "/quality-control/specifications",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.read);
        return {
          status: 200,
          body: {
            specifications: json(
              await this.options.application.listSpecifications(context.tenant.tenantId)
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/quality-control/specifications",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.manageSpecification);
        return {
          status: 201,
          body: {
            specification: json(
              await this.options.application.createSpecification(
                context,
                body(createSpecificationSchema, request) as never
              )
            )
          }
        };
      })
    );
    registrar.get(
      "/quality-control/specifications/:specificationId",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.read);
        const specification = await this.options.application.findSpecification(
          context.tenant.tenantId,
          parameter(request, "specificationId", "QC_SPECIFICATION_NOT_FOUND")
        );
        if (!specification)
          throw new QualityControlProblem(
            404,
            "QC_SPECIFICATION_NOT_FOUND",
            "QC specification was not found."
          );
        return { status: 200, body: { specification: json(specification) } };
      })
    );
    registrar.register(
      "PUT",
      "/quality-control/specifications/:specificationId",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.manageSpecification);
        return {
          status: 200,
          body: {
            specification: json(
              await this.options.application.updateSpecification(
                context,
                parameter(request, "specificationId", "QC_SPECIFICATION_NOT_FOUND"),
                body(updateSpecificationSchema, request)
              )
            )
          }
        };
      })
    );
    registrar.register(
      "PUT",
      "/quality-control/specifications/:specificationId/items",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.manageSpecification);
        const input = body(replaceSpecificationItemsSchema, request);
        return {
          status: 200,
          body: {
            specification: json(
              await this.options.application.replaceSpecificationItems(
                context,
                parameter(request, "specificationId", "QC_SPECIFICATION_NOT_FOUND"),
                input.items
              )
            )
          }
        };
      })
    );
    this.specificationAction(registrar, "activate", (context, id) =>
      this.options.application.activateSpecification(context, id)
    );
    this.specificationAction(registrar, "retire", (context, id) =>
      this.options.application.retireSpecification(context, id)
    );

    registrar.register(
      "POST",
      "/quality-control/inspections",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.createInspection);
        return {
          status: 201,
          body: {
            inspection: json(
              await this.options.application.createInspection(
                context,
                body(createInspectionSchema, request) as never
              )
            )
          }
        };
      })
    );
    registrar.get(
      "/quality-control/inspections/:inspectionId",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.read);
        const inspection = await this.options.application.findInspection(
          context.tenant.tenantId,
          parameter(request, "inspectionId", "QC_INSPECTION_NOT_FOUND")
        );
        if (!inspection)
          throw new QualityControlProblem(
            404,
            "QC_INSPECTION_NOT_FOUND",
            "QC inspection was not found."
          );
        return { status: 200, body: { inspection: json(inspection) } };
      })
    );
    registrar.register(
      "PUT",
      "/quality-control/inspections/:inspectionId",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.editInspection);
        return {
          status: 200,
          body: {
            inspection: json(
              await this.options.application.updateInspection(
                context,
                parameter(request, "inspectionId", "QC_INSPECTION_NOT_FOUND"),
                body(updateInspectionSchema, request)
              )
            )
          }
        };
      })
    );
    registrar.register(
      "PUT",
      "/quality-control/inspections/:inspectionId/results",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.editInspection);
        const input = body(replaceInspectionResultsSchema, request);
        return {
          status: 200,
          body: {
            inspection: json(
              await this.options.application.replaceInspectionResults(
                context,
                parameter(request, "inspectionId", "QC_INSPECTION_NOT_FOUND"),
                input.results
              )
            )
          }
        };
      })
    );
    this.inspectionAction(
      registrar,
      "finalize",
      qualityControlPermissions.finalizeInspection,
      (context, id) => this.options.application.finalizeInspection(context, id)
    );
    this.inspectionAction(
      registrar,
      "cancel",
      qualityControlPermissions.cancelInspection,
      (context, id) => this.options.application.cancelInspection(context, id)
    );
    registrar.register(
      "POST",
      "/quality-control/inspections/:inspectionId/reinspect",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.createInspection);
        const input = body(reinspectionSchema, request);
        return {
          status: 201,
          body: {
            inspection: json(
              await this.options.application.createReinspection(
                context,
                parameter(request, "inspectionId", "QC_INSPECTION_NOT_FOUND"),
                input.retestReason
              )
            )
          }
        };
      })
    );

    registrar.get(
      "/quality-control/batches/:batchId",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.read);
        const batch = await this.options.application.findBatch(
          context.tenant.tenantId,
          parameter(request, "batchId", "QC_BATCH_NOT_FOUND")
        );
        if (!batch)
          throw new QualityControlProblem(
            404,
            "QC_BATCH_NOT_FOUND",
            "Production Batch was not found."
          );
        return { status: 200, body: { batch: json(batch) } };
      })
    );
    registrar.register(
      "POST",
      "/quality-control/batches/:batchId/hold",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.holdBatch);
        return {
          status: 200,
          body: {
            decision: json(
              await this.options.application.holdBatch(
                context,
                parameter(request, "batchId", "QC_BATCH_NOT_FOUND"),
                body(reasonSchema, request).reason
              )
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/quality-control/batches/:batchId/release",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.releaseBatch);
        return {
          status: 200,
          body: {
            decision: json(
              await this.options.application.releaseBatch(
                context,
                parameter(request, "batchId", "QC_BATCH_NOT_FOUND")
              )
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/quality-control/batches/:batchId/reject",
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.rejectBatch);
        return {
          status: 200,
          body: {
            decision: json(
              await this.options.application.rejectBatch(
                context,
                parameter(request, "batchId", "QC_BATCH_NOT_FOUND"),
                body(reasonSchema, request).reason
              )
            )
          }
        };
      })
    );
  }

  private specificationAction(
    registrar: ApiRouteRegistrar,
    action: "activate" | "retire",
    fn: (context: TenantRequestContext, id: string) => Promise<unknown>
  ): void {
    registrar.register(
      "POST",
      `/quality-control/specifications/:specificationId/${action}`,
      this.handle(async (request) => {
        const context = await this.tenant(request, qualityControlPermissions.manageSpecification);
        return {
          status: 200,
          body: {
            specification: json(
              await fn(context, parameter(request, "specificationId", "QC_SPECIFICATION_NOT_FOUND"))
            )
          }
        };
      })
    );
  }

  private inspectionAction(
    registrar: ApiRouteRegistrar,
    action: "finalize" | "cancel",
    permission: QualityControlPermission,
    fn: (context: TenantRequestContext, id: string) => Promise<unknown>
  ): void {
    registrar.register(
      "POST",
      `/quality-control/inspections/:inspectionId/${action}`,
      this.handle(async (request) => {
        const context = await this.tenant(request, permission);
        return {
          status: 200,
          body: {
            inspection: json(
              await fn(context, parameter(request, "inspectionId", "QC_INSPECTION_NOT_FOUND"))
            )
          }
        };
      })
    );
  }

  private async tenant(
    request: ApiRequest,
    permission: QualityControlPermission
  ): Promise<TenantRequestContext> {
    const context = await this.options.authorization.tenantContext(request);
    const definition = this.options.definitions.find((value) => value.descriptor.id === MODULE_ID);
    if (
      !definition ||
      definition.descriptor.lifecycle === "DISABLED" ||
      !this.options.featureFlags.isEnabled(definition.descriptor.featureFlag) ||
      !context.entitlements.includes(ENTITLEMENT) ||
      !context.authorization.modulePermissions.includes(permission)
    ) {
      throw new QualityControlProblem(403, "PERMISSION_DENIED", "Quality Control access denied.");
    }
    return context;
  }

  private handle(fn: (request: ApiRequest) => Promise<ApiResponse>) {
    return async (request: ApiRequest): Promise<ApiResponse> => {
      try {
        return await fn(request);
      } catch (error) {
        if (error instanceof QualityControlProblem)
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

export function createQualityControlApi(
  options: ConstructorParameters<typeof QualityControlApi>[0]
): QualityControlApi {
  return new QualityControlApi(options);
}
