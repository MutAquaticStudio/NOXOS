import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import { ProductionApplication } from "./application.js";
import { productionPermissions, type ProductionPermission } from "./authorization.js";
import {
  abortBatchSchema,
  completeBatchSchema,
  createProductionOrderSchema,
  updateAllocationsSchema,
  updateProductionOrderSchema,
  uuidSchema
} from "./contracts.js";
import { ProductionProblem } from "./problem.js";
const MODULE_ID = "production";
const ENTITLEMENT = "module.production";
const json = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(json)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, json(v)]))
        : value;
function id(request: ApiRequest, name: string): string {
  const value = request.params?.[name];
  if (!value || !uuidSchema.safeParse(value).success)
    throw new ProductionProblem(
      404,
      name === "batchId" ? "PRODUCTION_BATCH_NOT_FOUND" : "PRODUCTION_ORDER_NOT_FOUND",
      "Production identity was not found."
    );
  return value;
}
function body<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  return schema.parse(request.body);
}
export class ProductionApi {
  constructor(
    private readonly options: {
      application: ProductionApplication;
      authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
      definitions: readonly ModuleDefinition[];
      featureFlags: FeatureFlagResolver;
    }
  ) {}
  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/production",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.read);
        return {
          status: 200,
          body: { orders: json(await this.options.application.listOrders(c.tenant.tenantId)) }
        };
      })
    );
    registrar.register(
      "POST",
      "/production/orders",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.createOrder);
        return {
          status: 201,
          body: {
            order: json(
              await this.options.application.createOrder(c, body(createProductionOrderSchema, r))
            )
          }
        };
      })
    );
    registrar.get(
      "/production/orders/:orderId",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.read);
        const value = await this.options.application.findOrder(c.tenant.tenantId, id(r, "orderId"));
        if (!value)
          throw new ProductionProblem(
            404,
            "PRODUCTION_ORDER_NOT_FOUND",
            "Production order was not found."
          );
        return { status: 200, body: { order: json(value) } };
      })
    );
    registrar.register(
      "PUT",
      "/production/orders/:orderId",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.editOrder);
        return {
          status: 200,
          body: {
            order: json(
              await this.options.application.updateOrder(
                c,
                id(r, "orderId"),
                body(updateProductionOrderSchema, r)
              )
            )
          }
        };
      })
    );
    registrar.register(
      "PUT",
      "/production/orders/:orderId/allocations",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.allocate);
        return {
          status: 200,
          body: {
            order: json(
              await this.options.application.updateAllocations(
                c,
                id(r, "orderId"),
                body(updateAllocationsSchema, r).allocations
              )
            )
          }
        };
      })
    );
    const action = (
      path: string,
      permission: ProductionPermission,
      resultKey: "order" | "batch",
      fn: (c: TenantRequestContext, oid: string) => Promise<unknown>
    ) =>
      registrar.register(
        "POST",
        path,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          return {
            status: 200,
            body: { [resultKey]: json(await fn(c, id(r, "orderId"))) }
          };
        })
      );
    action("/production/orders/:orderId/release", productionPermissions.release, "order", (c, i) =>
      this.options.application.releaseOrder(c, i)
    );
    action("/production/orders/:orderId/cancel", productionPermissions.cancel, "order", (c, i) =>
      this.options.application.cancelOrder(c, i)
    );
    action("/production/orders/:orderId/start", productionPermissions.start, "batch", (c, i) =>
      this.options.application.startOrder(c, i)
    );
    registrar.get(
      "/production/batches/:batchId",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.read);
        const value = await this.options.application.findBatch(c.tenant.tenantId, id(r, "batchId"));
        if (!value)
          throw new ProductionProblem(
            404,
            "PRODUCTION_BATCH_NOT_FOUND",
            "Production batch was not found."
          );
        return { status: 200, body: { batch: json(value) } };
      })
    );
    registrar.register(
      "POST",
      "/production/batches/:batchId/complete",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.complete);
        return {
          status: 200,
          body: {
            batch: json(
              await this.options.application.completeBatch(
                c,
                id(r, "batchId"),
                body(completeBatchSchema, r)
              )
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/production/batches/:batchId/abort",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.abort);
        return {
          status: 200,
          body: {
            batch: json(
              await this.options.application.abortBatch(
                c,
                id(r, "batchId"),
                body(abortBatchSchema, r).reason
              )
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/production/orders/:orderId/complete",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.complete);
        const batch = await this.options.application.findBatchForOrder(
          c.tenant.tenantId,
          id(r, "orderId")
        );
        if (!batch)
          throw new ProductionProblem(
            404,
            "PRODUCTION_BATCH_NOT_FOUND",
            "Production batch was not found."
          );
        return {
          status: 200,
          body: {
            batch: json(
              await this.options.application.completeBatch(
                c,
                batch.id,
                body(completeBatchSchema, r)
              )
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/production/orders/:orderId/abort",
      this.handle(async (r) => {
        const c = await this.tenant(r, productionPermissions.abort);
        const batch = await this.options.application.findBatchForOrder(
          c.tenant.tenantId,
          id(r, "orderId")
        );
        if (!batch)
          throw new ProductionProblem(
            404,
            "PRODUCTION_BATCH_NOT_FOUND",
            "Production batch was not found."
          );
        return {
          status: 200,
          body: {
            batch: json(
              await this.options.application.abortBatch(
                c,
                batch.id,
                body(abortBatchSchema, r).reason
              )
            )
          }
        };
      })
    );
  }
  private async tenant(r: ApiRequest, p: ProductionPermission): Promise<TenantRequestContext> {
    const c = await this.options.authorization.tenantContext(r);
    const d = this.options.definitions.find((v) => v.descriptor.id === MODULE_ID);
    if (
      !d ||
      d.descriptor.lifecycle === "DISABLED" ||
      !this.options.featureFlags.isEnabled(d.descriptor.featureFlag) ||
      !c.entitlements.includes(ENTITLEMENT) ||
      !c.authorization.modulePermissions.includes(p)
    )
      throw new ProductionProblem(403, "PERMISSION_DENIED" as never, "Production access denied.");
    return c;
  }
  private handle(fn: (r: ApiRequest) => Promise<ApiResponse>) {
    return async (r: ApiRequest): Promise<ApiResponse> => {
      try {
        return await fn(r);
      } catch (e) {
        if (e instanceof ProductionProblem)
          return {
            status: e.status,
            body: { error: { code: e.code, message: e.message, requestId: r.context.requestId } }
          };
        if (e instanceof z.ZodError)
          return {
            status: 400,
            body: {
              error: {
                code: "VALIDATION_FAILED",
                message: "Request validation failed.",
                requestId: r.context.requestId
              }
            }
          };
        throw e;
      }
    };
  }
}
export function createProductionApi(
  options: ConstructorParameters<typeof ProductionApi>[0]
): ProductionApi {
  return new ProductionApi(options);
}
