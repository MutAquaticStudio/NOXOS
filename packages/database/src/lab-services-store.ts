import type { Sql, TransactionSql } from "postgres";
import {
  LabServicesProblem,
  type Customer,
  type CustomerContact,
  type CustomerDirectoryProjection,
  type CustomerInteraction,
  type CustomerRegistryEntry,
  type LabServiceOrderProjection,
  type LabServicesCommandContext,
  type LabServicesStore,
  type ServiceOrder,
  type ServiceOrderLine,
  type ServiceOrderLineInput
} from "@nox-os/lab-services";

type Executor = Sql | TransactionSql;
type CustomerRow = {
  id: string;
  tenant_id: string;
  customer_code: string;
  customer_type: Customer["customerType"];
  display_name: string;
  legal_name: string | null;
  tax_identifier: string | null;
  country_code: string | null;
  status: Customer["status"];
  notes: string | null;
  created_by_user_id: string;
  held_by_user_id: string | null;
  archived_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  held_at: Date | null;
  archived_at: Date | null;
};
type CustomerRegistryRow = CustomerRow & {
  primary_contact_name: string | null;
  open_service_order_count: number;
  last_interaction_at: Date | null;
};
type ContactRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  status: CustomerContact["status"];
  is_primary: boolean;
  created_by_user_id: string;
  archived_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};
type OrderRow = {
  id: string;
  tenant_id: string;
  order_number: string;
  customer_id: string;
  customer_code: string;
  customer_display_name: string;
  customer_contact_id: string | null;
  contact_full_name: string | null;
  customer_external_reference: string | null;
  intake_summary: string;
  requested_completion_date: Date | null;
  status: ServiceOrder["status"];
  notes: string | null;
  cancellation_reason: string | null;
  created_by_user_id: string;
  confirmed_by_user_id: string | null;
  started_by_user_id: string | null;
  completed_by_user_id: string | null;
  cancelled_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  confirmed_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
};
type LineRow = {
  id: string;
  tenant_id: string;
  service_order_id: string;
  line_order: number;
  service_type: ServiceOrderLine["serviceType"];
  title: string;
  scope_description: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};
type InteractionRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_order_id: string | null;
  interaction_type: CustomerInteraction["interactionType"];
  occurred_at: Date;
  summary: string;
  next_action_text: string | null;
  next_action_date: Date | null;
  created_by_user_id: string;
  created_at: Date;
};

const customer = (row: CustomerRow): Customer => ({
  id: row.id,
  tenantId: row.tenant_id,
  customerCode: row.customer_code,
  customerType: row.customer_type,
  displayName: row.display_name,
  legalName: row.legal_name,
  taxIdentifier: row.tax_identifier,
  countryCode: row.country_code,
  status: row.status,
  notes: row.notes,
  createdByUserId: row.created_by_user_id,
  heldByUserId: row.held_by_user_id,
  archivedByUserId: row.archived_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  heldAt: row.held_at,
  archivedAt: row.archived_at
});
const contact = (row: ContactRow): CustomerContact => ({
  id: row.id,
  tenantId: row.tenant_id,
  customerId: row.customer_id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  roleTitle: row.role_title,
  status: row.status,
  isPrimary: row.is_primary,
  createdByUserId: row.created_by_user_id,
  archivedByUserId: row.archived_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at
});
const line = (row: LineRow): ServiceOrderLine => ({
  id: row.id,
  tenantId: row.tenant_id,
  serviceOrderId: row.service_order_id,
  lineOrder: row.line_order,
  serviceType: row.service_type,
  title: row.title,
  scopeDescription: row.scope_description,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
const interaction = (row: InteractionRow): CustomerInteraction => ({
  id: row.id,
  tenantId: row.tenant_id,
  customerId: row.customer_id,
  serviceOrderId: row.service_order_id,
  interactionType: row.interaction_type,
  occurredAt: row.occurred_at,
  summary: row.summary,
  nextActionText: row.next_action_text,
  nextActionDate: row.next_action_date,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at
});

async function audit(
  sql: Executor,
  input: LabServicesCommandContext & {
    action: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await sql`insert into platform.audit_events (
      tenant_id, actor_user_id, action, resource_type, resource_id,
      request_id, correlation_id, metadata
    ) values (
      ${input.tenantId}, ${input.actorUserId}, ${input.action}, ${input.resourceType},
      ${input.resourceId}, ${input.requestId}, ${input.correlationId},
      ${sql.json(JSON.parse(JSON.stringify(input.metadata ?? {})) as never)}
    )`;
}

async function requireCustomer(
  sql: Executor,
  tenantId: string,
  customerId: string,
  lock = false
): Promise<CustomerRow> {
  const rows = lock
    ? await sql<
        CustomerRow[]
      >`select * from lab_services.customers where tenant_id = ${tenantId} and id = ${customerId} for update`
    : await sql<
        CustomerRow[]
      >`select * from lab_services.customers where tenant_id = ${tenantId} and id = ${customerId}`;
  if (!rows[0])
    throw new LabServicesProblem(404, "LAB_CUSTOMER_NOT_FOUND", "Customer was not found.");
  return rows[0];
}

async function requireContact(
  sql: Executor,
  tenantId: string,
  contactId: string,
  lock = false
): Promise<ContactRow> {
  const rows = lock
    ? await sql<
        ContactRow[]
      >`select * from lab_services.customer_contacts where tenant_id = ${tenantId} and id = ${contactId} for update`
    : await sql<
        ContactRow[]
      >`select * from lab_services.customer_contacts where tenant_id = ${tenantId} and id = ${contactId}`;
  if (!rows[0])
    throw new LabServicesProblem(404, "LAB_CONTACT_NOT_FOUND", "Customer Contact was not found.");
  return rows[0];
}

async function requireOrder(
  sql: Executor,
  tenantId: string,
  orderId: string,
  lock = false
): Promise<{
  id: string;
  customer_id: string;
  customer_contact_id: string | null;
  status: ServiceOrder["status"];
}> {
  const rows = lock
    ? await sql<
        {
          id: string;
          customer_id: string;
          customer_contact_id: string | null;
          status: ServiceOrder["status"];
        }[]
      >`select id, customer_id, customer_contact_id, status from lab_services.service_orders where tenant_id = ${tenantId} and id = ${orderId} for update`
    : await sql<
        {
          id: string;
          customer_id: string;
          customer_contact_id: string | null;
          status: ServiceOrder["status"];
        }[]
      >`select id, customer_id, customer_contact_id, status from lab_services.service_orders where tenant_id = ${tenantId} and id = ${orderId}`;
  if (!rows[0])
    throw new LabServicesProblem(
      404,
      "LAB_SERVICE_ORDER_NOT_FOUND",
      "Service Order was not found."
    );
  return rows[0];
}

async function validateContact(
  sql: Executor,
  tenantId: string,
  customerId: string,
  contactId: string | null | undefined
): Promise<void> {
  if (!contactId) return;
  const candidate = await requireContact(sql, tenantId, contactId);
  if (candidate.customer_id !== customerId)
    throw new LabServicesProblem(
      409,
      "LAB_CONTACT_CUSTOMER_MISMATCH",
      "Contact does not belong to the selected Customer."
    );
  if (candidate.status !== "ACTIVE")
    throw new LabServicesProblem(409, "LAB_CONTACT_NOT_ACTIVE", "Customer Contact is not active.");
}

async function insertLines(
  sql: Executor,
  tenantId: string,
  serviceOrderId: string,
  lines: readonly ServiceOrderLineInput[]
): Promise<void> {
  for (const value of lines) {
    await sql`insert into lab_services.service_order_lines (
      tenant_id, service_order_id, line_order, service_type, title, scope_description, notes
    ) values (
      ${tenantId}, ${serviceOrderId}, ${value.lineOrder}, ${value.serviceType}, ${value.title},
      ${value.scopeDescription}, ${value.notes ?? null}
    )`;
  }
}

async function loadOrder(
  sql: Executor,
  tenantId: string,
  orderId: string
): Promise<ServiceOrder | undefined> {
  const rows = await sql<OrderRow[]>`select orders.*, customers.customer_code,
      customers.display_name as customer_display_name, contacts.full_name as contact_full_name
    from lab_services.service_orders as orders
    join lab_services.customers as customers
      on customers.tenant_id = orders.tenant_id and customers.id = orders.customer_id
    left join lab_services.customer_contacts as contacts
      on contacts.tenant_id = orders.tenant_id and contacts.id = orders.customer_contact_id
    where orders.tenant_id = ${tenantId} and orders.id = ${orderId}`;
  if (!rows[0]) return undefined;
  const lineRows = await sql<LineRow[]>`select * from lab_services.service_order_lines
    where tenant_id = ${tenantId} and service_order_id = ${orderId}
    order by line_order`;
  const row = rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerDisplayName: row.customer_display_name,
    customerContactId: row.customer_contact_id,
    contactFullName: row.contact_full_name,
    customerExternalReference: row.customer_external_reference,
    intakeSummary: row.intake_summary,
    requestedCompletionDate: row.requested_completion_date,
    status: row.status,
    notes: row.notes,
    cancellationReason: row.cancellation_reason,
    createdByUserId: row.created_by_user_id,
    confirmedByUserId: row.confirmed_by_user_id,
    startedByUserId: row.started_by_user_id,
    completedByUserId: row.completed_by_user_id,
    cancelledByUserId: row.cancelled_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    lines: lineRows.map(line)
  };
}

export class PostgresLabServicesStore implements LabServicesStore {
  constructor(private readonly sql: Sql) {}

  async listCustomers(tenantId: string): Promise<CustomerRegistryEntry[]> {
    const rows = await this.sql<CustomerRegistryRow[]>`
      select customers.*,
        primary_contact.full_name as primary_contact_name,
        coalesce(open_orders.count, 0)::int as open_service_order_count,
        latest_interaction.occurred_at as last_interaction_at
      from lab_services.customers
      left join lateral (
        select full_name
        from lab_services.customer_contacts
        where tenant_id = customers.tenant_id and customer_id = customers.id
          and status = 'ACTIVE' and is_primary
        limit 1
      ) primary_contact on true
      left join lateral (
        select count(*)::int as count
        from lab_services.service_orders
        where tenant_id = customers.tenant_id and customer_id = customers.id
          and status in ('DRAFT', 'CONFIRMED', 'IN_PROGRESS')
      ) open_orders on true
      left join lateral (
        select occurred_at
        from lab_services.customer_interactions
        where tenant_id = customers.tenant_id and customer_id = customers.id
        order by occurred_at desc, created_at desc
        limit 1
      ) latest_interaction on true
      where customers.tenant_id = ${tenantId}
      order by customers.display_name, customers.customer_code
    `;
    return rows.map((row) => ({
      ...customer(row),
      primaryContactName: row.primary_contact_name,
      openServiceOrderCount: row.open_service_order_count,
      lastInteractionAt: row.last_interaction_at
    }));
  }
  async findCustomer(tenantId: string, customerId: string): Promise<Customer | undefined> {
    const rows = await this.sql<
      CustomerRow[]
    >`select * from lab_services.customers where tenant_id = ${tenantId} and id = ${customerId}`;
    return rows[0] ? customer(rows[0]) : undefined;
  }
  createCustomer(input: Parameters<LabServicesStore["createCustomer"]>[0]): Promise<Customer> {
    return this.sql.begin(async (tx) => {
      const duplicate =
        await tx`select 1 from lab_services.customers where tenant_id = ${input.tenantId} and customer_code = ${input.customerCode}`;
      if (duplicate.length)
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_CODE_CONFLICT",
          "Customer code already exists."
        );
      const rows = await tx<CustomerRow[]>`insert into lab_services.customers (
        tenant_id, customer_code, customer_type, display_name, legal_name, tax_identifier,
        country_code, notes, created_by_user_id
      ) values (
        ${input.tenantId}, ${input.customerCode}, ${input.customerType}, ${input.displayName},
        ${input.legalName ?? null}, ${input.taxIdentifier ?? null}, ${input.countryCode ?? null},
        ${input.notes ?? null}, ${input.actorUserId}
      ) returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.customer.created",
        resourceType: "Customer",
        resourceId: rows[0].id
      });
      return customer(rows[0]);
    });
  }
  updateCustomer(input: Parameters<LabServicesStore["updateCustomer"]>[0]): Promise<Customer> {
    return this.sql.begin(async (tx) => {
      const current = await requireCustomer(tx, input.tenantId, input.customerId, true);
      if (current.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer is historical read-only."
        );
      if (input.changes.customerCode && input.changes.customerCode !== current.customer_code) {
        const used =
          await tx`select 1 from lab_services.service_orders where tenant_id = ${input.tenantId} and customer_id = ${input.customerId} limit 1`;
        if (used.length)
          throw new LabServicesProblem(
            409,
            "LAB_CUSTOMER_CODE_CONFLICT",
            "Customer code is immutable after Service Order creation."
          );
        const duplicate =
          await tx`select 1 from lab_services.customers where tenant_id = ${input.tenantId} and customer_code = ${input.changes.customerCode} and id <> ${input.customerId}`;
        if (duplicate.length)
          throw new LabServicesProblem(
            409,
            "LAB_CUSTOMER_CODE_CONFLICT",
            "Customer code already exists."
          );
      }
      const value = { ...customer(current), ...input.changes };
      const rows = await tx<CustomerRow[]>`update lab_services.customers set
        customer_code = ${value.customerCode}, customer_type = ${value.customerType},
        display_name = ${value.displayName}, legal_name = ${value.legalName},
        tax_identifier = ${value.taxIdentifier}, country_code = ${value.countryCode},
        notes = ${value.notes}, updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.customerId} returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.customer.updated",
        resourceType: "Customer",
        resourceId: input.customerId
      });
      return customer(rows[0]);
    });
  }
  activateCustomer(input: Parameters<LabServicesStore["activateCustomer"]>[0]): Promise<Customer> {
    return this.customerStatus(input, "ACTIVE", "lab-services.customer.activated");
  }
  holdCustomer(input: Parameters<LabServicesStore["holdCustomer"]>[0]): Promise<Customer> {
    return this.customerStatus(input, "ON_HOLD", "lab-services.customer.held");
  }
  archiveCustomer(input: Parameters<LabServicesStore["archiveCustomer"]>[0]): Promise<Customer> {
    return this.sql.begin(async (tx) => {
      const current = await requireCustomer(tx, input.tenantId, input.customerId, true);
      if (current.status === "ARCHIVED") return customer(current);
      const open =
        await tx`select 1 from lab_services.service_orders where tenant_id = ${input.tenantId} and customer_id = ${input.customerId} and status in ('DRAFT','CONFIRMED','IN_PROGRESS') limit 1`;
      if (open.length)
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_HAS_OPEN_ORDERS",
          "Customer has open Service Orders."
        );
      const rows = await tx<
        CustomerRow[]
      >`update lab_services.customers set status = 'ARCHIVED', archived_by_user_id = ${input.actorUserId}, archived_at = now(), updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.customerId} returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.customer.archived",
        resourceType: "Customer",
        resourceId: input.customerId
      });
      return customer(rows[0]);
    });
  }
  private customerStatus(
    input: LabServicesCommandContext & { customerId: string },
    status: "ACTIVE" | "ON_HOLD",
    action: string
  ): Promise<Customer> {
    return this.sql.begin(async (tx) => {
      const current = await requireCustomer(tx, input.tenantId, input.customerId, true);
      if (current.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer is historical read-only."
        );
      if (current.status === status) return customer(current);
      const rows = await tx<
        CustomerRow[]
      >`update lab_services.customers set status = ${status}, held_by_user_id = ${status === "ON_HOLD" ? input.actorUserId : null}, held_at = ${status === "ON_HOLD" ? new Date() : null}, updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.customerId} returning *`;
      await audit(tx, { ...input, action, resourceType: "Customer", resourceId: input.customerId });
      return customer(rows[0]);
    });
  }

  async listContacts(tenantId: string, customerId: string): Promise<CustomerContact[]> {
    const rows = await this.sql<
      ContactRow[]
    >`select * from lab_services.customer_contacts where tenant_id = ${tenantId} and customer_id = ${customerId} order by is_primary desc, full_name`;
    return rows.map(contact);
  }
  createContact(input: Parameters<LabServicesStore["createContact"]>[0]): Promise<CustomerContact> {
    return this.sql.begin(async (tx) => {
      const owner = await requireCustomer(tx, input.tenantId, input.customerId, true);
      if (owner.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer is historical read-only."
        );
      if (input.isPrimary) {
        const primary =
          await tx`select 1 from lab_services.customer_contacts where tenant_id = ${input.tenantId} and customer_id = ${input.customerId} and status = 'ACTIVE' and is_primary limit 1`;
        if (primary.length)
          throw new LabServicesProblem(
            409,
            "LAB_PRIMARY_CONTACT_CONFLICT",
            "Customer already has an active primary Contact."
          );
      }
      const rows = await tx<ContactRow[]>`insert into lab_services.customer_contacts (
        tenant_id, customer_id, full_name, email, phone, role_title, is_primary, created_by_user_id
      ) values (
        ${input.tenantId}, ${input.customerId}, ${input.fullName}, ${input.email ?? null},
        ${input.phone ?? null}, ${input.roleTitle ?? null}, ${input.isPrimary}, ${input.actorUserId}
      ) returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.contact.created",
        resourceType: "CustomerContact",
        resourceId: rows[0].id
      });
      return contact(rows[0]);
    });
  }
  updateContact(input: Parameters<LabServicesStore["updateContact"]>[0]): Promise<CustomerContact> {
    return this.sql.begin(async (tx) => {
      const current = await requireContact(tx, input.tenantId, input.contactId, true);
      const owner = await requireCustomer(tx, input.tenantId, current.customer_id, true);
      if (owner.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer history is read-only."
        );
      if (current.status !== "ACTIVE")
        throw new LabServicesProblem(
          409,
          "LAB_CONTACT_NOT_ACTIVE",
          "Archived Contact is historical read-only."
        );
      const value = { ...contact(current), ...input.changes };
      const rows = await tx<
        ContactRow[]
      >`update lab_services.customer_contacts set full_name = ${value.fullName}, email = ${value.email}, phone = ${value.phone}, role_title = ${value.roleTitle}, updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.contactId} returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.contact.updated",
        resourceType: "CustomerContact",
        resourceId: input.contactId
      });
      return contact(rows[0]);
    });
  }
  archiveContact(
    input: Parameters<LabServicesStore["archiveContact"]>[0]
  ): Promise<CustomerContact> {
    return this.sql.begin(async (tx) => {
      const current = await requireContact(tx, input.tenantId, input.contactId, true);
      const owner = await requireCustomer(tx, input.tenantId, current.customer_id, true);
      if (owner.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer history is read-only."
        );
      if (current.status === "ARCHIVED") return contact(current);
      const rows = await tx<
        ContactRow[]
      >`update lab_services.customer_contacts set status = 'ARCHIVED', is_primary = false, archived_by_user_id = ${input.actorUserId}, archived_at = now(), updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.contactId} returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.contact.archived",
        resourceType: "CustomerContact",
        resourceId: input.contactId
      });
      return contact(rows[0]);
    });
  }
  makePrimaryContact(
    input: Parameters<LabServicesStore["makePrimaryContact"]>[0]
  ): Promise<CustomerContact> {
    return this.sql.begin(async (tx) => {
      const current = await requireContact(tx, input.tenantId, input.contactId, true);
      if (current.status !== "ACTIVE")
        throw new LabServicesProblem(
          409,
          "LAB_CONTACT_NOT_ACTIVE",
          "Only an active Contact may be primary."
        );
      const owner = await requireCustomer(tx, input.tenantId, current.customer_id, true);
      if (owner.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer history is read-only."
        );
      if (current.is_primary) return contact(current);
      await tx`update lab_services.customer_contacts set is_primary = false, updated_at = now() where tenant_id = ${input.tenantId} and customer_id = ${current.customer_id} and status = 'ACTIVE' and is_primary`;
      const rows = await tx<
        ContactRow[]
      >`update lab_services.customer_contacts set is_primary = true, updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.contactId} returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.contact.primary-changed",
        resourceType: "CustomerContact",
        resourceId: input.contactId,
        metadata: { customerId: current.customer_id }
      });
      return contact(rows[0]);
    });
  }

  async listServiceOrders(tenantId: string): Promise<ServiceOrder[]> {
    const rows = await this.sql<
      { id: string }[]
    >`select id from lab_services.service_orders where tenant_id = ${tenantId} order by updated_at desc, order_number`;
    return (await Promise.all(rows.map((row) => loadOrder(this.sql, tenantId, row.id)))).filter(
      (value): value is ServiceOrder => Boolean(value)
    );
  }
  findServiceOrder(tenantId: string, serviceOrderId: string) {
    return loadOrder(this.sql, tenantId, serviceOrderId);
  }
  createServiceOrder(
    input: Parameters<LabServicesStore["createServiceOrder"]>[0]
  ): Promise<ServiceOrder> {
    return this.sql.begin(async (tx) => {
      const owner = await requireCustomer(tx, input.tenantId, input.customerId, true);
      if (owner.status === "ON_HOLD")
        throw new LabServicesProblem(409, "LAB_CUSTOMER_ON_HOLD", "Customer is on hold.");
      if (owner.status === "ARCHIVED")
        throw new LabServicesProblem(409, "LAB_CUSTOMER_ARCHIVED", "Customer is archived.");
      await validateContact(tx, input.tenantId, input.customerId, input.customerContactId);
      const duplicate =
        await tx`select 1 from lab_services.service_orders where tenant_id = ${input.tenantId} and order_number = ${input.orderNumber}`;
      if (duplicate.length)
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_NOT_EDITABLE",
          "Service Order number already exists."
        );
      const rows = await tx<{ id: string }[]>`insert into lab_services.service_orders (
        tenant_id, order_number, customer_id, customer_contact_id, customer_external_reference,
        intake_summary, requested_completion_date, notes, created_by_user_id
      ) values (
        ${input.tenantId}, ${input.orderNumber}, ${input.customerId}, ${input.customerContactId ?? null},
        ${input.customerExternalReference ?? null}, ${input.intakeSummary},
        ${input.requestedCompletionDate ? new Date(input.requestedCompletionDate) : null},
        ${input.notes ?? null}, ${input.actorUserId}
      ) returning id`;
      await insertLines(tx, input.tenantId, rows[0].id, input.lines);
      await audit(tx, {
        ...input,
        action: "lab-services.service-order.created",
        resourceType: "LabServiceOrder",
        resourceId: rows[0].id
      });
      return (await loadOrder(tx, input.tenantId, rows[0].id))!;
    });
  }
  updateServiceOrder(
    input: Parameters<LabServicesStore["updateServiceOrder"]>[0]
  ): Promise<ServiceOrder> {
    return this.sql.begin(async (tx) => {
      const current = await requireOrder(tx, input.tenantId, input.serviceOrderId, true);
      if (current.status !== "DRAFT")
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_SCOPE_IMMUTABLE",
          "Confirmed Service Order scope is immutable."
        );
      const customerId = input.changes.customerId ?? current.customer_id;
      const owner = await requireCustomer(tx, input.tenantId, customerId, true);
      if (!["PROSPECT", "ACTIVE"].includes(owner.status))
        throw new LabServicesProblem(
          409,
          owner.status === "ON_HOLD" ? "LAB_CUSTOMER_ON_HOLD" : "LAB_CUSTOMER_ARCHIVED",
          "Customer cannot receive a Service Order."
        );
      const contactId =
        input.changes.customerContactId === undefined
          ? current.customer_contact_id
          : input.changes.customerContactId;
      await validateContact(tx, input.tenantId, customerId, contactId);
      const previous = (await loadOrder(tx, input.tenantId, input.serviceOrderId))!;
      const value = { ...previous, ...input.changes, customerId, customerContactId: contactId };
      await tx`update lab_services.service_orders set customer_id = ${customerId}, customer_contact_id = ${contactId}, customer_external_reference = ${value.customerExternalReference}, intake_summary = ${value.intakeSummary}, requested_completion_date = ${value.requestedCompletionDate}, notes = ${value.notes}, updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.serviceOrderId}`;
      await audit(tx, {
        ...input,
        action: "lab-services.service-order.updated",
        resourceType: "LabServiceOrder",
        resourceId: input.serviceOrderId
      });
      return (await loadOrder(tx, input.tenantId, input.serviceOrderId))!;
    });
  }
  replaceServiceOrderLines(
    input: Parameters<LabServicesStore["replaceServiceOrderLines"]>[0]
  ): Promise<ServiceOrder> {
    return this.sql.begin(async (tx) => {
      const current = await requireOrder(tx, input.tenantId, input.serviceOrderId, true);
      if (current.status !== "DRAFT")
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_SCOPE_IMMUTABLE",
          "Confirmed Service Order scope is immutable."
        );
      await tx`delete from lab_services.service_order_lines where tenant_id = ${input.tenantId} and service_order_id = ${input.serviceOrderId}`;
      await insertLines(tx, input.tenantId, input.serviceOrderId, input.lines);
      await audit(tx, {
        ...input,
        action: "lab-services.service-order.updated",
        resourceType: "LabServiceOrder",
        resourceId: input.serviceOrderId,
        metadata: { scopeLinesReplaced: true }
      });
      return (await loadOrder(tx, input.tenantId, input.serviceOrderId))!;
    });
  }
  confirmServiceOrder(
    input: Parameters<LabServicesStore["confirmServiceOrder"]>[0]
  ): Promise<ServiceOrder> {
    return this.sql.begin(async (tx) => {
      const current = await requireOrder(tx, input.tenantId, input.serviceOrderId, true);
      if (current.status !== "DRAFT")
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_NOT_CONFIRMABLE",
          "Only a DRAFT Service Order may be confirmed."
        );
      const owner = await requireCustomer(tx, input.tenantId, current.customer_id, true);
      if (owner.status !== "ACTIVE") {
        const code =
          owner.status === "PROSPECT"
            ? "LAB_CUSTOMER_NOT_ACTIVE"
            : owner.status === "ON_HOLD"
              ? "LAB_CUSTOMER_ON_HOLD"
              : "LAB_CUSTOMER_ARCHIVED";
        throw new LabServicesProblem(409, code, "An ACTIVE Customer is required for confirmation.");
      }
      await validateContact(tx, input.tenantId, current.customer_id, current.customer_contact_id);
      const count = await tx<
        { count: string }[]
      >`select count(*)::text as count from lab_services.service_order_lines where tenant_id = ${input.tenantId} and service_order_id = ${input.serviceOrderId}`;
      if (count[0].count === "0")
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_LINES_REQUIRED",
          "At least one Service Order line is required."
        );
      await tx`update lab_services.service_orders set status = 'CONFIRMED', confirmed_by_user_id = ${input.actorUserId}, confirmed_at = now(), updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.serviceOrderId}`;
      await audit(tx, {
        ...input,
        action: "lab-services.service-order.confirmed",
        resourceType: "LabServiceOrder",
        resourceId: input.serviceOrderId
      });
      return (await loadOrder(tx, input.tenantId, input.serviceOrderId))!;
    });
  }
  startServiceOrder(
    input: Parameters<LabServicesStore["startServiceOrder"]>[0]
  ): Promise<ServiceOrder> {
    return this.transition(
      input,
      "CONFIRMED",
      "IN_PROGRESS",
      "lab-services.service-order.started",
      "started_by_user_id",
      "started_at"
    );
  }
  completeServiceOrder(
    input: Parameters<LabServicesStore["completeServiceOrder"]>[0]
  ): Promise<ServiceOrder> {
    return this.transition(
      input,
      "IN_PROGRESS",
      "COMPLETED",
      "lab-services.service-order.completed",
      "completed_by_user_id",
      "completed_at"
    );
  }
  private transition(
    input: LabServicesCommandContext & { serviceOrderId: string },
    expected: ServiceOrder["status"],
    target: ServiceOrder["status"],
    action: string,
    actorColumn: "started_by_user_id" | "completed_by_user_id",
    timeColumn: "started_at" | "completed_at"
  ): Promise<ServiceOrder> {
    return this.sql.begin(async (tx) => {
      const current = await requireOrder(tx, input.tenantId, input.serviceOrderId, true);
      if (current.status !== expected)
        throw new LabServicesProblem(
          409,
          ["COMPLETED", "CANCELLED"].includes(current.status)
            ? "LAB_SERVICE_ORDER_ALREADY_TERMINAL"
            : "LAB_SERVICE_ORDER_NOT_EDITABLE",
          `Service Order must be ${expected}.`
        );
      await tx.unsafe(
        `update lab_services.service_orders set status = $1, ${actorColumn} = $2, ${timeColumn} = now(), updated_at = now() where tenant_id = $3 and id = $4`,
        [target, input.actorUserId, input.tenantId, input.serviceOrderId]
      );
      await audit(tx, {
        ...input,
        action,
        resourceType: "LabServiceOrder",
        resourceId: input.serviceOrderId
      });
      return (await loadOrder(tx, input.tenantId, input.serviceOrderId))!;
    });
  }
  cancelServiceOrder(
    input: Parameters<LabServicesStore["cancelServiceOrder"]>[0]
  ): Promise<ServiceOrder> {
    return this.sql.begin(async (tx) => {
      const current = await requireOrder(tx, input.tenantId, input.serviceOrderId, true);
      if (["COMPLETED", "CANCELLED"].includes(current.status))
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_ALREADY_TERMINAL",
          "Terminal Service Order cannot be cancelled."
        );
      if (current.status !== "DRAFT" && !input.reason)
        throw new LabServicesProblem(
          409,
          "LAB_SERVICE_ORDER_NOT_EDITABLE",
          "Cancellation reason is required after confirmation."
        );
      await tx`update lab_services.service_orders set status = 'CANCELLED', cancellation_reason = ${input.reason ?? null}, cancelled_by_user_id = ${input.actorUserId}, cancelled_at = now(), updated_at = now() where tenant_id = ${input.tenantId} and id = ${input.serviceOrderId}`;
      await audit(tx, {
        ...input,
        action: "lab-services.service-order.cancelled",
        resourceType: "LabServiceOrder",
        resourceId: input.serviceOrderId,
        metadata: { reason: input.reason ?? null }
      });
      return (await loadOrder(tx, input.tenantId, input.serviceOrderId))!;
    });
  }

  async listInteractions(tenantId: string, customerId: string): Promise<CustomerInteraction[]> {
    const rows = await this.sql<
      InteractionRow[]
    >`select * from lab_services.customer_interactions where tenant_id = ${tenantId} and customer_id = ${customerId} order by occurred_at desc, created_at desc`;
    return rows.map(interaction);
  }
  createInteraction(
    input: Parameters<LabServicesStore["createInteraction"]>[0]
  ): Promise<CustomerInteraction> {
    return this.sql.begin(async (tx) => {
      const owner = await requireCustomer(tx, input.tenantId, input.customerId, true);
      if (owner.status === "ARCHIVED")
        throw new LabServicesProblem(
          409,
          "LAB_CUSTOMER_ARCHIVED",
          "Archived Customer is historical read-only."
        );
      if (input.serviceOrderId) {
        const order = await requireOrder(tx, input.tenantId, input.serviceOrderId);
        if (order.customer_id !== input.customerId)
          throw new LabServicesProblem(
            409,
            "LAB_INTERACTION_ORDER_MISMATCH",
            "Interaction Service Order belongs to another Customer."
          );
      }
      const rows = await tx<InteractionRow[]>`insert into lab_services.customer_interactions (
        tenant_id, customer_id, service_order_id, interaction_type, occurred_at,
        summary, next_action_text, next_action_date, created_by_user_id
      ) values (
        ${input.tenantId}, ${input.customerId}, ${input.serviceOrderId ?? null},
        ${input.interactionType}, ${new Date(input.occurredAt)}, ${input.summary},
        ${input.nextActionText ?? null}, ${input.nextActionDate ? new Date(input.nextActionDate) : null},
        ${input.actorUserId}
      ) returning *`;
      await audit(tx, {
        ...input,
        action: "lab-services.interaction.created",
        resourceType: "CustomerInteraction",
        resourceId: rows[0].id
      });
      return interaction(rows[0]);
    });
  }

  async findConfirmedServiceOrder(
    tenantId: string,
    serviceOrderId: string
  ): Promise<LabServiceOrderProjection | undefined> {
    const order = await loadOrder(this.sql, tenantId, serviceOrderId);
    if (!order || !["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(order.status))
      return undefined;
    let pinnedContact: LabServiceOrderProjection["pinnedContact"] = null;
    if (order.customerContactId) {
      const rows = await this.sql<
        ContactRow[]
      >`select * from lab_services.customer_contacts where tenant_id = ${tenantId} and id = ${order.customerContactId}`;
      if (rows[0])
        pinnedContact = {
          contactId: rows[0].id,
          fullName: rows[0].full_name,
          email: rows[0].email,
          phone: rows[0].phone
        };
    }
    return {
      serviceOrderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerId: order.customerId,
      customerCode: order.customerCode,
      customerDisplayName: order.customerDisplayName,
      pinnedContact,
      intakeSummary: order.intakeSummary,
      requestedCompletionDate: order.requestedCompletionDate,
      lines: order.lines.map(({ id, lineOrder, serviceType, title, scopeDescription }) => ({
        id,
        lineOrder,
        serviceType,
        title,
        scopeDescription
      }))
    };
  }

  async findCustomerDirectoryEntry(
    tenantId: string,
    customerId: string
  ): Promise<CustomerDirectoryProjection | undefined> {
    const value = await this.findCustomer(tenantId, customerId);
    if (!value) return undefined;
    const rows = await this.sql<
      ContactRow[]
    >`select * from lab_services.customer_contacts where tenant_id = ${tenantId} and customer_id = ${customerId} and status = 'ACTIVE' and is_primary limit 1`;
    const primaryContact = rows[0]
      ? {
          id: rows[0].id,
          fullName: rows[0].full_name,
          email: rows[0].email,
          phone: rows[0].phone,
          roleTitle: rows[0].role_title
        }
      : null;
    return {
      customerId: value.id,
      customerCode: value.customerCode,
      customerType: value.customerType,
      displayName: value.displayName,
      legalName: value.legalName,
      taxIdentifier: value.taxIdentifier,
      countryCode: value.countryCode,
      status: value.status,
      primaryContact
    };
  }
}

export function createPostgresLabServicesStore(sql: Sql): LabServicesStore {
  return new PostgresLabServicesStore(sql);
}
