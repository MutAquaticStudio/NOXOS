import type { Sql, TransactionSql } from "postgres";
import {
  CommercialOrdersProblem,
  type CommercialAnalyticsOrder,
  type CommercialCommandContext,
  type CommercialCustomer,
  type CommercialFormula,
  type CommercialLineInput,
  type CommercialOrdersStore,
  type CommercialProject,
  type CommercialServiceLine
} from "@nox-os/commercial-orders";
import {
  consumeCommercialReservationInTransaction,
  releaseCommercialReservationInTransaction,
  reserveCommercialLotInTransaction
} from "./inventory-store.js";

type Executor = Sql | TransactionSql;
type HeaderInput = Record<string, any>;
const now = () => new Date();
const asString = (value: bigint | number | string | null | undefined) => String(value ?? "0");
const problem = (status: number, code: string, message: string): never => {
  throw new CommercialOrdersProblem(status, code, message);
};
const net = (line: {
  quantityValue: string;
  unitPriceMinor: string;
  priceBasisQuantity: string;
  discountMinor?: string;
}) => {
  const gross =
    (BigInt(line.quantityValue) * BigInt(line.unitPriceMinor) +
      BigInt(line.priceBasisQuantity) / 2n) /
    BigInt(line.priceBasisQuantity);
  const value = gross - BigInt(line.discountMinor ?? "0");
  if (value < 0n)
    problem(400, "COMMERCIAL_MONEY_INVALID", "Line discount exceeds its gross amount.");
  return value;
};

async function audit(
  sql: Executor,
  context: CommercialCommandContext,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await sql`
    insert into platform.audit_events (
      tenant_id, actor_user_id, action, resource_type, resource_id, request_id, correlation_id, metadata
    ) values (
      ${context.tenantId}, ${context.actorUserId}, ${action}, ${resourceType}, ${resourceId},
      ${context.requestId}, ${context.correlationId}, ${sql.json(metadata as any)}
    )
  `;
}

function lineParams(line: CommercialLineInput) {
  return {
    ...line,
    materialId: line.materialId ?? null,
    serviceOrderLineId: line.serviceOrderLineId ?? null,
    formulaVersionId: line.formulaVersionId ?? null,
    discountMinor: line.discountMinor ?? "0",
    descriptionSnapshot: line.descriptionSnapshot ?? null,
    notes: line.notes ?? null,
    quantityKind: line.lineKind === "SERVICE_SCOPE" ? "UNIT_COUNT" : "MASS_MG"
  };
}

async function insertQuoteLines(
  sql: Executor,
  tenantId: string,
  quoteId: string,
  lines: readonly CommercialLineInput[]
) {
  for (const raw of lines) {
    const line = lineParams(raw);
    net(line);
    await sql`
      insert into commercial.quote_lines (
        tenant_id, quote_id, line_order, line_kind, title_snapshot, description_snapshot,
        material_id, service_order_line_id, formula_version_id, quantity_kind, quantity_value,
        unit_price_minor, price_basis_quantity, discount_minor, notes
      ) values (
        ${tenantId}, ${quoteId}, ${line.lineOrder}, ${line.lineKind}, ${line.titleSnapshot}, ${line.descriptionSnapshot},
        ${line.materialId}, ${line.serviceOrderLineId}, ${line.formulaVersionId}, ${line.quantityKind}, ${line.quantityValue},
        ${line.unitPriceMinor}, ${line.priceBasisQuantity}, ${line.discountMinor}, ${line.notes}
      )
    `;
  }
}
async function insertOrderLines(
  sql: Executor,
  tenantId: string,
  orderId: string,
  lines: readonly CommercialLineInput[]
) {
  for (const raw of lines) {
    const line = lineParams(raw);
    net(line);
    await sql`
      insert into commercial.order_lines (
        tenant_id, order_id, line_order, line_kind, title_snapshot, description_snapshot,
        material_id, service_order_line_id, formula_version_id, quantity_kind, ordered_quantity,
        unit_price_minor, price_basis_quantity, discount_minor, notes
      ) values (
        ${tenantId}, ${orderId}, ${line.lineOrder}, ${line.lineKind}, ${line.titleSnapshot}, ${line.descriptionSnapshot},
        ${line.materialId}, ${line.serviceOrderLineId}, ${line.formulaVersionId}, ${line.quantityKind}, ${line.quantityValue},
        ${line.unitPriceMinor}, ${line.priceBasisQuantity}, ${line.discountMinor}, ${line.notes}
      )
    `;
  }
}

async function quoteEnvelope(
  sql: Executor,
  tenantId: string,
  quoteId: string
): Promise<any | undefined> {
  const quote = (
    await sql<any[]>`select * from commercial.quotes where tenant_id=${tenantId} and id=${quoteId}`
  )[0];
  if (!quote) return undefined;
  const lines = await sql<
    any[]
  >`select * from commercial.quote_lines where tenant_id=${tenantId} and quote_id=${quoteId} order by line_order`;
  const amount = lines.reduce(
    (sum, row) =>
      sum +
      net({
        quantityValue: asString(row.quantity_value),
        unitPriceMinor: asString(row.unit_price_minor),
        priceBasisQuantity: asString(row.price_basis_quantity),
        discountMinor: asString(row.discount_minor)
      }),
    0n
  );
  return { quote: { ...quote, commercialAmountMinor: String(amount) }, lines };
}
async function orderEnvelope(
  sql: Executor,
  tenantId: string,
  orderId: string
): Promise<any | undefined> {
  const order = (
    await sql<any[]>`select * from commercial.orders where tenant_id=${tenantId} and id=${orderId}`
  )[0];
  if (!order) return undefined;
  const lines = await sql<
    any[]
  >`select * from commercial.order_lines where tenant_id=${tenantId} and order_id=${orderId} order by line_order`;
  const allocations = await sql<
    any[]
  >`select * from commercial.order_allocations where tenant_id=${tenantId} and order_id=${orderId} order by created_at, id`;
  const fulfillments = await sql<
    any[]
  >`select * from commercial.fulfillments where tenant_id=${tenantId} and order_id=${orderId} order by created_at, id`;
  const amount = lines.reduce(
    (sum, row) =>
      sum +
      net({
        quantityValue: asString(row.ordered_quantity),
        unitPriceMinor: asString(row.unit_price_minor),
        priceBasisQuantity: asString(row.price_basis_quantity),
        discountMinor: asString(row.discount_minor)
      }),
    0n
  );
  const fulfilledRows = await sql<any[]>`
    select line.order_line_id, coalesce(sum(line.quantity_value) filter(where fulfillment.status='CONFIRMED'),0)::text quantity
    from commercial.fulfillment_lines line join commercial.fulfillments fulfillment on fulfillment.id=line.fulfillment_id
    where line.tenant_id=${tenantId} and fulfillment.order_id=${orderId} group by line.order_line_id
  `;
  const fulfilledByLine = new Map(
    fulfilledRows.map((row) => [row.order_line_id, BigInt(row.quantity)])
  );
  const fulfillmentStatus = lines.every(
    (line) => (fulfilledByLine.get(line.id) ?? 0n) === BigInt(line.ordered_quantity)
  )
    ? "FULFILLED"
    : lines.some((line) => (fulfilledByLine.get(line.id) ?? 0n) > 0n)
      ? "PARTIAL"
      : "NOT_STARTED";
  const physical = lines.some((line) => line.line_kind !== "SERVICE_SCOPE");
  const shipments = await sql<any[]>`
    select shipment.* from commercial.shipments shipment
    join commercial.fulfillments fulfillment on fulfillment.id=shipment.fulfillment_id
    where shipment.tenant_id=${tenantId} and fulfillment.order_id=${orderId}
  `;
  const shippingStatus = !physical
    ? "NOT_REQUIRED"
    : shipments.length === 0
      ? "NOT_STARTED"
      : shipments.every((s) => s.status === "DELIVERED")
        ? "DELIVERED"
        : shipments.every((s) => s.status === "SHIPPED" || s.status === "DELIVERED")
          ? "SHIPPED"
          : "PARTIAL";
  return {
    order: { ...order, commercialAmountMinor: String(amount), fulfillmentStatus, shippingStatus },
    lines,
    allocations,
    fulfillments,
    shipments
  };
}

async function fulfillmentEnvelope(
  sql: Executor,
  tenantId: string,
  fulfillmentId: string
): Promise<any | undefined> {
  const fulfillment = (
    await sql<any[]>`
      select * from commercial.fulfillments where tenant_id=${tenantId} and id=${fulfillmentId}
    `
  )[0];
  if (!fulfillment) return undefined;
  const lines = await sql<any[]>`
    select * from commercial.fulfillment_lines
    where tenant_id=${tenantId} and fulfillment_id=${fulfillmentId}
    order by created_at, id
  `;
  return { fulfillment, lines };
}

async function shipmentRecord(
  sql: Executor,
  tenantId: string,
  shipmentId: string
): Promise<any | undefined> {
  return (
    await sql<any[]>`
      select * from commercial.shipments where tenant_id=${tenantId} and id=${shipmentId}
    `
  )[0];
}

export class PostgresCommercialOrdersStore implements CommercialOrdersStore {
  constructor(private readonly sql: Sql) {}

  private async customer(
    sql: Executor,
    tenantId: string,
    customerId: string
  ): Promise<CommercialCustomer> {
    const row = (
      await sql<any[]>`
      select customer.*, contact.id contact_id, contact.full_name, contact.email, contact.phone, contact.role_title
      from lab_services.customers customer
      left join lab_services.customer_contacts contact
        on contact.tenant_id=customer.tenant_id and contact.customer_id=customer.id and contact.is_primary=true and contact.status='ACTIVE'
      where customer.tenant_id=${tenantId} and customer.id=${customerId}
    `
    )[0];
    if (!row) problem(404, "COMMERCIAL_LINE_SOURCE_INVALID", "Customer was not found.");
    return {
      id: row.id,
      status: row.status,
      customerCode: row.customer_code,
      displayName: row.display_name,
      legalName: row.legal_name,
      taxIdentifier: row.tax_identifier,
      countryCode: row.country_code,
      contact: row.contact_id
        ? {
            id: row.contact_id,
            fullName: row.full_name,
            email: row.email,
            phone: row.phone,
            roleTitle: row.role_title
          }
        : null
    };
  }
  private snapshot(customer: CommercialCustomer) {
    return {
      customerCode: customer.customerCode,
      displayName: customer.displayName,
      legalName: customer.legalName,
      taxIdentifier: customer.taxIdentifier,
      countryCode: customer.countryCode,
      contact: customer.contact
    };
  }
  private async serviceLine(
    sql: Executor,
    tenantId: string,
    id: string
  ): Promise<CommercialServiceLine> {
    const row = (
      await sql<any[]>`
      select line.*, service.status service_order_status, service.customer_id
      from lab_services.service_order_lines line join lab_services.service_orders service
        on service.tenant_id=line.tenant_id and service.id=line.service_order_id
      where line.tenant_id=${tenantId} and line.id=${id}
    `
    )[0];
    if (!row) problem(409, "COMMERCIAL_LINE_SOURCE_INVALID", "Service scope source was not found.");
    return {
      serviceOrderId: row.service_order_id,
      serviceOrderStatus: row.service_order_status,
      customerId: row.customer_id,
      lineId: row.id,
      title: row.title,
      scopeDescription: row.scope_description
    };
  }
  private async serviceOrder(sql: Executor, tenantId: string, id: string) {
    const row = (
      await sql<any[]>`
        select id, customer_id, status
        from lab_services.service_orders
        where tenant_id=${tenantId} and id=${id}
      `
    )[0];
    if (!row)
      problem(409, "COMMERCIAL_ORDER_SOURCE_MISMATCH", "Service Order source was not found.");
    return row as { id: string; customer_id: string; status: string };
  }
  private async validateContact(
    sql: Executor,
    tenantId: string,
    customerId: string,
    contactId: string | null | undefined
  ): Promise<void> {
    if (!contactId) return;
    const row = (
      await sql<any[]>`
        select customer_id from lab_services.customer_contacts
        where tenant_id=${tenantId} and id=${contactId}
      `
    )[0];
    if (!row || row.customer_id !== customerId)
      problem(409, "COMMERCIAL_ORDER_SOURCE_MISMATCH", "Customer Contact lineage conflicts.");
  }
  private async project(sql: Executor, tenantId: string, id: string): Promise<CommercialProject> {
    const row = (
      await sql<
        any[]
      >`select * from project_operations.projects where tenant_id=${tenantId} and id=${id}`
    )[0];
    if (!row)
      problem(409, "COMMERCIAL_ORDER_SOURCE_MISMATCH", "Operational Project source was not found.");
    return {
      projectId: row.id,
      projectType: row.project_type,
      status: row.status,
      sourceServiceOrderId: row.source_service_order_id
    };
  }
  private async formula(sql: Executor, tenantId: string, id: string): Promise<CommercialFormula> {
    const row = (
      await sql<any[]>`
      select version.id, formula.composition_kind, version.status, version.approval_state
      from design_studio.formula_versions version join design_studio.formulas formula on formula.tenant_id=version.tenant_id and formula.id=version.formula_id
      where version.tenant_id=${tenantId} and version.id=${id}
    `
    )[0];
    if (!row)
      problem(409, "COMMERCIAL_LINE_SOURCE_INVALID", "FormulaVersion source was not found.");
    return {
      formulaVersionId: row.id,
      compositionKind: row.composition_kind,
      status: row.status,
      approvalState: row.approval_state
    };
  }
  private async material(sql: Executor, tenantId: string, id: string): Promise<void> {
    const row = (
      await sql<any[]>`
      select id from material_intelligence.materials
      where id=${id} and (tenant_id=${tenantId} or (scope='PLATFORM' and approval_status='APPROVED') or (visibility='SHARED' and approval_status='APPROVED'))
    `
    )[0];
    if (!row) problem(409, "COMMERCIAL_LINE_SOURCE_INVALID", "Material is not tenant-accessible.");
  }
  private async validateSources(
    sql: Executor,
    context: CommercialCommandContext,
    input: HeaderInput,
    lines: readonly CommercialLineInput[],
    strictFormula: boolean
  ): Promise<CommercialCustomer> {
    const customer = await this.customer(sql, context.tenantId, input.customerId);
    if (customer.status === "ARCHIVED")
      problem(409, "COMMERCIAL_ORDER_CUSTOMER_NOT_ACTIVE", "Archived Customer cannot be used.");
    await this.validateContact(sql, context.tenantId, input.customerId, input.customerContactId);
    let serviceOrderId: string | null = input.sourceServiceOrderId ?? null;
    if (serviceOrderId) {
      const service = await this.serviceOrder(sql, context.tenantId, serviceOrderId);
      if (service.customer_id !== input.customerId)
        problem(
          409,
          "COMMERCIAL_ORDER_SOURCE_MISMATCH",
          "Service Order Customer lineage conflicts."
        );
    }
    if (input.sourceProjectId) {
      const project = await this.project(sql, context.tenantId, input.sourceProjectId);
      if (
        project.projectType === "CLIENT_SERVICE" &&
        (!project.sourceServiceOrderId ||
          (serviceOrderId && serviceOrderId !== project.sourceServiceOrderId))
      )
        problem(
          409,
          "COMMERCIAL_ORDER_SOURCE_MISMATCH",
          "Project and Service Order lineage conflicts."
        );
      serviceOrderId ??= project.sourceServiceOrderId;
      if (serviceOrderId) {
        const service = await this.serviceOrder(sql, context.tenantId, serviceOrderId);
        if (service.customer_id !== input.customerId)
          problem(
            409,
            "COMMERCIAL_ORDER_SOURCE_MISMATCH",
            "Project Service Order Customer lineage conflicts."
          );
      }
    }
    for (const line of lines) {
      if (line.lineKind === "MATERIAL") await this.material(sql, context.tenantId, line.materialId);
      if (line.lineKind === "SERVICE_SCOPE") {
        const service = await this.serviceLine(sql, context.tenantId, line.serviceOrderLineId);
        if (
          service.customerId !== input.customerId ||
          (serviceOrderId && service.serviceOrderId !== serviceOrderId)
        )
          problem(
            409,
            "COMMERCIAL_ORDER_SOURCE_MISMATCH",
            "Service scope Customer lineage conflicts."
          );
      }
      if (line.lineKind === "MANUFACTURED_PRODUCT" && strictFormula) {
        const formula = await this.formula(sql, context.tenantId, line.formulaVersionId);
        if (
          formula.compositionKind !== "FULL_FORMULA" ||
          formula.status !== "FROZEN" ||
          formula.approvalState !== "APPROVED"
        )
          problem(
            409,
            "COMMERCIAL_LINE_SOURCE_INVALID",
            "Manufactured Product requires an approved frozen FULL_FORMULA."
          );
      }
    }
    return customer;
  }
  private async requireQuote(
    sql: Executor,
    tenantId: string,
    quoteId: string,
    lock = false
  ): Promise<any> {
    const rows = lock
      ? await sql<
          any[]
        >`select * from commercial.quotes where tenant_id=${tenantId} and id=${quoteId} for update`
      : await sql<
          any[]
        >`select * from commercial.quotes where tenant_id=${tenantId} and id=${quoteId}`;
    if (!rows[0]) problem(404, "COMMERCIAL_QUOTE_NOT_FOUND", "Quote was not found.");
    return rows[0];
  }
  private async requireOrder(
    sql: Executor,
    tenantId: string,
    orderId: string,
    lock = false
  ): Promise<any> {
    const rows = lock
      ? await sql<
          any[]
        >`select * from commercial.orders where tenant_id=${tenantId} and id=${orderId} for update`
      : await sql<
          any[]
        >`select * from commercial.orders where tenant_id=${tenantId} and id=${orderId}`;
    if (!rows[0]) problem(404, "COMMERCIAL_ORDER_NOT_FOUND", "Order was not found.");
    return rows[0];
  }
  async listQuotes(tenantId: string) {
    const rows = await this.sql<
      any[]
    >`select id from commercial.quotes where tenant_id=${tenantId} order by updated_at desc, id`;
    return Promise.all(
      rows.map(async (row) => {
        const result = await quoteEnvelope(this.sql, tenantId, row.id);
        return result!.quote;
      })
    );
  }
  findQuote(tenantId: string, quoteId: string) {
    return quoteEnvelope(this.sql, tenantId, quoteId);
  }
  async createQuote(input: CommercialCommandContext & HeaderInput) {
    return this.sql.begin(async (tx) => {
      const customer = await this.validateSources(tx, input, input, input.lines, false);
      const rows = await tx<any[]>`
        insert into commercial.quotes (tenant_id,quote_number,revision_number,customer_id,customer_contact_id,source_service_order_id,source_project_id,status,currency_code,valid_until,commercial_terms,payment_terms_text,shipping_terms_text,ship_to_snapshot,created_by_user_id)
        values (${input.tenantId},${input.quoteNumber},1,${input.customerId},${input.customerContactId ?? null},${input.sourceServiceOrderId ?? null},${input.sourceProjectId ?? null},'DRAFT',${input.currencyCode},${input.validUntil ? new Date(input.validUntil) : null},${input.commercialTerms ?? null},${input.paymentTermsText ?? null},${input.shippingTermsText ?? null},${input.shipToSnapshot ? tx.json(input.shipToSnapshot as any) : null},${input.actorUserId}) returning *
      `;
      await insertQuoteLines(tx, input.tenantId, rows[0].id, input.lines);
      await audit(tx, input, "commercial.quote.created", "CommercialQuote", rows[0].id, {
        customerId: customer.id
      });
      return quoteEnvelope(tx, input.tenantId, rows[0].id);
    });
  }
  async updateQuote(input: CommercialCommandContext & { quoteId: string; changes: HeaderInput }) {
    return this.sql.begin(async (tx) => {
      const quote = await this.requireQuote(tx, input.tenantId, input.quoteId, true);
      if (quote.status !== "DRAFT")
        problem(409, "COMMERCIAL_QUOTE_NOT_EDITABLE", "Only Draft Quote can be edited.");
      const c = input.changes;
      await tx`update commercial.quotes set valid_until=${c.validUntil === undefined ? quote.valid_until : c.validUntil ? new Date(c.validUntil) : null}, commercial_terms=${c.commercialTerms === undefined ? quote.commercial_terms : c.commercialTerms}, payment_terms_text=${c.paymentTermsText === undefined ? quote.payment_terms_text : c.paymentTermsText}, shipping_terms_text=${c.shippingTermsText === undefined ? quote.shipping_terms_text : c.shippingTermsText}, ship_to_snapshot=${c.shipToSnapshot === undefined ? quote.ship_to_snapshot : c.shipToSnapshot ? tx.json(c.shipToSnapshot) : null}, updated_at=now() where id=${quote.id}`;
      if (c.lines) {
        await tx`delete from commercial.quote_lines where tenant_id=${input.tenantId} and quote_id=${quote.id}`;
        await insertQuoteLines(tx, input.tenantId, quote.id, c.lines);
      }
      await audit(tx, input, "commercial.quote.updated", "CommercialQuote", quote.id);
      return quoteEnvelope(tx, input.tenantId, quote.id);
    });
  }
  async issueQuote(input: CommercialCommandContext & { quoteId: string }) {
    return this.sql.begin(async (tx) => {
      const quote = await this.requireQuote(tx, input.tenantId, input.quoteId, true);
      if (quote.status !== "DRAFT")
        problem(409, "COMMERCIAL_QUOTE_NOT_ISSUABLE", "Quote is not Draft.");
      const lines = await tx<
        any[]
      >`select * from commercial.quote_lines where tenant_id=${input.tenantId} and quote_id=${quote.id} order by line_order`;
      if (!lines.length)
        problem(409, "COMMERCIAL_QUOTE_NOT_ISSUABLE", "Quote requires at least one line.");
      const typed = lines.map((line) => ({
        lineOrder: line.line_order,
        lineKind: line.line_kind,
        titleSnapshot: line.title_snapshot,
        descriptionSnapshot: line.description_snapshot,
        quantityValue: asString(line.quantity_value),
        unitPriceMinor: asString(line.unit_price_minor),
        priceBasisQuantity: asString(line.price_basis_quantity),
        discountMinor: asString(line.discount_minor),
        notes: line.notes,
        materialId: line.material_id,
        serviceOrderLineId: line.service_order_line_id,
        formulaVersionId: line.formula_version_id
      })) as CommercialLineInput[];
      const customer = await this.validateSources(
        tx,
        input,
        {
          ...quote,
          customerId: quote.customer_id,
          sourceServiceOrderId: quote.source_service_order_id,
          sourceProjectId: quote.source_project_id
        },
        typed,
        false
      );
      const snapshot = this.snapshot(customer);
      await tx`update commercial.quotes set status='ISSUED', issued_by_user_id=${input.actorUserId}, issued_at=now(), updated_at=now(), customer_code_snapshot=${snapshot.customerCode}, customer_display_name_snapshot=${snapshot.displayName}, customer_legal_name_snapshot=${snapshot.legalName}, customer_tax_identifier_snapshot=${snapshot.taxIdentifier}, customer_country_code_snapshot=${snapshot.countryCode}, contact_snapshot=${snapshot.contact ? tx.json(snapshot.contact as any) : null} where id=${quote.id}`;
      await audit(tx, input, "commercial.quote.issued", "CommercialQuote", quote.id);
      return quoteEnvelope(tx, input.tenantId, quote.id);
    });
  }
  async reviseQuote(input: CommercialCommandContext & { quoteId: string; quoteNumber: string }) {
    return this.sql.begin(async (tx) => {
      const quote = await this.requireQuote(tx, input.tenantId, input.quoteId, true);
      if (quote.status !== "ISSUED")
        problem(409, "COMMERCIAL_QUOTE_REVISION_INVALID", "Only Issued Quote can be revised.");
      if (input.quoteNumber !== quote.quote_number)
        problem(
          409,
          "COMMERCIAL_QUOTE_REVISION_INVALID",
          "A Quote revision retains its parent's Quote number."
        );
      const previous = await tx<
        any[]
      >`select * from commercial.quote_lines where tenant_id=${input.tenantId} and quote_id=${quote.id} order by line_order`;
      const next = (
        await tx<
          any[]
        >`select coalesce(max(revision_number),0)+1 next from commercial.quotes where tenant_id=${input.tenantId} and quote_number=${quote.quote_number}`
      )[0].next;
      const created = await tx<
        any[]
      >`insert into commercial.quotes (tenant_id,quote_number,revision_number,supersedes_quote_id,customer_id,customer_contact_id,source_service_order_id,source_project_id,status,currency_code,valid_until,commercial_terms,payment_terms_text,shipping_terms_text,ship_to_snapshot,created_by_user_id) values (${input.tenantId},${quote.quote_number},${next},${quote.id},${quote.customer_id},${quote.customer_contact_id},${quote.source_service_order_id},${quote.source_project_id},'DRAFT',${quote.currency_code},${quote.valid_until},${quote.commercial_terms},${quote.payment_terms_text},${quote.shipping_terms_text},${quote.ship_to_snapshot},${input.actorUserId}) returning *`;
      for (const l of previous)
        await tx`insert into commercial.quote_lines (tenant_id,quote_id,line_order,line_kind,title_snapshot,description_snapshot,material_id,service_order_line_id,formula_version_id,quantity_kind,quantity_value,unit_price_minor,price_basis_quantity,discount_minor,notes) values (${input.tenantId},${created[0].id},${l.line_order},${l.line_kind},${l.title_snapshot},${l.description_snapshot},${l.material_id},${l.service_order_line_id},${l.formula_version_id},${l.quantity_kind},${l.quantity_value},${l.unit_price_minor},${l.price_basis_quantity},${l.discount_minor},${l.notes})`;
      await audit(tx, input, "commercial.quote.revised", "CommercialQuote", created[0].id, {
        supersedesQuoteId: quote.id
      });
      return quoteEnvelope(tx, input.tenantId, created[0].id);
    });
  }
  async acceptQuote(input: CommercialCommandContext & { quoteId: string }) {
    return this.transitionQuote(input, "ACCEPTED", "commercial.quote.accepted");
  }
  async declineQuote(input: CommercialCommandContext & { quoteId: string }) {
    return this.transitionQuote(input, "DECLINED", "commercial.quote.declined");
  }
  async cancelQuote(input: CommercialCommandContext & { quoteId: string }) {
    return this.transitionQuote(input, "CANCELLED", "commercial.quote.cancelled", true);
  }
  private async transitionQuote(
    input: CommercialCommandContext & { quoteId: string },
    state: "ACCEPTED" | "DECLINED" | "CANCELLED",
    action: string,
    cancel = false
  ) {
    return this.sql.begin(async (tx) => {
      const quote = await this.requireQuote(tx, input.tenantId, input.quoteId, true);
      const allowed = cancel
        ? quote.status === "DRAFT" || quote.status === "ISSUED"
        : quote.status === "ISSUED";
      if (!allowed)
        problem(409, "COMMERCIAL_QUOTE_ALREADY_TERMINAL", "Quote transition is not permitted.");
      if (state === "ACCEPTED" && quote.valid_until && new Date(quote.valid_until) < now())
        problem(409, "COMMERCIAL_QUOTE_EXPIRED", "Quote has expired.");
      const column =
        state === "ACCEPTED" ? "accepted" : state === "DECLINED" ? "declined" : "cancelled";
      await tx.unsafe(
        `update commercial.quotes set status = $1, ${column}_by_user_id = $2, ${column}_at = now(), updated_at = now() where id = $3`,
        [state, input.actorUserId, quote.id]
      );
      await audit(tx, input, action, "CommercialQuote", quote.id);
      return quoteEnvelope(tx, input.tenantId, quote.id);
    });
  }
  async createOrderFromQuote(
    input: CommercialCommandContext & { quoteId: string; orderNumber: string }
  ) {
    return this.sql.begin(async (tx) => {
      const quote = await this.requireQuote(tx, input.tenantId, input.quoteId, true);
      if (quote.status !== "ACCEPTED")
        problem(
          409,
          "COMMERCIAL_QUOTE_NOT_ACCEPTABLE",
          "Quote must be accepted before Order creation."
        );
      const existing = (
        await tx<
          any[]
        >`select id from commercial.orders where tenant_id=${input.tenantId} and source_quote_id=${quote.id} for update`
      )[0];
      if (existing) return orderEnvelope(tx, input.tenantId, existing.id);
      const order = (
        await tx<
          any[]
        >`insert into commercial.orders (tenant_id,order_number,source_quote_id,customer_id,customer_contact_id,source_service_order_id,source_project_id,status,currency_code,commercial_terms,payment_terms_text,shipping_terms_text,customer_code_snapshot,customer_display_name_snapshot,customer_legal_name_snapshot,customer_tax_identifier_snapshot,customer_country_code_snapshot,contact_snapshot,ship_to_snapshot,created_by_user_id) values (${input.tenantId},${input.orderNumber},${quote.id},${quote.customer_id},${quote.customer_contact_id},${quote.source_service_order_id},${quote.source_project_id},'DRAFT',${quote.currency_code},${quote.commercial_terms},${quote.payment_terms_text},${quote.shipping_terms_text},${quote.customer_code_snapshot},${quote.customer_display_name_snapshot},${quote.customer_legal_name_snapshot},${quote.customer_tax_identifier_snapshot},${quote.customer_country_code_snapshot},${quote.contact_snapshot},${quote.ship_to_snapshot},${input.actorUserId}) returning *`
      )[0];
      const lines = await tx<
        any[]
      >`select * from commercial.quote_lines where tenant_id=${input.tenantId} and quote_id=${quote.id} order by line_order`;
      for (const l of lines)
        await tx`insert into commercial.order_lines (tenant_id,order_id,line_order,line_kind,title_snapshot,description_snapshot,material_id,service_order_line_id,formula_version_id,quantity_kind,ordered_quantity,unit_price_minor,price_basis_quantity,discount_minor,notes) values (${input.tenantId},${order.id},${l.line_order},${l.line_kind},${l.title_snapshot},${l.description_snapshot},${l.material_id},${l.service_order_line_id},${l.formula_version_id},${l.quantity_kind},${l.quantity_value},${l.unit_price_minor},${l.price_basis_quantity},${l.discount_minor},${l.notes})`;
      await audit(tx, input, "commercial.quote.order-created", "CommercialOrder", order.id, {
        quoteId: quote.id
      });
      return orderEnvelope(tx, input.tenantId, order.id);
    });
  }
  async listOrders(tenantId: string) {
    const rows = await this.sql<
      any[]
    >`select id from commercial.orders where tenant_id=${tenantId} order by updated_at desc, id`;
    return Promise.all(
      rows.map(async (row) => {
        const result = await orderEnvelope(this.sql, tenantId, row.id);
        const allocations = result!.allocations as Array<{ state: string }>;
        return {
          ...result!.order,
          allocationStatus: allocations.some((allocation) => allocation.state === "ACTIVE")
            ? "ALLOCATED"
            : allocations.some((allocation) => allocation.state === "CONSUMED")
              ? "CONSUMED"
              : "NOT_ALLOCATED"
        };
      })
    );
  }
  findOrder(tenantId: string, orderId: string) {
    return orderEnvelope(this.sql, tenantId, orderId);
  }
  async createOrder(input: CommercialCommandContext & HeaderInput) {
    return this.sql.begin(async (tx) => {
      const customer = await this.validateSources(tx, input, input, input.lines, false);
      const snapshot = this.snapshot(customer);
      const order = (
        await tx<
          any[]
        >`insert into commercial.orders (tenant_id,order_number,customer_id,customer_contact_id,source_service_order_id,source_project_id,status,currency_code,commercial_terms,payment_terms_text,shipping_terms_text,ship_to_snapshot,created_by_user_id) values (${input.tenantId},${input.orderNumber},${input.customerId},${input.customerContactId ?? null},${input.sourceServiceOrderId ?? null},${input.sourceProjectId ?? null},'DRAFT',${input.currencyCode},${input.commercialTerms ?? null},${input.paymentTermsText ?? null},${input.shippingTermsText ?? null},${input.shipToSnapshot ? tx.json(input.shipToSnapshot as any) : null},${input.actorUserId}) returning *`
      )[0];
      await insertOrderLines(tx, input.tenantId, order.id, input.lines);
      await audit(tx, input, "commercial.order.created", "CommercialOrder", order.id, {
        customerId: snapshot.customerCode
      });
      return orderEnvelope(tx, input.tenantId, order.id);
    });
  }
  async updateOrder(input: CommercialCommandContext & { orderId: string; changes: HeaderInput }) {
    return this.sql.begin(async (tx) => {
      const order = await this.requireOrder(tx, input.tenantId, input.orderId, true);
      if (order.status !== "DRAFT")
        problem(409, "COMMERCIAL_ORDER_NOT_EDITABLE", "Only Draft Order can be edited.");
      const c = input.changes;
      await tx`update commercial.orders set commercial_terms=${c.commercialTerms === undefined ? order.commercial_terms : c.commercialTerms}, payment_terms_text=${c.paymentTermsText === undefined ? order.payment_terms_text : c.paymentTermsText}, shipping_terms_text=${c.shippingTermsText === undefined ? order.shipping_terms_text : c.shippingTermsText}, ship_to_snapshot=${c.shipToSnapshot === undefined ? order.ship_to_snapshot : c.shipToSnapshot ? tx.json(c.shipToSnapshot) : null}, updated_at=now() where id=${order.id}`;
      if (c.lines) {
        await tx`delete from commercial.order_lines where tenant_id=${input.tenantId} and order_id=${order.id}`;
        await insertOrderLines(tx, input.tenantId, order.id, c.lines);
      }
      await audit(tx, input, "commercial.order.updated", "CommercialOrder", order.id);
      return orderEnvelope(tx, input.tenantId, order.id);
    });
  }
  async confirmOrder(input: CommercialCommandContext & { orderId: string }) {
    return this.sql.begin(async (tx) => {
      const order = await this.requireOrder(tx, input.tenantId, input.orderId, true);
      if (order.status !== "DRAFT")
        problem(409, "COMMERCIAL_ORDER_NOT_CONFIRMABLE", "Order is not Draft.");
      const lines = await tx<
        any[]
      >`select * from commercial.order_lines where tenant_id=${input.tenantId} and order_id=${order.id}`;
      if (!lines.length) problem(409, "COMMERCIAL_ORDER_LINES_REQUIRED", "Order requires lines.");
      const typed = lines.map((line) => ({
        lineOrder: line.line_order,
        lineKind: line.line_kind,
        titleSnapshot: line.title_snapshot,
        descriptionSnapshot: line.description_snapshot,
        quantityValue: asString(line.ordered_quantity),
        unitPriceMinor: asString(line.unit_price_minor),
        priceBasisQuantity: asString(line.price_basis_quantity),
        discountMinor: asString(line.discount_minor),
        notes: line.notes,
        materialId: line.material_id,
        serviceOrderLineId: line.service_order_line_id,
        formulaVersionId: line.formula_version_id
      })) as CommercialLineInput[];
      const customer = await this.validateSources(
        tx,
        input,
        {
          ...order,
          customerId: order.customer_id,
          sourceServiceOrderId: order.source_service_order_id,
          sourceProjectId: order.source_project_id
        },
        typed,
        true
      );
      if (customer.status !== "ACTIVE")
        problem(
          409,
          "COMMERCIAL_ORDER_CUSTOMER_NOT_ACTIVE",
          "Only active Customer can confirm an Order."
        );
      const snapshot = this.snapshot(customer);
      await tx`update commercial.orders set status='CONFIRMED', confirmed_by_user_id=${input.actorUserId}, confirmed_at=now(), updated_at=now(), customer_code_snapshot=${snapshot.customerCode}, customer_display_name_snapshot=${snapshot.displayName}, customer_legal_name_snapshot=${snapshot.legalName}, customer_tax_identifier_snapshot=${snapshot.taxIdentifier}, customer_country_code_snapshot=${snapshot.countryCode}, contact_snapshot=${snapshot.contact ? tx.json(snapshot.contact as any) : null} where id=${order.id}`;
      await audit(tx, input, "commercial.order.confirmed", "CommercialOrder", order.id);
      return orderEnvelope(tx, input.tenantId, order.id);
    });
  }
  async cancelOrder(input: CommercialCommandContext & { orderId: string; reason: string }) {
    return this.sql.begin(async (tx) => {
      const order = await this.requireOrder(tx, input.tenantId, input.orderId, true);
      if (order.status !== "DRAFT" && order.status !== "CONFIRMED")
        problem(409, "COMMERCIAL_ORDER_ALREADY_TERMINAL", "Order is terminal.");
      if (order.status === "CONFIRMED" && !input.reason.trim())
        problem(400, "COMMERCIAL_ORDER_NOT_EDITABLE", "Cancellation reason is required.");
      const allocations = await tx<
        any[]
      >`select * from commercial.order_allocations where tenant_id=${input.tenantId} and order_id=${order.id} and state='ACTIVE' for update`;
      for (const allocation of allocations) {
        if (allocation.allocation_type === "MATERIAL_LOT")
          await releaseCommercialReservationInTransaction(tx, {
            ...input,
            allocationId: allocation.id,
            reservationId: allocation.inventory_reservation_id,
            operationKey: `commercial:allocation:${allocation.id}:release`
          });
        await tx`update commercial.order_allocations set state='RELEASED', released_by_user_id=${input.actorUserId}, released_at=now() where id=${allocation.id}`;
      }
      await tx`update commercial.orders set status='CANCELLED', cancellation_reason=${input.reason || null}, cancelled_by_user_id=${input.actorUserId}, cancelled_at=now(), updated_at=now() where id=${order.id}`;
      await audit(tx, input, "commercial.order.cancelled", "CommercialOrder", order.id);
      return orderEnvelope(tx, input.tenantId, order.id);
    });
  }
  async closeOrder(input: CommercialCommandContext & { orderId: string }) {
    return this.sql.begin(async (tx) => {
      const order = await this.requireOrder(tx, input.tenantId, input.orderId, true);
      if (order.status !== "CONFIRMED")
        problem(409, "COMMERCIAL_ORDER_NOT_CLOSABLE", "Only Confirmed Order can close.");
      const envelope = await orderEnvelope(tx, input.tenantId, order.id);
      if (
        envelope.order.fulfillmentStatus !== "FULFILLED" ||
        envelope.allocations.some((a: any) => a.state === "ACTIVE") ||
        !["NOT_REQUIRED", "SHIPPED", "DELIVERED"].includes(envelope.order.shippingStatus)
      )
        problem(
          409,
          "COMMERCIAL_ORDER_NOT_CLOSABLE",
          "Order still has fulfillment, allocation, or Shipment blockers."
        );
      await tx`update commercial.orders set status='CLOSED', closed_by_user_id=${input.actorUserId}, closed_at=now(), updated_at=now() where id=${order.id}`;
      await audit(tx, input, "commercial.order.closed", "CommercialOrder", order.id);
      return orderEnvelope(tx, input.tenantId, order.id);
    });
  }
  async listAllocations(tenantId: string, orderId: string) {
    return this.sql<
      any[]
    >`select * from commercial.order_allocations where tenant_id=${tenantId} and order_id=${orderId} order by created_at,id`;
  }
  async createAllocation(input: CommercialCommandContext & HeaderInput) {
    return this.sql.begin(async (tx) => {
      const order = await this.requireOrder(tx, input.tenantId, input.orderId, true);
      if (order.status !== "CONFIRMED")
        problem(409, "COMMERCIAL_ALLOCATION_INVALID", "Only Confirmed Order can allocate.");
      const line = (
        await tx<
          any[]
        >`select * from commercial.order_lines where tenant_id=${input.tenantId} and id=${input.orderLineId} and order_id=${order.id} for update`
      )[0];
      if (!line) problem(404, "COMMERCIAL_LINE_INVALID", "Order line was not found.");
      const used = BigInt(
        (
          await tx<
            any[]
          >`select coalesce(sum(quantity_value) filter(where state in ('ACTIVE','CONSUMED')),0)::text value from commercial.order_allocations where tenant_id=${input.tenantId} and order_line_id=${line.id}`
        )[0].value
      );
      if (used + BigInt(input.quantityValue) > BigInt(line.ordered_quantity))
        problem(409, "COMMERCIAL_ALLOCATION_EXCEEDS_ORDER", "Allocation exceeds ordered quantity.");
      const allocationId = (await tx<{ id: string }[]>`select gen_random_uuid() id`)[0].id;
      if (input.allocationType === "MATERIAL_LOT") {
        if (line.line_kind !== "MATERIAL")
          problem(
            409,
            "COMMERCIAL_ALLOCATION_INVALID",
            "Material Lot allocation requires Material line."
          );
        const reservation = await reserveCommercialLotInTransaction(tx, {
          ...input,
          allocationId,
          lotId: input.materialLotId,
          materialId: line.material_id,
          locationId: input.locationId,
          quantityMg: input.quantityValue,
          operationKey: `commercial:allocation:${allocationId}:reserve`
        });
        await tx`insert into commercial.order_allocations (id,tenant_id,order_id,order_line_id,allocation_type,quantity_value,material_lot_id,location_id,inventory_reservation_id,state,created_by_user_id) values (${allocationId},${input.tenantId},${order.id},${line.id},'MATERIAL_LOT',${input.quantityValue},${input.materialLotId},${input.locationId},${reservation.id},'ACTIVE',${input.actorUserId})`;
      } else {
        if (line.line_kind !== "MANUFACTURED_PRODUCT")
          problem(
            409,
            "COMMERCIAL_ALLOCATION_INVALID",
            "Released Batch allocation requires Manufactured Product line."
          );
        const batch = (
          await tx<
            any[]
          >`select batch.*, decision.id decision_id, decision.decision from production.production_batches batch left join lateral (select * from quality_control.batch_release_decisions d where d.tenant_id=batch.tenant_id and d.batch_id=batch.id order by d.decided_at desc limit 1) decision on true where batch.tenant_id=${input.tenantId} and batch.id=${input.productionBatchId} for update of batch`
        )[0];
        if (!batch || batch.decision !== "RELEASED")
          problem(
            409,
            "COMMERCIAL_ALLOCATION_BATCH_NOT_RELEASED",
            "Batch is not currently Released."
          );
        if (batch.formula_version_id !== line.formula_version_id)
          problem(
            409,
            "COMMERCIAL_ALLOCATION_BATCH_FORMULA_MISMATCH",
            "Batch FormulaVersion does not match Order line."
          );
        const allocated = BigInt(
          (
            await tx<
              any[]
            >`select coalesce(sum(quantity_value) filter(where state in ('ACTIVE','CONSUMED')),0)::text value from commercial.order_allocations where tenant_id=${input.tenantId} and production_batch_id=${batch.id}`
          )[0].value
        );
        if (allocated + BigInt(input.quantityValue) > BigInt(batch.actual_output_mass_mg))
          problem(
            409,
            "COMMERCIAL_ALLOCATION_BATCH_OVERCOMMITTED",
            "Batch output is commercially over-allocated."
          );
        await tx`insert into commercial.order_allocations (id,tenant_id,order_id,order_line_id,allocation_type,quantity_value,production_batch_id,batch_release_decision_id,state,created_by_user_id) values (${allocationId},${input.tenantId},${order.id},${line.id},'RELEASED_BATCH',${input.quantityValue},${batch.id},${batch.decision_id},'ACTIVE',${input.actorUserId})`;
      }
      await audit(
        tx,
        input,
        "commercial.allocation.created",
        "CommercialAllocation",
        allocationId,
        {
          orderLineId: line.id,
          allocationType: input.allocationType,
          quantityValue: input.quantityValue
        }
      );
      return (
        await tx<any[]>`select * from commercial.order_allocations where id=${allocationId}`
      )[0];
    });
  }
  async releaseAllocation(input: CommercialCommandContext & { allocationId: string }) {
    return this.sql.begin(async (tx) => {
      const allocation = (
        await tx<
          any[]
        >`select * from commercial.order_allocations where tenant_id=${input.tenantId} and id=${input.allocationId} for update`
      )[0];
      if (!allocation) problem(404, "COMMERCIAL_ALLOCATION_INVALID", "Allocation was not found.");
      if (allocation.state === "CONSUMED")
        problem(409, "COMMERCIAL_ALLOCATION_NOT_ACTIVE", "Consumed allocation cannot release.");
      if (allocation.state === "ACTIVE" && allocation.allocation_type === "MATERIAL_LOT")
        await releaseCommercialReservationInTransaction(tx, {
          ...input,
          allocationId: allocation.id,
          reservationId: allocation.inventory_reservation_id,
          operationKey: `commercial:allocation:${allocation.id}:release`
        });
      if (allocation.state === "ACTIVE")
        await tx`update commercial.order_allocations set state='RELEASED', released_by_user_id=${input.actorUserId}, released_at=now() where id=${allocation.id}`;
      await audit(
        tx,
        input,
        "commercial.allocation.released",
        "CommercialAllocation",
        allocation.id
      );
      return (
        await tx<any[]>`select * from commercial.order_allocations where id=${allocation.id}`
      )[0];
    });
  }
  async listFulfillments(tenantId: string, orderId: string) {
    return this.sql<
      any[]
    >`select * from commercial.fulfillments where tenant_id=${tenantId} and order_id=${orderId} order by created_at,id`;
  }
  async createFulfillment(
    input: CommercialCommandContext & {
      orderId: string;
      fulfillmentNumber: string;
      notes?: string | null;
    }
  ) {
    return this.sql.begin(async (tx) => {
      const order = await this.requireOrder(tx, input.tenantId, input.orderId, true);
      if (order.status !== "CONFIRMED")
        problem(
          409,
          "COMMERCIAL_FULFILLMENT_NOT_EDITABLE",
          "Fulfillment requires Confirmed Order."
        );
      const value = (
        await tx<
          any[]
        >`insert into commercial.fulfillments (tenant_id,fulfillment_number,order_id,status,notes,created_by_user_id) values (${input.tenantId},${input.fulfillmentNumber},${order.id},'DRAFT',${input.notes ?? null},${input.actorUserId}) returning *`
      )[0];
      await audit(tx, input, "commercial.fulfillment.created", "CommercialFulfillment", value.id);
      return value;
    });
  }
  async findFulfillment(tenantId: string, fulfillmentId: string) {
    return fulfillmentEnvelope(this.sql, tenantId, fulfillmentId);
  }
  async updateFulfillment(
    input: CommercialCommandContext & { fulfillmentId: string; notes?: string | null }
  ) {
    return this.sql.begin(async (tx) => {
      const f = (
        await tx<
          any[]
        >`select * from commercial.fulfillments where tenant_id=${input.tenantId} and id=${input.fulfillmentId} for update`
      )[0];
      if (!f) problem(404, "COMMERCIAL_FULFILLMENT_NOT_FOUND", "Fulfillment was not found.");
      if (f.status !== "DRAFT")
        problem(409, "COMMERCIAL_FULFILLMENT_NOT_EDITABLE", "Fulfillment is immutable.");
      await tx`update commercial.fulfillments set notes=${input.notes ?? null},updated_at=now() where id=${f.id}`;
      await audit(tx, input, "commercial.fulfillment.updated", "CommercialFulfillment", f.id);
      return fulfillmentEnvelope(tx, input.tenantId, f.id);
    });
  }
  async replaceFulfillmentLines(
    input: CommercialCommandContext & {
      fulfillmentId: string;
      lines: readonly Record<string, unknown>[];
    }
  ) {
    return this.sql.begin(async (tx) => {
      const f = (
        await tx<
          any[]
        >`select * from commercial.fulfillments where tenant_id=${input.tenantId} and id=${input.fulfillmentId} for update`
      )[0];
      if (!f) problem(404, "COMMERCIAL_FULFILLMENT_NOT_FOUND", "Fulfillment was not found.");
      if (f.status !== "DRAFT")
        problem(409, "COMMERCIAL_FULFILLMENT_NOT_EDITABLE", "Fulfillment is immutable.");
      await tx`delete from commercial.fulfillment_lines where tenant_id=${input.tenantId} and fulfillment_id=${f.id}`;
      for (const raw of input.lines) {
        const l: any = raw;
        const line = (
          await tx<
            any[]
          >`select * from commercial.order_lines where tenant_id=${input.tenantId} and id=${l.orderLineId} and order_id=${f.order_id}`
        )[0];
        if (!line)
          problem(
            409,
            "COMMERCIAL_FULFILLMENT_EXCEEDS_ORDER",
            "Order line does not belong to Fulfillment Order."
          );
        if (line.line_kind === "SERVICE_SCOPE" && l.allocationId)
          problem(409, "COMMERCIAL_LINE_INVALID", "Service fulfillment cannot have allocation.");
        if (line.line_kind !== "SERVICE_SCOPE" && !l.allocationId)
          problem(409, "COMMERCIAL_LINE_INVALID", "Physical fulfillment requires allocation.");
        await tx`insert into commercial.fulfillment_lines (tenant_id,fulfillment_id,order_line_id,allocation_id,quantity_value) values (${input.tenantId},${f.id},${line.id},${l.allocationId ?? null},${l.quantityValue})`;
      }
      await audit(tx, input, "commercial.fulfillment.lines.updated", "CommercialFulfillment", f.id);
      return tx<
        any[]
      >`select * from commercial.fulfillment_lines where tenant_id=${input.tenantId} and fulfillment_id=${f.id}`;
    });
  }
  async confirmFulfillment(input: CommercialCommandContext & { fulfillmentId: string }) {
    return this.sql.begin(async (tx) => {
      const f = (
        await tx<
          any[]
        >`select * from commercial.fulfillments where tenant_id=${input.tenantId} and id=${input.fulfillmentId} for update`
      )[0];
      if (!f) problem(404, "COMMERCIAL_FULFILLMENT_NOT_FOUND", "Fulfillment was not found.");
      if (f.status === "CONFIRMED") return fulfillmentEnvelope(tx, input.tenantId, f.id);
      if (f.status !== "DRAFT")
        problem(409, "COMMERCIAL_FULFILLMENT_NOT_CONFIRMABLE", "Fulfillment is not Draft.");
      const order = await this.requireOrder(tx, input.tenantId, f.order_id, true);
      if (order.status !== "CONFIRMED")
        problem(409, "COMMERCIAL_FULFILLMENT_NOT_CONFIRMABLE", "Order is not Confirmed.");
      const lines = await tx<
        any[]
      >`select * from commercial.fulfillment_lines where tenant_id=${input.tenantId} and fulfillment_id=${f.id} for update`;
      if (!lines.length)
        problem(409, "COMMERCIAL_FULFILLMENT_NOT_CONFIRMABLE", "Fulfillment requires lines.");
      for (const x of lines) {
        const line = (
          await tx<
            any[]
          >`select * from commercial.order_lines where tenant_id=${input.tenantId} and id=${x.order_line_id} for update`
        )[0];
        const prior = BigInt(
          (
            await tx<
              any[]
            >`select coalesce(sum(fl.quantity_value),0)::text value from commercial.fulfillment_lines fl join commercial.fulfillments ff on ff.id=fl.fulfillment_id where fl.tenant_id=${input.tenantId} and fl.order_line_id=${line.id} and ff.status='CONFIRMED'`
          )[0].value
        );
        if (prior + BigInt(x.quantity_value) > BigInt(line.ordered_quantity))
          problem(
            409,
            "COMMERCIAL_FULFILLMENT_EXCEEDS_ORDER",
            "Fulfillment exceeds ordered quantity."
          );
        if (line.line_kind === "SERVICE_SCOPE") {
          const service = await this.serviceLine(tx, input.tenantId, line.service_order_line_id);
          if (service.serviceOrderStatus !== "COMPLETED")
            problem(409, "COMMERCIAL_SERVICE_NOT_COMPLETED", "Service Order is not completed.");
          continue;
        }
        const allocation = (
          await tx<
            any[]
          >`select * from commercial.order_allocations where tenant_id=${input.tenantId} and id=${x.allocation_id} and order_line_id=${line.id} for update`
        )[0];
        if (
          !allocation ||
          allocation.state !== "ACTIVE" ||
          BigInt(allocation.quantity_value) !== BigInt(x.quantity_value)
        )
          problem(
            409,
            "COMMERCIAL_ALLOCATION_NOT_ACTIVE",
            "Physical fulfillment must consume one active exact allocation."
          );
        if (allocation.allocation_type === "MATERIAL_LOT") {
          await consumeCommercialReservationInTransaction(tx, {
            ...input,
            allocationId: allocation.id,
            reservationId: allocation.inventory_reservation_id,
            operationKey: `commercial:fulfillment:${f.id}:consume:${allocation.id}`
          });
        } else {
          const batch = (
            await tx<
              any[]
            >`select decision.decision from production.production_batches batch left join lateral (select * from quality_control.batch_release_decisions d where d.tenant_id=batch.tenant_id and d.batch_id=batch.id order by d.decided_at desc limit 1) decision on true where batch.tenant_id=${input.tenantId} and batch.id=${allocation.production_batch_id}`
          )[0];
          if (!batch || batch.decision !== "RELEASED")
            problem(
              409,
              "COMMERCIAL_ALLOCATION_BATCH_NOT_RELEASED",
              "Batch is no longer Released."
            );
        }
        await tx`update commercial.order_allocations set state='CONSUMED', consumed_by_user_id=${input.actorUserId}, consumed_at=now() where id=${allocation.id}`;
        await audit(
          tx,
          input,
          "commercial.allocation.consumed",
          "CommercialAllocation",
          allocation.id
        );
      }
      await tx`update commercial.fulfillments set status='CONFIRMED',confirmed_by_user_id=${input.actorUserId},confirmed_at=now(),updated_at=now() where id=${f.id}`;
      await audit(tx, input, "commercial.fulfillment.confirmed", "CommercialFulfillment", f.id);
      return fulfillmentEnvelope(tx, input.tenantId, f.id);
    });
  }
  async cancelFulfillment(
    input: CommercialCommandContext & { fulfillmentId: string; reason?: string }
  ) {
    return this.sql.begin(async (tx) => {
      const f = (
        await tx<
          any[]
        >`select * from commercial.fulfillments where tenant_id=${input.tenantId} and id=${input.fulfillmentId} for update`
      )[0];
      if (!f) problem(404, "COMMERCIAL_FULFILLMENT_NOT_FOUND", "Fulfillment was not found.");
      if (f.status !== "DRAFT")
        problem(409, "COMMERCIAL_FULFILLMENT_NOT_EDITABLE", "Only Draft Fulfillment can cancel.");
      await tx`update commercial.fulfillments set status='CANCELLED',cancelled_by_user_id=${input.actorUserId},cancelled_at=now(),updated_at=now() where id=${f.id}`;
      await audit(tx, input, "commercial.fulfillment.cancelled", "CommercialFulfillment", f.id);
      return fulfillmentEnvelope(tx, input.tenantId, f.id);
    });
  }
  async createShipment(input: CommercialCommandContext & { fulfillmentId: string } & HeaderInput) {
    return this.sql.begin(async (tx) => {
      const f = (
        await tx<
          any[]
        >`select * from commercial.fulfillments where tenant_id=${input.tenantId} and id=${input.fulfillmentId} for update`
      )[0];
      if (!f || f.status !== "CONFIRMED")
        problem(
          409,
          "COMMERCIAL_SHIPMENT_NOT_SHIPPABLE",
          "Shipment requires Confirmed Fulfillment."
        );
      const physical = (
        await tx<
          any[]
        >`select 1 from commercial.fulfillment_lines fl join commercial.order_lines ol on ol.id=fl.order_line_id where fl.tenant_id=${input.tenantId} and fl.fulfillment_id=${f.id} and ol.line_kind <> 'SERVICE_SCOPE' limit 1`
      )[0];
      if (!physical)
        problem(
          409,
          "COMMERCIAL_SHIPMENT_NOT_SHIPPABLE",
          "Service-only Fulfillment does not ship."
        );
      const existing = (
        await tx<
          any[]
        >`select id from commercial.shipments where tenant_id=${input.tenantId} and fulfillment_id=${f.id} for update`
      )[0];
      if (existing)
        problem(
          409,
          "COMMERCIAL_SHIPMENT_NOT_SHIPPABLE",
          "A Fulfillment has at most one Shipment."
        );
      const value = (
        await tx<
          any[]
        >`insert into commercial.shipments (tenant_id,shipment_number,fulfillment_id,status,ship_to_snapshot,carrier_name,service_level,tracking_number,notes,created_by_user_id) values (${input.tenantId},${input.shipmentNumber},${f.id},'DRAFT',${tx.json(input.shipToSnapshot)},${input.carrierName ?? null},${input.serviceLevel ?? null},${input.trackingNumber ?? null},${input.notes ?? null},${input.actorUserId}) returning *`
      )[0];
      await audit(tx, input, "commercial.shipment.created", "CommercialShipment", value.id);
      return value;
    });
  }
  async findShipment(tenantId: string, shipmentId: string) {
    return shipmentRecord(this.sql, tenantId, shipmentId);
  }
  async updateShipment(
    input: CommercialCommandContext & { shipmentId: string; changes: HeaderInput }
  ) {
    return this.sql.begin(async (tx) => {
      const s = (
        await tx<
          any[]
        >`select * from commercial.shipments where tenant_id=${input.tenantId} and id=${input.shipmentId} for update`
      )[0];
      if (!s) problem(404, "COMMERCIAL_SHIPMENT_NOT_FOUND", "Shipment was not found.");
      if (s.status !== "DRAFT")
        problem(409, "COMMERCIAL_SHIPMENT_NOT_EDITABLE", "Shipment is immutable.");
      const c = input.changes;
      await tx`update commercial.shipments set carrier_name=${c.carrierName === undefined ? s.carrier_name : c.carrierName},service_level=${c.serviceLevel === undefined ? s.service_level : c.serviceLevel},tracking_number=${c.trackingNumber === undefined ? s.tracking_number : c.trackingNumber},notes=${c.notes === undefined ? s.notes : c.notes},updated_at=now() where id=${s.id}`;
      await audit(tx, input, "commercial.shipment.updated", "CommercialShipment", s.id);
      return shipmentRecord(tx, input.tenantId, s.id);
    });
  }
  private async transitionShipment(
    input: CommercialCommandContext & { shipmentId: string },
    target: "SHIPPED" | "DELIVERED" | "CANCELLED",
    action: string,
    reason?: string
  ) {
    return this.sql.begin(async (tx) => {
      const s = (
        await tx<
          any[]
        >`select * from commercial.shipments where tenant_id=${input.tenantId} and id=${input.shipmentId} for update`
      )[0];
      if (!s) problem(404, "COMMERCIAL_SHIPMENT_NOT_FOUND", "Shipment was not found.");
      if (
        (target === "SHIPPED" && s.status !== "DRAFT") ||
        (target === "DELIVERED" && s.status !== "SHIPPED") ||
        (target === "CANCELLED" && s.status !== "DRAFT")
      )
        problem(
          409,
          target === "DELIVERED"
            ? "COMMERCIAL_SHIPMENT_NOT_DELIVERABLE"
            : "COMMERCIAL_SHIPMENT_NOT_SHIPPABLE",
          "Shipment transition is not permitted."
        );
      const column =
        target === "SHIPPED" ? "shipped" : target === "DELIVERED" ? "delivered" : "cancelled";
      await tx.unsafe(
        `update commercial.shipments set status=$1, ${column}_by_user_id=$2, ${column}_at=now(), cancellation_reason=$3, updated_at=now() where id=$4`,
        [target, input.actorUserId, target === "CANCELLED" ? reason : null, s.id]
      );
      await audit(tx, input, action, "CommercialShipment", s.id);
      return shipmentRecord(tx, input.tenantId, s.id);
    });
  }
  shipShipment(input: CommercialCommandContext & { shipmentId: string }) {
    return this.transitionShipment(input, "SHIPPED", "commercial.shipment.shipped");
  }
  deliverShipment(input: CommercialCommandContext & { shipmentId: string }) {
    return this.transitionShipment(input, "DELIVERED", "commercial.shipment.delivered");
  }
  cancelShipment(input: CommercialCommandContext & { shipmentId: string; reason: string }) {
    return this.transitionShipment(
      input,
      "CANCELLED",
      "commercial.shipment.cancelled",
      input.reason
    );
  }
  async listCommercialOrders(input: {
    tenantId: string;
    from?: string;
    to?: string;
  }): Promise<readonly CommercialAnalyticsOrder[]> {
    const rows = await this.sql<
      any[]
    >`select * from commercial.orders where tenant_id=${input.tenantId} and (${input.from ?? null}::timestamptz is null or created_at >= ${input.from ?? null}::timestamptz) and (${input.to ?? null}::timestamptz is null or created_at <= ${input.to ?? null}::timestamptz) order by created_at`;
    const result: CommercialAnalyticsOrder[] = [];
    for (const row of rows) {
      const e = await orderEnvelope(this.sql, input.tenantId, row.id);
      result.push({
        orderId: row.id,
        orderNumber: row.order_number,
        customerId: row.customer_id,
        currencyCode: row.currency_code,
        commercialStatus: row.status,
        fulfillmentStatus: e.order.fulfillmentStatus,
        shippingStatus: e.order.shippingStatus,
        commercialAmountMinor: e.order.commercialAmountMinor,
        confirmedAt: row.confirmed_at?.toISOString?.() ?? null,
        closedAt: row.closed_at?.toISOString?.() ?? null,
        sourceProjectId: row.source_project_id
      });
    }
    return result;
  }
}

export const createPostgresCommercialOrdersStore = (sql: Sql) =>
  new PostgresCommercialOrdersStore(sql);
