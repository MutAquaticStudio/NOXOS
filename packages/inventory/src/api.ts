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
import { InventoryApplication } from "./application.js";
import { inventoryPermissions, type InventoryPermission } from "./authorization.js";
import {
  createLocationSchema,
  createLotSchema,
  createReservationSchema,
  quantityMgSchema,
  reservationTransitionSchema,
  updateLocationSchema,
  updateLotSchema,
  type InventoryLocation,
  type MaterialLot,
  type StockMovement,
  type StockReservation
} from "./contracts.js";
import { InventoryProblem } from "./problem.js";

const MODULE_ID = "inventory";
const ENTITLEMENT = "module.inventory";
const uuid = z.string().uuid();
const operationKey = z.string().trim().min(1).max(240);
const reasonCode = z.string().trim().max(120).nullable().optional();
const inboundSchema = z
  .object({
    quantityMg: quantityMgSchema,
    toLocationId: uuid,
    reasonCode,
    operationKey
  })
  .strict();
const outboundSchema = z
  .object({
    quantityMg: quantityMgSchema,
    fromLocationId: uuid,
    reasonCode,
    operationKey
  })
  .strict();
const transferSchema = z
  .object({
    quantityMg: quantityMgSchema,
    fromLocationId: uuid,
    toLocationId: uuid,
    reasonCode,
    operationKey
  })
  .strict();
const adjustmentSchema = z
  .object({
    direction: z.enum(["IN", "OUT"]),
    quantityMg: quantityMgSchema,
    locationId: uuid,
    reasonCode,
    operationKey
  })
  .strict();

export type InventoryApiOptions = {
  application: InventoryApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
};

function routeUuid(
  request: ApiRequest,
  name: string,
  code: "LOT_NOT_FOUND" | "LOCATION_NOT_FOUND" | "RESERVATION_NOT_FOUND"
): string {
  const parsed = uuid.safeParse(request.params?.[name]);
  if (!parsed.success) throw new InventoryProblem(404, code, "Route identity is invalid.");
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

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function locationPayload(value: InventoryLocation) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString()
  };
}

function lotPayload(value: MaterialLot) {
  return {
    ...value,
    manufacturedAt: iso(value.manufacturedAt),
    expiresAt: iso(value.expiresAt),
    retestAt: iso(value.retestAt),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    lastMovementAt: iso(value.lastMovementAt),
    closedAt: iso(value.closedAt)
  };
}

function movementPayload(value: StockMovement) {
  return { ...value, createdAt: value.createdAt.toISOString() };
}

function reservationPayload(value: StockReservation) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    releasedAt: iso(value.releasedAt),
    consumedAt: iso(value.consumedAt),
    cancelledAt: iso(value.cancelledAt)
  };
}

export class InventoryApi {
  constructor(private readonly options: InventoryApiOptions) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/inventory",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.read);
        const lots = await this.options.application.listLots(context.tenant.tenantId);
        return { status: 200, body: { lots: lots.map(lotPayload) } };
      })
    );
    registrar.get(
      "/inventory/locations",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.read);
        const locations = await this.options.application.listLocations(context.tenant.tenantId);
        return { status: 200, body: { locations: locations.map(locationPayload) } };
      })
    );
    registrar.register(
      "POST",
      "/inventory/locations",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.manageLocation);
        const value = await this.options.application.createLocation(
          commandContext(context, request),
          body(createLocationSchema, request)
        );
        return { status: 201, body: { location: locationPayload(value) } };
      })
    );
    registrar.register(
      "PUT",
      "/inventory/locations/:locationId",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.manageLocation);
        const value = await this.options.application.updateLocation(
          commandContext(context, request),
          routeUuid(request, "locationId", "LOCATION_NOT_FOUND"),
          body(updateLocationSchema, request)
        );
        return { status: 200, body: { location: locationPayload(value) } };
      })
    );
    registrar.register(
      "POST",
      "/inventory/locations/:locationId/archive",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.manageLocation);
        const value = await this.options.application.archiveLocation(
          commandContext(context, request),
          routeUuid(request, "locationId", "LOCATION_NOT_FOUND")
        );
        return { status: 200, body: { location: locationPayload(value) } };
      })
    );

    registrar.get(
      "/inventory/lots",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.read);
        const lots = await this.options.application.listLots(context.tenant.tenantId);
        return { status: 200, body: { lots: lots.map(lotPayload) } };
      })
    );
    registrar.register(
      "POST",
      "/inventory/lots",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.createLot);
        const lot = await this.options.application.createLot(
          commandContext(context, request),
          body(createLotSchema, request)
        );
        return { status: 201, body: { lot: lotPayload(lot) } };
      })
    );
    registrar.get(
      "/inventory/lots/:lotId",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.read);
        const lotId = routeUuid(request, "lotId", "LOT_NOT_FOUND");
        const [lot, movements, reservations] = await Promise.all([
          this.options.application.requireLot(context.tenant.tenantId, lotId),
          this.options.application.listLotMovements(context.tenant.tenantId, lotId),
          this.options.application.listLotReservations(context.tenant.tenantId, lotId)
        ]);
        return {
          status: 200,
          body: {
            lot: lotPayload(lot),
            movements: movements.map(movementPayload),
            reservations: reservations.map(reservationPayload)
          }
        };
      })
    );
    registrar.register(
      "PUT",
      "/inventory/lots/:lotId",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.manageLot);
        const lot = await this.options.application.updateLot(
          commandContext(context, request),
          routeUuid(request, "lotId", "LOT_NOT_FOUND"),
          body(updateLotSchema, request)
        );
        return { status: 200, body: { lot: lotPayload(lot) } };
      })
    );
    this.lotStateRoutes(registrar);
    this.movementRoutes(registrar);
    this.reservationRoutes(registrar);

    registrar.get(
      "/inventory/trials/:trialId/trace",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.read);
        const trace = await this.options.application.traceTrial(
          context.tenant.tenantId,
          routeUuid(request, "trialId", "LOT_NOT_FOUND")
        );
        return {
          status: 200,
          body: { trace: { ...trace, movements: trace.movements.map(movementPayload) } }
        };
      })
    );
  }

  private lotStateRoutes(registrar: ApiRouteRegistrar): void {
    for (const [path, hold] of [
      ["hold", true],
      ["release-hold", false]
    ] as const) {
      registrar.register(
        "POST",
        `/inventory/lots/:lotId/${path}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, inventoryPermissions.manageLot);
          const lot = await this.options.application.setLotHold(
            commandContext(context, request),
            routeUuid(request, "lotId", "LOT_NOT_FOUND"),
            hold
          );
          return { status: 200, body: { lot: lotPayload(lot) } };
        })
      );
    }
    registrar.register(
      "POST",
      "/inventory/lots/:lotId/close",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.manageLot);
        const lot = await this.options.application.closeLot(
          commandContext(context, request),
          routeUuid(request, "lotId", "LOT_NOT_FOUND")
        );
        return { status: 200, body: { lot: lotPayload(lot) } };
      })
    );
  }

  private movementRoutes(registrar: ApiRouteRegistrar): void {
    const add = (
      path: string,
      permission: InventoryPermission,
      movementType: "RECEIPT" | "RETURN_IN" | "TRANSFER" | "CONSUMPTION" | "DISPOSAL",
      schema: z.ZodTypeAny,
      map: (value: any) => any
    ) => {
      registrar.register(
        "POST",
        `/inventory/lots/:lotId/${path}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, permission);
          const value = schema.parse(request.body);
          const movement = await this.options.application.createMovement(
            commandContext(context, request),
            routeUuid(request, "lotId", "LOT_NOT_FOUND"),
            { movementType, ...map(value) }
          );
          return { status: 201, body: { movement: movementPayload(movement) } };
        })
      );
    };
    add("receive", inventoryPermissions.receive, "RECEIPT", inboundSchema, (value) => ({
      ...value,
      fromLocationId: null
    }));
    add("return", inventoryPermissions.receive, "RETURN_IN", inboundSchema, (value) => ({
      ...value,
      fromLocationId: null
    }));
    add("transfer", inventoryPermissions.transfer, "TRANSFER", transferSchema, (value) => value);
    add("consume", inventoryPermissions.consume, "CONSUMPTION", outboundSchema, (value) => ({
      ...value,
      toLocationId: null
    }));
    add("dispose", inventoryPermissions.dispose, "DISPOSAL", outboundSchema, (value) => ({
      ...value,
      toLocationId: null
    }));
    registrar.register(
      "POST",
      "/inventory/lots/:lotId/adjust",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.adjust);
        const value = adjustmentSchema.parse(request.body);
        const inbound = value.direction === "IN";
        const movement = await this.options.application.createMovement(
          commandContext(context, request),
          routeUuid(request, "lotId", "LOT_NOT_FOUND"),
          {
            movementType: inbound ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
            quantityMg: value.quantityMg,
            fromLocationId: inbound ? null : value.locationId,
            toLocationId: inbound ? value.locationId : null,
            reasonCode: value.reasonCode ?? null,
            operationKey: value.operationKey
          }
        );
        return { status: 201, body: { movement: movementPayload(movement) } };
      })
    );
  }

  private reservationRoutes(registrar: ApiRouteRegistrar): void {
    registrar.register(
      "POST",
      "/inventory/lots/:lotId/reservations",
      this.handle(async (request) => {
        const context = await this.tenant(request, inventoryPermissions.manageReservation);
        const reservation = await this.options.application.createReservation(
          commandContext(context, request),
          routeUuid(request, "lotId", "LOT_NOT_FOUND"),
          body(createReservationSchema, request)
        );
        return { status: 201, body: { reservation: reservationPayload(reservation) } };
      })
    );
    for (const [path, transition] of [
      ["release", "RELEASED"],
      ["cancel", "CANCELLED"],
      ["consume", "CONSUMED"]
    ] as const) {
      registrar.register(
        "POST",
        `/inventory/reservations/:reservationId/${path}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, inventoryPermissions.manageReservation);
          const value = body(reservationTransitionSchema, request);
          const reservation = await this.options.application.transitionReservation(
            commandContext(context, request),
            routeUuid(request, "reservationId", "RESERVATION_NOT_FOUND"),
            transition,
            value.operationKey
          );
          return { status: 200, body: { reservation: reservationPayload(reservation) } };
        })
      );
    }
  }

  private async tenant(
    request: ApiRequest,
    permission: InventoryPermission
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
      throw new InventoryProblem(403, "PERMISSION_DENIED", "Inventory access denied.");
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

export function createInventoryApi(options: InventoryApiOptions): InventoryApi {
  return new InventoryApi(options);
}
