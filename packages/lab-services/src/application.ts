import type {
  CreateContactRequest,
  CreateCustomerRequest,
  CreateInteractionRequest,
  CreateServiceOrderRequest,
  LabServicesCommandContext,
  ServiceOrderLineInput,
  UpdateContactRequest,
  UpdateCustomerRequest,
  UpdateServiceOrderRequest
} from "./contracts.js";
import type { LabServicesStore } from "./persistence.js";

export class LabServicesApplication {
  constructor(readonly store: LabServicesStore) {}

  listCustomers(tenantId: string) {
    return this.store.listCustomers(tenantId);
  }
  findCustomer(tenantId: string, customerId: string) {
    return this.store.findCustomer(tenantId, customerId);
  }
  createCustomer(context: LabServicesCommandContext, input: CreateCustomerRequest) {
    return this.store.createCustomer({ ...context, ...input });
  }
  updateCustomer(
    context: LabServicesCommandContext,
    customerId: string,
    changes: UpdateCustomerRequest
  ) {
    return this.store.updateCustomer({ ...context, customerId, changes });
  }
  activateCustomer(context: LabServicesCommandContext, customerId: string) {
    return this.store.activateCustomer({ ...context, customerId });
  }
  holdCustomer(context: LabServicesCommandContext, customerId: string) {
    return this.store.holdCustomer({ ...context, customerId });
  }
  archiveCustomer(context: LabServicesCommandContext, customerId: string) {
    return this.store.archiveCustomer({ ...context, customerId });
  }

  listContacts(tenantId: string, customerId: string) {
    return this.store.listContacts(tenantId, customerId);
  }
  createContact(
    context: LabServicesCommandContext,
    customerId: string,
    input: CreateContactRequest
  ) {
    return this.store.createContact({ ...context, customerId, ...input });
  }
  updateContact(
    context: LabServicesCommandContext,
    contactId: string,
    changes: UpdateContactRequest
  ) {
    return this.store.updateContact({ ...context, contactId, changes });
  }
  archiveContact(context: LabServicesCommandContext, contactId: string) {
    return this.store.archiveContact({ ...context, contactId });
  }
  makePrimaryContact(context: LabServicesCommandContext, contactId: string) {
    return this.store.makePrimaryContact({ ...context, contactId });
  }

  listServiceOrders(tenantId: string) {
    return this.store.listServiceOrders(tenantId);
  }
  findServiceOrder(tenantId: string, serviceOrderId: string) {
    return this.store.findServiceOrder(tenantId, serviceOrderId);
  }
  createServiceOrder(context: LabServicesCommandContext, input: CreateServiceOrderRequest) {
    return this.store.createServiceOrder({ ...context, ...input });
  }
  updateServiceOrder(
    context: LabServicesCommandContext,
    serviceOrderId: string,
    changes: UpdateServiceOrderRequest
  ) {
    return this.store.updateServiceOrder({ ...context, serviceOrderId, changes });
  }
  replaceServiceOrderLines(
    context: LabServicesCommandContext,
    serviceOrderId: string,
    lines: readonly ServiceOrderLineInput[]
  ) {
    return this.store.replaceServiceOrderLines({ ...context, serviceOrderId, lines });
  }
  confirmServiceOrder(context: LabServicesCommandContext, serviceOrderId: string) {
    return this.store.confirmServiceOrder({ ...context, serviceOrderId });
  }
  startServiceOrder(context: LabServicesCommandContext, serviceOrderId: string) {
    return this.store.startServiceOrder({ ...context, serviceOrderId });
  }
  completeServiceOrder(context: LabServicesCommandContext, serviceOrderId: string) {
    return this.store.completeServiceOrder({ ...context, serviceOrderId });
  }
  cancelServiceOrder(
    context: LabServicesCommandContext,
    serviceOrderId: string,
    reason?: string | null
  ) {
    return this.store.cancelServiceOrder({ ...context, serviceOrderId, reason });
  }

  listInteractions(tenantId: string, customerId: string) {
    return this.store.listInteractions(tenantId, customerId);
  }
  createInteraction(
    context: LabServicesCommandContext,
    customerId: string,
    input: CreateInteractionRequest
  ) {
    return this.store.createInteraction({ ...context, customerId, ...input });
  }
}
