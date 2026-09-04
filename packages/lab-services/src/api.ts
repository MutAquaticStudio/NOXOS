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
import { LabServicesApplication } from "./application.js";
import { labServicesPermissions, type LabServicesPermission } from "./authorization.js";
import {
  cancelServiceOrderSchema,
  createContactSchema,
  createCustomerSchema,
  createInteractionSchema,
  createServiceOrderSchema,
  labUuidSchema,
  replaceServiceOrderLinesSchema,
  updateContactSchema,
  updateCustomerSchema,
  updateServiceOrderSchema
} from "./contracts.js";
import { LabServicesProblem } from "./problem.js";

const MODULE_ID = "lab-services";
const ENTITLEMENT = "module.lab-services";

export type LabServicesApiOptions = {
  application: LabServicesApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
};

function routeUuid(request: ApiRequest, name: string, code: ErrorCode): string {
  const parsed = labUuidSchema.safeParse(request.params?.[name]);
  if (!parsed.success)
    throw new LabServicesProblem(404, code as never, "Route identity is invalid.");
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

function payload(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(payload);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, payload(item)]));
  return value;
}

export class LabServicesApi {
  constructor(private readonly options: LabServicesApiOptions) {}

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/lab-services/customers",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.read);
        return {
          status: 200,
          body: {
            customers: payload(
              await this.options.application.listCustomers(context.tenant.tenantId)
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/lab-services/customers",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.manageCustomer);
        const customer = await this.options.application.createCustomer(
          commandContext(context, request),
          body(createCustomerSchema, request)
        );
        return { status: 201, body: { customer: payload(customer) } };
      })
    );
    registrar.get(
      "/lab-services/customers/:customerId",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.read);
        const customerId = routeUuid(request, "customerId", "LAB_CUSTOMER_NOT_FOUND");
        const customer = await this.options.application.findCustomer(
          context.tenant.tenantId,
          customerId
        );
        if (!customer)
          throw new LabServicesProblem(404, "LAB_CUSTOMER_NOT_FOUND", "Customer was not found.");
        const [contacts, interactions] = await Promise.all([
          this.options.application.listContacts(context.tenant.tenantId, customerId),
          this.options.application.listInteractions(context.tenant.tenantId, customerId)
        ]);
        const serviceOrders = (
          await this.options.application.listServiceOrders(context.tenant.tenantId)
        ).filter((order) => order.customerId === customerId);
        return {
          status: 200,
          body: {
            customer: payload(customer),
            contacts: payload(contacts),
            interactions: payload(interactions),
            serviceOrders: payload(serviceOrders)
          }
        };
      })
    );
    registrar.register(
      "PUT",
      "/lab-services/customers/:customerId",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.manageCustomer);
        const customer = await this.options.application.updateCustomer(
          commandContext(context, request),
          routeUuid(request, "customerId", "LAB_CUSTOMER_NOT_FOUND"),
          body(updateCustomerSchema, request)
        );
        return { status: 200, body: { customer: payload(customer) } };
      })
    );
    for (const [action, permission] of [
      ["activate", labServicesPermissions.manageCustomer],
      ["hold", labServicesPermissions.manageCustomer],
      ["archive", labServicesPermissions.manageCustomer]
    ] as const) {
      registrar.register(
        "POST",
        `/lab-services/customers/:customerId/${action}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, permission);
          const customerId = routeUuid(request, "customerId", "LAB_CUSTOMER_NOT_FOUND");
          const customer =
            action === "activate"
              ? await this.options.application.activateCustomer(
                  commandContext(context, request),
                  customerId
                )
              : action === "hold"
                ? await this.options.application.holdCustomer(
                    commandContext(context, request),
                    customerId
                  )
                : await this.options.application.archiveCustomer(
                    commandContext(context, request),
                    customerId
                  );
          return { status: 200, body: { customer: payload(customer) } };
        })
      );
    }

    registrar.register(
      "POST",
      "/lab-services/customers/:customerId/contacts",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.manageContact);
        const contact = await this.options.application.createContact(
          commandContext(context, request),
          routeUuid(request, "customerId", "LAB_CUSTOMER_NOT_FOUND"),
          body(createContactSchema, request)
        );
        return { status: 201, body: { contact: payload(contact) } };
      })
    );
    registrar.register(
      "PUT",
      "/lab-services/contacts/:contactId",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.manageContact);
        const contact = await this.options.application.updateContact(
          commandContext(context, request),
          routeUuid(request, "contactId", "LAB_CONTACT_NOT_FOUND"),
          body(updateContactSchema, request)
        );
        return { status: 200, body: { contact: payload(contact) } };
      })
    );
    for (const action of ["archive", "make-primary"] as const) {
      registrar.register(
        "POST",
        `/lab-services/contacts/:contactId/${action}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, labServicesPermissions.manageContact);
          const contactId = routeUuid(request, "contactId", "LAB_CONTACT_NOT_FOUND");
          const contact =
            action === "archive"
              ? await this.options.application.archiveContact(
                  commandContext(context, request),
                  contactId
                )
              : await this.options.application.makePrimaryContact(
                  commandContext(context, request),
                  contactId
                );
          return { status: 200, body: { contact: payload(contact) } };
        })
      );
    }

    registrar.get(
      "/lab-services/service-orders",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.read);
        return {
          status: 200,
          body: {
            serviceOrders: payload(
              await this.options.application.listServiceOrders(context.tenant.tenantId)
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/lab-services/service-orders",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.createServiceOrder);
        const order = await this.options.application.createServiceOrder(
          commandContext(context, request),
          body(createServiceOrderSchema, request)
        );
        return { status: 201, body: { serviceOrder: payload(order) } };
      })
    );
    registrar.get(
      "/lab-services/service-orders/:serviceOrderId",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.read);
        const order = await this.options.application.findServiceOrder(
          context.tenant.tenantId,
          routeUuid(request, "serviceOrderId", "LAB_SERVICE_ORDER_NOT_FOUND")
        );
        if (!order)
          throw new LabServicesProblem(
            404,
            "LAB_SERVICE_ORDER_NOT_FOUND",
            "Service Order was not found."
          );
        return { status: 200, body: { serviceOrder: payload(order) } };
      })
    );
    registrar.register(
      "PUT",
      "/lab-services/service-orders/:serviceOrderId",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.editServiceOrder);
        const order = await this.options.application.updateServiceOrder(
          commandContext(context, request),
          routeUuid(request, "serviceOrderId", "LAB_SERVICE_ORDER_NOT_FOUND"),
          body(updateServiceOrderSchema, request)
        );
        return { status: 200, body: { serviceOrder: payload(order) } };
      })
    );
    registrar.register(
      "PUT",
      "/lab-services/service-orders/:serviceOrderId/lines",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.editServiceOrder);
        const input = body(replaceServiceOrderLinesSchema, request);
        const order = await this.options.application.replaceServiceOrderLines(
          commandContext(context, request),
          routeUuid(request, "serviceOrderId", "LAB_SERVICE_ORDER_NOT_FOUND"),
          input.lines
        );
        return { status: 200, body: { serviceOrder: payload(order) } };
      })
    );
    for (const [action, permission] of [
      ["confirm", labServicesPermissions.confirmServiceOrder],
      ["start", labServicesPermissions.startServiceOrder],
      ["complete", labServicesPermissions.completeServiceOrder],
      ["cancel", labServicesPermissions.cancelServiceOrder]
    ] as const) {
      registrar.register(
        "POST",
        `/lab-services/service-orders/:serviceOrderId/${action}`,
        this.handle(async (request) => {
          const context = await this.tenant(request, permission);
          const serviceOrderId = routeUuid(
            request,
            "serviceOrderId",
            "LAB_SERVICE_ORDER_NOT_FOUND"
          );
          const order =
            action === "confirm"
              ? await this.options.application.confirmServiceOrder(
                  commandContext(context, request),
                  serviceOrderId
                )
              : action === "start"
                ? await this.options.application.startServiceOrder(
                    commandContext(context, request),
                    serviceOrderId
                  )
                : action === "complete"
                  ? await this.options.application.completeServiceOrder(
                      commandContext(context, request),
                      serviceOrderId
                    )
                  : await this.options.application.cancelServiceOrder(
                      commandContext(context, request),
                      serviceOrderId,
                      body(cancelServiceOrderSchema, request).reason
                    );
          return { status: 200, body: { serviceOrder: payload(order) } };
        })
      );
    }

    registrar.get(
      "/lab-services/customers/:customerId/interactions",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.read);
        const customerId = routeUuid(request, "customerId", "LAB_CUSTOMER_NOT_FOUND");
        return {
          status: 200,
          body: {
            interactions: payload(
              await this.options.application.listInteractions(context.tenant.tenantId, customerId)
            )
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/lab-services/customers/:customerId/interactions",
      this.handle(async (request) => {
        const context = await this.tenant(request, labServicesPermissions.createInteraction);
        const interaction = await this.options.application.createInteraction(
          commandContext(context, request),
          routeUuid(request, "customerId", "LAB_CUSTOMER_NOT_FOUND"),
          body(createInteractionSchema, request)
        );
        return { status: 201, body: { interaction: payload(interaction) } };
      })
    );
  }

  private async tenant(
    request: ApiRequest,
    permission: LabServicesPermission
  ): Promise<TenantRequestContext> {
    const context = await this.options.authorization.tenantContext(request);
    const definition = this.options.definitions.find((item) => item.descriptor.id === MODULE_ID);
    if (
      !definition ||
      ["DISABLED", "DEPRECATED"].includes(definition.descriptor.lifecycle) ||
      !this.options.featureFlags.isEnabled(definition.descriptor.featureFlag) ||
      !context.entitlements.includes(ENTITLEMENT) ||
      !context.authorization.modulePermissions.includes(permission)
    )
      throw new LabServicesProblem(403, "PERMISSION_DENIED", "Lab Services access denied.");
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

export function createLabServicesApi(options: LabServicesApiOptions): LabServicesApi {
  return new LabServicesApi(options);
}
