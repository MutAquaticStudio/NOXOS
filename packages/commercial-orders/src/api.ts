import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import { commercialOrdersPermissions } from "./authorization.js";
import {
  allocationSchema,
  commercialUuidSchema,
  createFulfillmentSchema,
  createOrderSchema,
  createQuoteSchema,
  createShipmentSchema,
  fulfillmentLinesSchema,
  reasonSchema,
  updateFulfillmentSchema,
  updateOrderSchema,
  updateQuoteSchema,
  updateShipmentSchema
} from "./contracts.js";
import { CommercialOrdersProblem } from "./problem.js";
import type { CommercialOrdersStore } from "./persistence.js";

const moduleId = "commercial-orders";
const entitlement = "module.commercial-orders";
type Permission = (typeof commercialOrdersPermissions)[keyof typeof commercialOrdersPermissions];
const id = (request: ApiRequest, name: string) => {
  const value = request.params?.[name];
  if (!commercialUuidSchema.safeParse(value).success)
    throw new CommercialOrdersProblem(
      404,
      "COMMERCIAL_ORDER_NOT_FOUND",
      "Route identity is invalid."
    );
  return value!;
};
const context = (c: TenantRequestContext, r: ApiRequest) => ({
  tenantId: c.tenant.tenantId,
  actorUserId: c.actor.userId,
  requestId: r.context.requestId,
  correlationId: r.context.correlationId
});
const json = (value: any): any =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(json)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]))
        : value;

export class CommercialOrdersApi {
  constructor(
    private readonly options: {
      store: CommercialOrdersStore;
      authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
      definitions: readonly ModuleDefinition[];
      featureFlags: FeatureFlagResolver;
    }
  ) {}
  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/commercial-orders/quotes",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        return {
          status: 200,
          body: { quotes: json(await this.options.store.listQuotes(c.tenant.tenantId)) }
        };
      })
    );
    registrar.register(
      "POST",
      "/commercial-orders/quotes",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.quoteCreate);
        return {
          status: 201,
          body: {
            quote: json(
              await this.options.store.createQuote({
                ...context(c, r),
                ...createQuoteSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/commercial-orders/quotes/:quoteId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        const value = await this.options.store.findQuote(c.tenant.tenantId, id(r, "quoteId"));
        if (!value)
          throw new CommercialOrdersProblem(
            404,
            "COMMERCIAL_QUOTE_NOT_FOUND",
            "Quote was not found."
          );
        return { status: 200, body: json(value) };
      })
    );
    registrar.register(
      "PUT",
      "/commercial-orders/quotes/:quoteId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.quoteEdit);
        return {
          status: 200,
          body: {
            quote: json(
              await this.options.store.updateQuote({
                ...context(c, r),
                quoteId: id(r, "quoteId"),
                changes: updateQuoteSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    for (const [action, permission] of [
      ["issue", commercialOrdersPermissions.quoteIssue],
      ["accept", commercialOrdersPermissions.quoteAccept],
      ["decline", commercialOrdersPermissions.quoteDecline],
      ["cancel", commercialOrdersPermissions.quoteCancel]
    ] as const)
      registrar.register(
        "POST",
        `/commercial-orders/quotes/:quoteId/${action}`,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          const input = { ...context(c, r), quoteId: id(r, "quoteId") };
          const quote =
            action === "issue"
              ? await this.options.store.issueQuote(input)
              : action === "accept"
                ? await this.options.store.acceptQuote(input)
                : action === "decline"
                  ? await this.options.store.declineQuote(input)
                  : await this.options.store.cancelQuote(input);
          return { status: 200, body: { quote: json(quote) } };
        })
      );
    registrar.register(
      "POST",
      "/commercial-orders/quotes/:quoteId/revise",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.quoteRevise);
        const quoteNumber = z
          .object({ quoteNumber: z.string().trim().min(1).max(80) })
          .parse(r.body).quoteNumber;
        return {
          status: 201,
          body: {
            quote: json(
              await this.options.store.reviseQuote({
                ...context(c, r),
                quoteId: id(r, "quoteId"),
                quoteNumber
              })
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/commercial-orders/quotes/:quoteId/create-order",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.orderCreate);
        const orderNumber = z
          .object({ orderNumber: z.string().trim().min(1).max(80) })
          .parse(r.body).orderNumber;
        return {
          status: 201,
          body: {
            order: json(
              await this.options.store.createOrderFromQuote({
                ...context(c, r),
                quoteId: id(r, "quoteId"),
                orderNumber
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/commercial-orders",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        return {
          status: 200,
          body: { orders: json(await this.options.store.listOrders(c.tenant.tenantId)) }
        };
      })
    );
    registrar.register(
      "POST",
      "/commercial-orders/orders",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.orderCreate);
        return {
          status: 201,
          body: {
            order: json(
              await this.options.store.createOrder({
                ...context(c, r),
                ...createOrderSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/commercial-orders/orders/:orderId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        const value = await this.options.store.findOrder(c.tenant.tenantId, id(r, "orderId"));
        if (!value)
          throw new CommercialOrdersProblem(
            404,
            "COMMERCIAL_ORDER_NOT_FOUND",
            "Order was not found."
          );
        return { status: 200, body: json(value) };
      })
    );
    registrar.register(
      "PUT",
      "/commercial-orders/orders/:orderId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.orderEdit);
        return {
          status: 200,
          body: {
            order: json(
              await this.options.store.updateOrder({
                ...context(c, r),
                orderId: id(r, "orderId"),
                changes: updateOrderSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    for (const [action, permission] of [
      ["confirm", commercialOrdersPermissions.orderConfirm],
      ["cancel", commercialOrdersPermissions.orderCancel],
      ["close", commercialOrdersPermissions.orderClose]
    ] as const)
      registrar.register(
        "POST",
        `/commercial-orders/orders/:orderId/${action}`,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          const base = { ...context(c, r), orderId: id(r, "orderId") };
          const order =
            action === "confirm"
              ? await this.options.store.confirmOrder(base)
              : action === "close"
                ? await this.options.store.closeOrder(base)
                : await this.options.store.cancelOrder({ ...base, ...reasonSchema.parse(r.body) });
          return { status: 200, body: { order: json(order) } };
        })
      );
    registrar.get(
      "/commercial-orders/orders/:orderId/allocations",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        return {
          status: 200,
          body: {
            allocations: json(
              await this.options.store.listAllocations(c.tenant.tenantId, id(r, "orderId"))
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/commercial-orders/orders/:orderId/allocations",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.allocationManage);
        return {
          status: 201,
          body: {
            allocation: json(
              await this.options.store.createAllocation({
                ...context(c, r),
                orderId: id(r, "orderId"),
                ...allocationSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/commercial-orders/allocations/:allocationId/release",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.allocationManage);
        return {
          status: 200,
          body: {
            allocation: json(
              await this.options.store.releaseAllocation({
                ...context(c, r),
                allocationId: id(r, "allocationId")
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/commercial-orders/orders/:orderId/fulfillments",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        return {
          status: 200,
          body: {
            fulfillments: json(
              await this.options.store.listFulfillments(c.tenant.tenantId, id(r, "orderId"))
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/commercial-orders/orders/:orderId/fulfillments",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.fulfillmentCreate);
        return {
          status: 201,
          body: {
            fulfillment: json(
              await this.options.store.createFulfillment({
                ...context(c, r),
                orderId: id(r, "orderId"),
                ...createFulfillmentSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/commercial-orders/fulfillments/:fulfillmentId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        const value = await this.options.store.findFulfillment(
          c.tenant.tenantId,
          id(r, "fulfillmentId")
        );
        if (!value)
          throw new CommercialOrdersProblem(
            404,
            "COMMERCIAL_FULFILLMENT_NOT_FOUND",
            "Fulfillment was not found."
          );
        return { status: 200, body: json(value) };
      })
    );
    registrar.register(
      "PUT",
      "/commercial-orders/fulfillments/:fulfillmentId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.fulfillmentEdit);
        return {
          status: 200,
          body: {
            fulfillment: json(
              await this.options.store.updateFulfillment({
                ...context(c, r),
                fulfillmentId: id(r, "fulfillmentId"),
                ...updateFulfillmentSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    registrar.register(
      "PUT",
      "/commercial-orders/fulfillments/:fulfillmentId/lines",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.fulfillmentEdit);
        return {
          status: 200,
          body: {
            lines: json(
              await this.options.store.replaceFulfillmentLines({
                ...context(c, r),
                fulfillmentId: id(r, "fulfillmentId"),
                ...fulfillmentLinesSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    for (const [action, permission] of [
      ["confirm", commercialOrdersPermissions.fulfillmentConfirm],
      ["cancel", commercialOrdersPermissions.fulfillmentCancel]
    ] as const)
      registrar.register(
        "POST",
        `/commercial-orders/fulfillments/:fulfillmentId/${action}`,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          const base = { ...context(c, r), fulfillmentId: id(r, "fulfillmentId") };
          const fulfillment =
            action === "confirm"
              ? await this.options.store.confirmFulfillment(base)
              : await this.options.store.cancelFulfillment({
                  ...base,
                  ...reasonSchema.parse(r.body)
                });
          return { status: 200, body: { fulfillment: json(fulfillment) } };
        })
      );
    registrar.register(
      "POST",
      "/commercial-orders/fulfillments/:fulfillmentId/shipment",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.shipmentCreate);
        return {
          status: 201,
          body: {
            shipment: json(
              await this.options.store.createShipment({
                ...context(c, r),
                fulfillmentId: id(r, "fulfillmentId"),
                ...createShipmentSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/commercial-orders/shipments/:shipmentId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.read);
        const value = await this.options.store.findShipment(c.tenant.tenantId, id(r, "shipmentId"));
        if (!value)
          throw new CommercialOrdersProblem(
            404,
            "COMMERCIAL_SHIPMENT_NOT_FOUND",
            "Shipment was not found."
          );
        return { status: 200, body: { shipment: json(value) } };
      })
    );
    registrar.register(
      "PUT",
      "/commercial-orders/shipments/:shipmentId",
      this.handle(async (r) => {
        const c = await this.tenant(r, commercialOrdersPermissions.shipmentEdit);
        return {
          status: 200,
          body: {
            shipment: json(
              await this.options.store.updateShipment({
                ...context(c, r),
                shipmentId: id(r, "shipmentId"),
                changes: updateShipmentSchema.parse(r.body)
              })
            )
          }
        };
      })
    );
    for (const [action, permission] of [
      ["ship", commercialOrdersPermissions.shipmentShip],
      ["deliver", commercialOrdersPermissions.shipmentDeliver],
      ["cancel", commercialOrdersPermissions.shipmentCancel]
    ] as const)
      registrar.register(
        "POST",
        `/commercial-orders/shipments/:shipmentId/${action}`,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          const base = { ...context(c, r), shipmentId: id(r, "shipmentId") };
          const shipment =
            action === "ship"
              ? await this.options.store.shipShipment(base)
              : action === "deliver"
                ? await this.options.store.deliverShipment(base)
                : await this.options.store.cancelShipment({
                    ...base,
                    ...reasonSchema.parse(r.body)
                  });
          return { status: 200, body: { shipment: json(shipment) } };
        })
      );
  }
  private async tenant(request: ApiRequest, permission: Permission): Promise<TenantRequestContext> {
    const c = await this.options.authorization.tenantContext(request);
    const d = this.options.definitions.find((x) => x.descriptor.id === moduleId);
    if (
      !d ||
      d.descriptor.lifecycle !== "ACTIVE" ||
      !this.options.featureFlags.isEnabled(d.descriptor.featureFlag) ||
      !c.entitlements.includes(entitlement) ||
      !c.authorization.modulePermissions.includes(permission)
    )
      throw new CommercialOrdersProblem(
        403,
        "PERMISSION_DENIED",
        "Commercial Orders access denied."
      );
    return c;
  }
  private handle(fn: (request: ApiRequest) => Promise<ApiResponse>) {
    return async (request: ApiRequest) => {
      try {
        return await fn(request);
      } catch (error) {
        if (error instanceof CommercialOrdersProblem)
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
        if ((error as { code?: string } | undefined)?.code === "23505")
          return {
            status: 409,
            body: {
              error: {
                code: "IDEMPOTENCY_CONFLICT",
                message: "The requested commercial identity already exists.",
                requestId: request.context.requestId
              }
            }
          };
        throw error;
      }
    };
  }
}
export const createCommercialOrdersApi = (
  options: ConstructorParameters<typeof CommercialOrdersApi>[0]
) => new CommercialOrdersApi(options);
