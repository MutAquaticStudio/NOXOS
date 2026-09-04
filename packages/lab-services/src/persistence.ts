import type {
  CreateContactRequest,
  CreateCustomerRequest,
  CreateInteractionRequest,
  CreateServiceOrderRequest,
  Customer,
  CustomerContact,
  CustomerDirectoryProjection,
  CustomerInteraction,
  CustomerRegistryEntry,
  LabServiceOrderProjection,
  LabServicesCommandContext,
  ServiceOrder,
  ServiceOrderLineInput,
  UpdateContactRequest,
  UpdateCustomerRequest,
  UpdateServiceOrderRequest
} from "./contracts.js";

export interface LabServiceOrderSource {
  findConfirmedServiceOrder(
    tenantId: string,
    serviceOrderId: string
  ): Promise<LabServiceOrderProjection | undefined>;
}

export interface CustomerDirectorySource {
  findCustomerDirectoryEntry(
    tenantId: string,
    customerId: string
  ): Promise<CustomerDirectoryProjection | undefined>;
}

export interface LabServicesStore extends LabServiceOrderSource, CustomerDirectorySource {
  listCustomers(tenantId: string): Promise<CustomerRegistryEntry[]>;
  findCustomer(tenantId: string, customerId: string): Promise<Customer | undefined>;
  createCustomer(input: LabServicesCommandContext & CreateCustomerRequest): Promise<Customer>;
  updateCustomer(
    input: LabServicesCommandContext & { customerId: string; changes: UpdateCustomerRequest }
  ): Promise<Customer>;
  activateCustomer(input: LabServicesCommandContext & { customerId: string }): Promise<Customer>;
  holdCustomer(input: LabServicesCommandContext & { customerId: string }): Promise<Customer>;
  archiveCustomer(input: LabServicesCommandContext & { customerId: string }): Promise<Customer>;

  listContacts(tenantId: string, customerId: string): Promise<CustomerContact[]>;
  createContact(
    input: LabServicesCommandContext & { customerId: string } & CreateContactRequest
  ): Promise<CustomerContact>;
  updateContact(
    input: LabServicesCommandContext & { contactId: string; changes: UpdateContactRequest }
  ): Promise<CustomerContact>;
  archiveContact(
    input: LabServicesCommandContext & { contactId: string }
  ): Promise<CustomerContact>;
  makePrimaryContact(
    input: LabServicesCommandContext & { contactId: string }
  ): Promise<CustomerContact>;

  listServiceOrders(tenantId: string): Promise<ServiceOrder[]>;
  findServiceOrder(tenantId: string, serviceOrderId: string): Promise<ServiceOrder | undefined>;
  createServiceOrder(
    input: LabServicesCommandContext & CreateServiceOrderRequest
  ): Promise<ServiceOrder>;
  updateServiceOrder(
    input: LabServicesCommandContext & {
      serviceOrderId: string;
      changes: UpdateServiceOrderRequest;
    }
  ): Promise<ServiceOrder>;
  replaceServiceOrderLines(
    input: LabServicesCommandContext & {
      serviceOrderId: string;
      lines: readonly ServiceOrderLineInput[];
    }
  ): Promise<ServiceOrder>;
  confirmServiceOrder(
    input: LabServicesCommandContext & { serviceOrderId: string }
  ): Promise<ServiceOrder>;
  startServiceOrder(
    input: LabServicesCommandContext & { serviceOrderId: string }
  ): Promise<ServiceOrder>;
  completeServiceOrder(
    input: LabServicesCommandContext & { serviceOrderId: string }
  ): Promise<ServiceOrder>;
  cancelServiceOrder(
    input: LabServicesCommandContext & { serviceOrderId: string; reason?: string | null }
  ): Promise<ServiceOrder>;

  listInteractions(tenantId: string, customerId: string): Promise<CustomerInteraction[]>;
  createInteraction(
    input: LabServicesCommandContext & { customerId: string } & CreateInteractionRequest
  ): Promise<CustomerInteraction>;
}
