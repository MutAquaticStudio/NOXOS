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
import { ProcurementApplication } from "./application.js";
import { procurementPermissions, type ProcurementPermission } from "./authorization.js";
import {
  createGoodsReceiptSchema,
  createPurchaseOrderSchema,
  createSupplierOfferSchema,
  createSupplierSchema,
  updateGoodsReceiptSchema,
  updatePurchaseOrderSchema,
  updateSupplierOfferSchema,
  updateSupplierSchema
} from "./contracts.js";
import { ProcurementProblem } from "./problem.js";

const MODULE_ID = "procurement";
const ENTITLEMENT = "module.procurement";
const uuid = z.string().uuid();

export type ProcurementApiOptions = {
  application: ProcurementApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
};

function routeUuid(request: ApiRequest, name: string, code: ErrorCode): string {
  const parsed = uuid.safeParse(request.params?.[name]);
  if (!parsed.success)
    throw new ProcurementProblem(404, code as never, "Route identity is invalid.");
  return parsed.data;
}

function body<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  return schema.parse(request.body);
}

function commandContext(context: TenantRequestContext, request: ApiRequest) {
  return {
    tenantId: context.tenant.tenantId,
    actorUserId: context.actor.userId,
    requestId: request.context.requestId,
    correlationId: request.context.correlationId
  };
}

function payload<T>(value: T): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(payload);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, payload(item)]));
  return value;
}

export class ProcurementApi {
  constructor(private readonly options: ProcurementApiOptions) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/procurement/suppliers",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        return {
          status: 200,
          body: {
            suppliers: payload(
              await this.options.application.listSuppliers(context.tenant.tenantId)
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/procurement/suppliers",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.manageSupplier);
        const supplier = await this.options.application.createSupplier(
          commandContext(context, request),
          body(createSupplierSchema, request)
        );
        return { status: 201, body: { supplier: payload(supplier) } };
      })
    );
    registrar.get(
      "/procurement/suppliers/:supplierId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        const supplier = await this.options.application.findSupplier(
          context.tenant.tenantId,
          routeUuid(request, "supplierId", "SUPPLIER_NOT_FOUND")
        );
        if (!supplier)
          throw new ProcurementProblem(404, "SUPPLIER_NOT_FOUND", "Supplier was not found.");
        return { status: 200, body: { supplier: payload(supplier) } };
      })
    );
    registrar.register(
      "PUT",
      "/procurement/suppliers/:supplierId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.manageSupplier);
        const supplier = await this.options.application.updateSupplier(
          commandContext(context, request),
          routeUuid(request, "supplierId", "SUPPLIER_NOT_FOUND"),
          body(updateSupplierSchema, request)
        );
        return { status: 200, body: { supplier: payload(supplier) } };
      })
    );

    registrar.get(
      "/procurement/supplier-offers",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        const supplierId = request.query?.supplierId
          ? uuid.parse(request.query.supplierId)
          : undefined;
        const offers = await this.options.application.listSupplierOffers(
          context.tenant.tenantId,
          supplierId
        );
        return { status: 200, body: { offers: payload(offers) } };
      })
    );
    registrar.register(
      "POST",
      "/procurement/supplier-offers",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.manageOffer);
        const offer = await this.options.application.createSupplierOffer(
          commandContext(context, request),
          body(createSupplierOfferSchema, request)
        );
        return { status: 201, body: { offer: payload(offer) } };
      })
    );
    registrar.register(
      "PUT",
      "/procurement/supplier-offers/:offerId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.manageOffer);
        const offer = await this.options.application.updateSupplierOffer(
          commandContext(context, request),
          routeUuid(request, "offerId", "SUPPLIER_OFFER_NOT_FOUND"),
          body(updateSupplierOfferSchema, request)
        );
        return { status: 200, body: { offer: payload(offer) } };
      })
    );

    registrar.get(
      "/procurement/purchase-orders",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        const purchaseOrders = await this.options.application.listPurchaseOrders(
          context.tenant.tenantId
        );
        return { status: 200, body: { purchaseOrders: payload(purchaseOrders) } };
      })
    );
    registrar.register(
      "POST",
      "/procurement/purchase-orders",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.createPurchaseOrder);
        const purchaseOrder = await this.options.application.createPurchaseOrder(
          commandContext(context, request),
          body(createPurchaseOrderSchema, request)
        );
        return { status: 201, body: { purchaseOrder: payload(purchaseOrder) } };
      })
    );
    registrar.get(
      "/procurement/purchase-orders/:purchaseOrderId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        const purchaseOrder = await this.options.application.findPurchaseOrder(
          context.tenant.tenantId,
          routeUuid(request, "purchaseOrderId", "PURCHASE_ORDER_NOT_FOUND")
        );
        if (!purchaseOrder)
          throw new ProcurementProblem(
            404,
            "PURCHASE_ORDER_NOT_FOUND",
            "Purchase Order was not found."
          );
        return { status: 200, body: { purchaseOrder: payload(purchaseOrder) } };
      })
    );
    registrar.register(
      "PUT",
      "/procurement/purchase-orders/:purchaseOrderId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.editPurchaseOrder);
        const purchaseOrder = await this.options.application.updatePurchaseOrder(
          commandContext(context, request),
          routeUuid(request, "purchaseOrderId", "PURCHASE_ORDER_NOT_FOUND"),
          body(updatePurchaseOrderSchema, request)
        );
        return { status: 200, body: { purchaseOrder: payload(purchaseOrder) } };
      })
    );
    for (const [action, permission] of [
      ["approve", procurementPermissions.approvePurchaseOrder],
      ["cancel", procurementPermissions.cancelPurchaseOrder],
      ["close", procurementPermissions.closePurchaseOrder]
    ] as const) {
      registrar.register(
        "POST",
        `/procurement/purchase-orders/:purchaseOrderId/${action}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, permission);
          const id = routeUuid(request, "purchaseOrderId", "PURCHASE_ORDER_NOT_FOUND");
          const purchaseOrder =
            action === "approve"
              ? await this.options.application.approvePurchaseOrder(
                  commandContext(context, request),
                  id
                )
              : action === "cancel"
                ? await this.options.application.cancelPurchaseOrder(
                    commandContext(context, request),
                    id
                  )
                : await this.options.application.closePurchaseOrder(
                    commandContext(context, request),
                    id
                  );
          return { status: 200, body: { purchaseOrder: payload(purchaseOrder) } };
        })
      );
    }

    registrar.get(
      "/procurement/goods-receipts",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        const goodsReceipts = await this.options.application.listGoodsReceipts(
          context.tenant.tenantId
        );
        return { status: 200, body: { goodsReceipts: payload(goodsReceipts) } };
      })
    );
    registrar.register(
      "POST",
      "/procurement/goods-receipts",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.createReceipt);
        const goodsReceipt = await this.options.application.createGoodsReceipt(
          commandContext(context, request),
          body(createGoodsReceiptSchema, request)
        );
        return { status: 201, body: { goodsReceipt: payload(goodsReceipt) } };
      })
    );
    registrar.get(
      "/procurement/goods-receipts/:receiptId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.read);
        const goodsReceipt = await this.options.application.findGoodsReceipt(
          context.tenant.tenantId,
          routeUuid(request, "receiptId", "GOODS_RECEIPT_NOT_FOUND")
        );
        if (!goodsReceipt)
          throw new ProcurementProblem(
            404,
            "GOODS_RECEIPT_NOT_FOUND",
            "Goods Receipt was not found."
          );
        return { status: 200, body: { goodsReceipt: payload(goodsReceipt) } };
      })
    );
    registrar.register(
      "PUT",
      "/procurement/goods-receipts/:receiptId",
      this.handle(async (request) => {
        const context = await this.tenant(request, procurementPermissions.editReceipt);
        const goodsReceipt = await this.options.application.updateGoodsReceipt(
          commandContext(context, request),
          routeUuid(request, "receiptId", "GOODS_RECEIPT_NOT_FOUND"),
          body(updateGoodsReceiptSchema, request)
        );
        return { status: 200, body: { goodsReceipt: payload(goodsReceipt) } };
      })
    );
    for (const [action, permission] of [
      ["post", procurementPermissions.postReceipt],
      ["cancel", procurementPermissions.cancelReceipt]
    ] as const) {
      registrar.register(
        "POST",
        `/procurement/goods-receipts/:receiptId/${action}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, permission);
          const id = routeUuid(request, "receiptId", "GOODS_RECEIPT_NOT_FOUND");
          const goodsReceipt =
            action === "post"
              ? await this.options.application.postGoodsReceipt(
                  commandContext(context, request),
                  id
                )
              : await this.options.application.cancelGoodsReceipt(
                  commandContext(context, request),
                  id
                );
          return { status: 200, body: { goodsReceipt: payload(goodsReceipt) } };
        })
      );
    }
  }

  private async tenant(
    request: ApiRequest,
    permission: ProcurementPermission
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
    )
      throw new ProcurementProblem(403, "PERMISSION_DENIED", "Procurement access denied.");
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

export function createProcurementApi(options: ProcurementApiOptions): ProcurementApi {
  return new ProcurementApi(options);
}
