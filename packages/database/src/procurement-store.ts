import type { Sql, TransactionSql } from "postgres";
import {
  ProcurementProblem,
  canonicalDecimal,
  multiplyPricePerKgByMassMg,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type ProcurementCommandContext,
  type ProcurementMaterialReference,
  type ProcurementMaterialSource,
  type ProcurementStore,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type Supplier,
  type SupplierMaterialOffer
} from "@nox-os/procurement";
import type { QuantityMg } from "@nox-os/inventory";
import {
  PostgresInventoryMaterialSource,
  receiveProcurementLotInTransaction
} from "./inventory-store.js";

type SqlExecutor = Sql | TransactionSql;

type SupplierRow = {
  id: string;
  tenant_id: string;
  supplier_code: string;
  legal_name: string;
  display_name: string;
  country_code: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  website: string | null;
  tax_identifier: string | null;
  default_currency: string | null;
  default_incoterm: string | null;
  status: Supplier["status"];
  notes: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

type OfferRow = {
  id: string;
  tenant_id: string;
  supplier_id: string;
  material_id: string;
  display_name: string;
  approval_status: SupplierMaterialOffer["materialApprovalStatus"];
  supplier_sku: string | null;
  supplier_material_name: string;
  pack_size_mg: string | bigint | null;
  minimum_order_quantity_mg: string | bigint | null;
  unit_price_per_kg: string | null;
  currency_code: string | null;
  lead_time_days: number | null;
  status: SupplierMaterialOffer["status"];
  last_quoted_at: Date | null;
  source_reference: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

type PurchaseOrderRow = {
  id: string;
  tenant_id: string;
  po_number: string;
  supplier_id: string;
  supplier_display_name: string;
  order_type: PurchaseOrder["orderType"];
  currency_code: string;
  status: PurchaseOrder["status"];
  supplier_quote_reference: string | null;
  expected_delivery_at: Date | null;
  incoterm: string | null;
  freight_amount: string | null;
  notes: string | null;
  created_by_user_id: string;
  approved_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  approved_at: Date | null;
  closed_at: Date | null;
  cancelled_at: Date | null;
};

type PurchaseOrderLineRow = {
  id: string;
  tenant_id: string;
  purchase_order_id: string;
  line_order: number;
  material_id: string;
  material_display_name: string;
  supplier_offer_id: string | null;
  supplier_sku_snapshot: string | null;
  supplier_material_name_snapshot: string;
  ordered_quantity_mg: string | bigint;
  received_quantity_mg: string | bigint;
  unit_price_per_kg: string;
  expected_delivery_at: Date | null;
  notes: string | null;
  created_at: Date;
};

type GoodsReceiptRow = {
  id: string;
  tenant_id: string;
  receipt_number: string;
  purchase_order_id: string;
  purchase_order_number: string;
  supplier_id: string;
  supplier_display_name: string;
  supplier_delivery_reference: string | null;
  status: GoodsReceipt["status"];
  received_at: Date;
  created_by_user_id: string;
  posted_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  posted_at: Date | null;
  cancelled_at: Date | null;
};

type GoodsReceiptLineRow = {
  id: string;
  tenant_id: string;
  goods_receipt_id: string;
  purchase_order_line_id: string;
  material_id: string;
  material_display_name: string;
  received_quantity_mg: string | bigint;
  lot_code: string;
  supplier_lot_code: string | null;
  manufactured_at: Date | null;
  expires_at: Date | null;
  retest_at: Date | null;
  destination_location_id: string;
  inventory_lot_id: string | null;
  inventory_movement_id: string | null;
  created_at: Date;
};

function date(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function supplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    supplierCode: row.supplier_code,
    legalName: row.legal_name,
    displayName: row.display_name,
    countryCode: row.country_code,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    website: row.website,
    taxIdentifier: row.tax_identifier,
    defaultCurrency: row.default_currency,
    defaultIncoterm: row.default_incoterm,
    status: row.status,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function offer(row: OfferRow): SupplierMaterialOffer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    supplierId: row.supplier_id,
    materialId: row.material_id,
    materialDisplayName: row.display_name,
    materialApprovalStatus: row.approval_status,
    supplierSku: row.supplier_sku,
    supplierMaterialName: row.supplier_material_name,
    packSizeMg: row.pack_size_mg === null ? null : (String(row.pack_size_mg) as QuantityMg),
    minimumOrderQuantityMg:
      row.minimum_order_quantity_mg === null
        ? null
        : (String(row.minimum_order_quantity_mg) as QuantityMg),
    unitPricePerKg: row.unit_price_per_kg,
    currencyCode: row.currency_code,
    leadTimeDays: row.lead_time_days,
    status: row.status,
    lastQuotedAt: row.last_quoted_at,
    sourceReference: row.source_reference,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function purchaseOrderLine(row: PurchaseOrderLineRow): PurchaseOrderLine {
  const ordered = String(row.ordered_quantity_mg);
  const received = String(row.received_quantity_mg);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    purchaseOrderId: row.purchase_order_id,
    lineOrder: row.line_order,
    materialId: row.material_id,
    materialDisplayName: row.material_display_name,
    supplierOfferId: row.supplier_offer_id,
    supplierSkuSnapshot: row.supplier_sku_snapshot,
    supplierMaterialNameSnapshot: row.supplier_material_name_snapshot,
    orderedQuantityMg: ordered as QuantityMg,
    receivedQuantityMg: received,
    remainingQuantityMg: (BigInt(ordered) - BigInt(received)).toString(),
    unitPricePerKg: row.unit_price_per_kg,
    lineAmount: multiplyPricePerKgByMassMg(row.unit_price_per_kg, ordered),
    expectedDeliveryAt: row.expected_delivery_at,
    notes: row.notes,
    createdAt: row.created_at
  };
}

function goodsReceiptLine(row: GoodsReceiptLineRow): GoodsReceiptLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    goodsReceiptId: row.goods_receipt_id,
    purchaseOrderLineId: row.purchase_order_line_id,
    materialId: row.material_id,
    materialDisplayName: row.material_display_name,
    receivedQuantityMg: String(row.received_quantity_mg) as QuantityMg,
    lotCode: row.lot_code,
    supplierLotCode: row.supplier_lot_code,
    manufacturedAt: row.manufactured_at,
    expiresAt: row.expires_at,
    retestAt: row.retest_at,
    destinationLocationId: row.destination_location_id,
    inventoryLotId: row.inventory_lot_id,
    inventoryMovementId: row.inventory_movement_id,
    createdAt: row.created_at
  };
}

async function audit(
  sql: SqlExecutor,
  input: ProcurementCommandContext & {
    action: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await sql`
    insert into platform.audit_events (
      tenant_id, actor_user_id, action, resource_type, resource_id,
      request_id, correlation_id, metadata
    ) values (
      ${input.tenantId}, ${input.actorUserId}, ${input.action}, ${input.resourceType},
      ${input.resourceId}, ${input.requestId}, ${input.correlationId},
      ${sql.json(JSON.parse(JSON.stringify(input.metadata ?? {})) as never)}
    )
  `;
}

async function loadPurchaseOrder(
  sql: SqlExecutor,
  tenantId: string,
  purchaseOrderId: string
): Promise<PurchaseOrder | undefined> {
  const headers = await sql<PurchaseOrderRow[]>`
    select po.*, supplier.display_name as supplier_display_name
    from procurement.purchase_orders as po
    join procurement.suppliers as supplier
      on supplier.tenant_id = po.tenant_id and supplier.id = po.supplier_id
    where po.tenant_id = ${tenantId} and po.id = ${purchaseOrderId}
  `;
  if (!headers[0]) return undefined;
  const lines = await sql<PurchaseOrderLineRow[]>`
    select line.*, material.display_name as material_display_name,
      coalesce(sum(receipt_line.received_quantity_mg)
        filter (where receipt.status = 'POSTED'), 0)::bigint as received_quantity_mg
    from procurement.purchase_order_lines as line
    join material_intelligence.materials as material on material.id = line.material_id
    left join procurement.goods_receipt_lines as receipt_line
      on receipt_line.tenant_id = line.tenant_id
      and receipt_line.purchase_order_line_id = line.id
    left join procurement.goods_receipts as receipt
      on receipt.tenant_id = receipt_line.tenant_id
      and receipt.id = receipt_line.goods_receipt_id
    where line.tenant_id = ${tenantId} and line.purchase_order_id = ${purchaseOrderId}
    group by line.id, material.display_name
    order by line.line_order
  `;
  const row = headers[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    poNumber: row.po_number,
    supplierId: row.supplier_id,
    supplierDisplayName: row.supplier_display_name,
    orderType: row.order_type,
    currencyCode: row.currency_code,
    status: row.status,
    supplierQuoteReference: row.supplier_quote_reference,
    expectedDeliveryAt: row.expected_delivery_at,
    incoterm: row.incoterm,
    freightAmount: row.freight_amount,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    approvedByUserId: row.approved_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    closedAt: row.closed_at,
    cancelledAt: row.cancelled_at,
    lines: lines.map(purchaseOrderLine)
  };
}

async function loadGoodsReceipt(
  sql: SqlExecutor,
  tenantId: string,
  receiptId: string
): Promise<GoodsReceipt | undefined> {
  const headers = await sql<GoodsReceiptRow[]>`
    select receipt.*, po.po_number as purchase_order_number,
      supplier.display_name as supplier_display_name
    from procurement.goods_receipts as receipt
    join procurement.purchase_orders as po
      on po.tenant_id = receipt.tenant_id and po.id = receipt.purchase_order_id
    join procurement.suppliers as supplier
      on supplier.tenant_id = receipt.tenant_id and supplier.id = receipt.supplier_id
    where receipt.tenant_id = ${tenantId} and receipt.id = ${receiptId}
  `;
  if (!headers[0]) return undefined;
  const lines = await sql<GoodsReceiptLineRow[]>`
    select line.*, material.display_name as material_display_name
    from procurement.goods_receipt_lines as line
    join material_intelligence.materials as material on material.id = line.material_id
    where line.tenant_id = ${tenantId} and line.goods_receipt_id = ${receiptId}
    order by line.created_at, line.id
  `;
  const row = headers[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    receiptNumber: row.receipt_number,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderNumber: row.purchase_order_number,
    supplierId: row.supplier_id,
    supplierDisplayName: row.supplier_display_name,
    supplierDeliveryReference: row.supplier_delivery_reference,
    status: row.status,
    receivedAt: row.received_at,
    createdByUserId: row.created_by_user_id,
    postedByUserId: row.posted_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    postedAt: row.posted_at,
    cancelledAt: row.cancelled_at,
    lines: lines.map(goodsReceiptLine)
  };
}

async function requireSupplier(
  sql: SqlExecutor,
  tenantId: string,
  supplierId: string,
  lock = false
): Promise<SupplierRow> {
  const rows = lock
    ? await sql<SupplierRow[]>`
        select * from procurement.suppliers
        where tenant_id = ${tenantId} and id = ${supplierId} for update
      `
    : await sql<SupplierRow[]>`
        select * from procurement.suppliers where tenant_id = ${tenantId} and id = ${supplierId}
      `;
  if (!rows[0]) throw new ProcurementProblem(404, "SUPPLIER_NOT_FOUND", "Supplier was not found.");
  return rows[0];
}

async function insertPurchaseOrderLines(
  tx: TransactionSql,
  input: ProcurementCommandContext & {
    purchaseOrderId: string;
    lines: Parameters<ProcurementStore["createPurchaseOrder"]>[0]["lines"];
  }
): Promise<void> {
  for (const [index, line] of input.lines.entries()) {
    await tx`
      insert into procurement.purchase_order_lines (
        tenant_id, purchase_order_id, line_order, material_id, supplier_offer_id,
        supplier_sku_snapshot, supplier_material_name_snapshot, ordered_quantity_mg,
        unit_price_per_kg, expected_delivery_at, notes
      ) values (
        ${input.tenantId}, ${input.purchaseOrderId}, ${index + 1}, ${line.materialId},
        ${line.supplierOfferId ?? null}, ${line.supplierSkuSnapshot ?? null},
        ${line.supplierMaterialNameSnapshot}, ${line.orderedQuantityMg},
        ${canonicalDecimal(line.unitPricePerKg)}, ${date(line.expectedDeliveryAt)}, ${line.notes ?? null}
      )
    `;
  }
}

async function insertGoodsReceiptLines(
  tx: TransactionSql,
  input: ProcurementCommandContext & {
    receiptId: string;
    lines: Parameters<ProcurementStore["createGoodsReceipt"]>[0]["lines"];
  }
): Promise<void> {
  for (const line of input.lines) {
    await tx`
      insert into procurement.goods_receipt_lines (
        tenant_id, goods_receipt_id, purchase_order_line_id, material_id,
        received_quantity_mg, lot_code, supplier_lot_code, manufactured_at,
        expires_at, retest_at, destination_location_id
      ) values (
        ${input.tenantId}, ${input.receiptId}, ${line.purchaseOrderLineId},
        ${line.materialId}, ${line.receivedQuantityMg}, ${line.lotCode},
        ${line.supplierLotCode ?? null}, ${date(line.manufacturedAt)},
        ${date(line.expiresAt)}, ${date(line.retestAt)}, ${line.destinationLocationId}
      )
    `;
  }
}

export class PostgresProcurementMaterialSource implements ProcurementMaterialSource {
  private readonly inventorySource: PostgresInventoryMaterialSource;
  constructor(sql: Sql) {
    this.inventorySource = new PostgresInventoryMaterialSource(sql);
  }
  async findTenantAccessibleMaterial(
    tenantId: string,
    materialId: string
  ): Promise<ProcurementMaterialReference | undefined> {
    return this.inventorySource.findTenantAccessibleMaterial(tenantId, materialId);
  }
}

export class PostgresProcurementStore implements ProcurementStore {
  constructor(private readonly sql: Sql) {}

  async listSuppliers(tenantId: string): Promise<Supplier[]> {
    const rows = await this.sql<SupplierRow[]>`
      select * from procurement.suppliers where tenant_id = ${tenantId}
      order by display_name, supplier_code
    `;
    return rows.map(supplier);
  }

  async findSupplier(tenantId: string, supplierId: string): Promise<Supplier | undefined> {
    const rows = await this.sql<SupplierRow[]>`
      select * from procurement.suppliers where tenant_id = ${tenantId} and id = ${supplierId}
    `;
    return rows[0] ? supplier(rows[0]) : undefined;
  }

  createSupplier(input: Parameters<ProcurementStore["createSupplier"]>[0]): Promise<Supplier> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<SupplierRow[]>`
        insert into procurement.suppliers (
          tenant_id, supplier_code, legal_name, display_name, country_code,
          primary_email, primary_phone, website, tax_identifier, default_currency,
          default_incoterm, notes, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.supplierCode}, ${input.legalName}, ${input.displayName},
          ${input.countryCode ?? null}, ${input.primaryEmail ?? null}, ${input.primaryPhone ?? null},
          ${input.website ?? null}, ${input.taxIdentifier ?? null}, ${input.defaultCurrency ?? null},
          ${input.defaultIncoterm ?? null}, ${input.notes ?? null}, ${input.actorUserId}
        ) returning *
      `;
      await audit(tx, {
        ...input,
        action: "procurement.supplier.created",
        resourceType: "Supplier",
        resourceId: rows[0].id
      });
      return supplier(rows[0]);
    });
  }

  updateSupplier(input: Parameters<ProcurementStore["updateSupplier"]>[0]): Promise<Supplier> {
    return this.sql.begin(async (tx) => {
      const current = await requireSupplier(tx, input.tenantId, input.supplierId, true);
      const value = { ...supplier(current), ...input.changes };
      const rows = await tx<SupplierRow[]>`
        update procurement.suppliers set
          legal_name = ${value.legalName}, display_name = ${value.displayName},
          country_code = ${value.countryCode}, primary_email = ${value.primaryEmail},
          primary_phone = ${value.primaryPhone}, website = ${value.website},
          tax_identifier = ${value.taxIdentifier}, default_currency = ${value.defaultCurrency},
          default_incoterm = ${value.defaultIncoterm}, status = ${value.status},
          notes = ${value.notes}, updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.supplierId}
        returning *
      `;
      const action =
        current.status !== rows[0].status && rows[0].status === "HOLD"
          ? "procurement.supplier.held"
          : current.status !== rows[0].status && rows[0].status === "ARCHIVED"
            ? "procurement.supplier.archived"
            : "procurement.supplier.updated";
      await audit(tx, {
        ...input,
        action,
        resourceType: "Supplier",
        resourceId: input.supplierId
      });
      return supplier(rows[0]);
    });
  }

  async listSupplierOffers(
    tenantId: string,
    supplierId?: string
  ): Promise<SupplierMaterialOffer[]> {
    const rows = supplierId
      ? await this.sql<OfferRow[]>`
          select offer.*, material.display_name, material.approval_status
          from procurement.supplier_material_offers as offer
          join material_intelligence.materials as material on material.id = offer.material_id
          where offer.tenant_id = ${tenantId} and offer.supplier_id = ${supplierId}
          order by offer.supplier_material_name
        `
      : await this.sql<OfferRow[]>`
          select offer.*, material.display_name, material.approval_status
          from procurement.supplier_material_offers as offer
          join material_intelligence.materials as material on material.id = offer.material_id
          where offer.tenant_id = ${tenantId}
          order by offer.supplier_material_name
        `;
    return rows.map(offer);
  }

  createSupplierOffer(
    input: Parameters<ProcurementStore["createSupplierOffer"]>[0]
  ): Promise<SupplierMaterialOffer> {
    return this.sql.begin(async (tx) => {
      const owner = await requireSupplier(tx, input.tenantId, input.supplierId, true);
      if (owner.status === "ARCHIVED")
        throw new ProcurementProblem(409, "SUPPLIER_ARCHIVED", "Supplier is archived.");
      const rows = await tx<{ id: string }[]>`
        insert into procurement.supplier_material_offers (
          tenant_id, supplier_id, material_id, supplier_sku, supplier_material_name,
          pack_size_mg, minimum_order_quantity_mg, unit_price_per_kg, currency_code,
          lead_time_days, last_quoted_at, source_reference, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.supplierId}, ${input.materialId}, ${input.supplierSku ?? null},
          ${input.supplierMaterialName}, ${input.packSizeMg ?? null},
          ${input.minimumOrderQuantityMg ?? null},
          ${input.unitPricePerKg === null || input.unitPricePerKg === undefined ? null : canonicalDecimal(input.unitPricePerKg)},
          ${input.currencyCode ?? null}, ${input.leadTimeDays ?? null}, ${date(input.lastQuotedAt)},
          ${input.sourceReference ?? null}, ${input.actorUserId}
        ) returning id
      `;
      await audit(tx, {
        ...input,
        action: "procurement.offer.created",
        resourceType: "SupplierMaterialOffer",
        resourceId: rows[0].id
      });
      const values = await new PostgresProcurementStore(tx as unknown as Sql).listSupplierOffers(
        input.tenantId,
        input.supplierId
      );
      return values.find((item) => item.id === rows[0].id)!;
    });
  }

  updateSupplierOffer(
    input: Parameters<ProcurementStore["updateSupplierOffer"]>[0]
  ): Promise<SupplierMaterialOffer> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<OfferRow[]>`
        select offer.*, material.display_name, material.approval_status
        from procurement.supplier_material_offers as offer
        join material_intelligence.materials as material on material.id = offer.material_id
        where offer.tenant_id = ${input.tenantId} and offer.id = ${input.offerId}
        for update of offer
      `;
      if (!rows[0])
        throw new ProcurementProblem(404, "SUPPLIER_OFFER_NOT_FOUND", "Offer was not found.");
      const current = offer(rows[0]);
      const value = { ...current, ...input.changes };
      await tx`
        update procurement.supplier_material_offers set
          supplier_sku = ${value.supplierSku}, supplier_material_name = ${value.supplierMaterialName},
          pack_size_mg = ${value.packSizeMg}, minimum_order_quantity_mg = ${value.minimumOrderQuantityMg},
          unit_price_per_kg = ${value.unitPricePerKg === null ? null : canonicalDecimal(value.unitPricePerKg)},
          currency_code = ${value.currencyCode}, lead_time_days = ${value.leadTimeDays},
          status = ${value.status}, last_quoted_at = ${value.lastQuotedAt},
          source_reference = ${value.sourceReference}, updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.offerId}
      `;
      await audit(tx, {
        ...input,
        action: "procurement.offer.updated",
        resourceType: "SupplierMaterialOffer",
        resourceId: input.offerId
      });
      const values = await new PostgresProcurementStore(tx as unknown as Sql).listSupplierOffers(
        input.tenantId,
        current.supplierId
      );
      return values.find((item) => item.id === input.offerId)!;
    });
  }

  async listPurchaseOrders(tenantId: string): Promise<PurchaseOrder[]> {
    const rows = await this.sql<{ id: string }[]>`
      select id from procurement.purchase_orders where tenant_id = ${tenantId}
      order by updated_at desc, id
    `;
    return Promise.all(rows.map((row) => loadPurchaseOrder(this.sql, tenantId, row.id))) as Promise<
      PurchaseOrder[]
    >;
  }

  findPurchaseOrder(tenantId: string, purchaseOrderId: string) {
    return loadPurchaseOrder(this.sql, tenantId, purchaseOrderId);
  }

  createPurchaseOrder(
    input: Parameters<ProcurementStore["createPurchaseOrder"]>[0]
  ): Promise<PurchaseOrder> {
    return this.sql.begin(async (tx) => {
      const owner = await requireSupplier(tx, input.tenantId, input.supplierId, true);
      if (owner.status === "ARCHIVED")
        throw new ProcurementProblem(409, "SUPPLIER_ARCHIVED", "Supplier is archived.");
      const rows = await tx<{ id: string }[]>`
        insert into procurement.purchase_orders (
          tenant_id, po_number, supplier_id, order_type, currency_code,
          supplier_quote_reference, expected_delivery_at, incoterm, freight_amount,
          notes, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.poNumber}, ${input.supplierId}, ${input.orderType},
          ${input.currencyCode}, ${input.supplierQuoteReference ?? null},
          ${date(input.expectedDeliveryAt)}, ${input.incoterm ?? null},
          ${input.freightAmount === null || input.freightAmount === undefined ? null : canonicalDecimal(input.freightAmount)},
          ${input.notes ?? null}, ${input.actorUserId}
        ) returning id
      `;
      await insertPurchaseOrderLines(tx, {
        ...input,
        purchaseOrderId: rows[0].id,
        lines: input.lines
      });
      await audit(tx, {
        ...input,
        action: "procurement.purchase_order.created",
        resourceType: "PurchaseOrder",
        resourceId: rows[0].id
      });
      return (await loadPurchaseOrder(tx, input.tenantId, rows[0].id))!;
    });
  }

  updatePurchaseOrder(
    input: Parameters<ProcurementStore["updatePurchaseOrder"]>[0]
  ): Promise<PurchaseOrder> {
    return this.sql.begin(async (tx) => {
      const current = await loadPurchaseOrder(tx, input.tenantId, input.purchaseOrderId);
      if (!current)
        throw new ProcurementProblem(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase Order not found.");
      if (current.status !== "DRAFT")
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_NOT_EDITABLE",
          "Approved Purchase Order commercial terms are immutable."
        );
      const value = { ...current, ...input.changes };
      await tx`
        update procurement.purchase_orders set
          supplier_id = ${value.supplierId}, order_type = ${value.orderType},
          currency_code = ${value.currencyCode}, supplier_quote_reference = ${value.supplierQuoteReference},
          expected_delivery_at = ${value.expectedDeliveryAt}, incoterm = ${value.incoterm},
          freight_amount = ${value.freightAmount}, notes = ${value.notes}, updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId}
      `;
      if (input.changes.lines) {
        await tx`delete from procurement.purchase_order_lines where tenant_id = ${input.tenantId} and purchase_order_id = ${input.purchaseOrderId}`;
        await insertPurchaseOrderLines(tx, {
          ...input,
          purchaseOrderId: input.purchaseOrderId,
          lines: input.changes.lines
        });
      }
      await audit(tx, {
        ...input,
        action: "procurement.purchase_order.updated",
        resourceType: "PurchaseOrder",
        resourceId: input.purchaseOrderId
      });
      return (await loadPurchaseOrder(tx, input.tenantId, input.purchaseOrderId))!;
    });
  }

  approvePurchaseOrder(
    input: Parameters<ProcurementStore["approvePurchaseOrder"]>[0]
  ): Promise<PurchaseOrder> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<{ supplier_id: string; status: string }[]>`
        select supplier_id, status from procurement.purchase_orders
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId} for update
      `;
      if (!rows[0])
        throw new ProcurementProblem(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase Order not found.");
      if (rows[0].status !== "DRAFT")
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_NOT_APPROVABLE",
          "Purchase Order is not DRAFT."
        );
      const owner = await requireSupplier(tx, input.tenantId, rows[0].supplier_id, true);
      if (owner.status === "HOLD")
        throw new ProcurementProblem(409, "SUPPLIER_ON_HOLD", "Supplier is on hold.");
      if (owner.status === "ARCHIVED")
        throw new ProcurementProblem(409, "SUPPLIER_ARCHIVED", "Supplier is archived.");
      const lineCount = await tx<{ count: string }[]>`
        select count(*)::text as count from procurement.purchase_order_lines
        where tenant_id = ${input.tenantId} and purchase_order_id = ${input.purchaseOrderId}
      `;
      if (lineCount[0].count === "0")
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_NOT_APPROVABLE",
          "Purchase Order has no lines."
        );
      await tx`
        update procurement.purchase_orders set status = 'APPROVED', approved_by_user_id = ${input.actorUserId},
          approved_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId}
      `;
      await audit(tx, {
        ...input,
        action: "procurement.purchase_order.approved",
        resourceType: "PurchaseOrder",
        resourceId: input.purchaseOrderId
      });
      return (await loadPurchaseOrder(tx, input.tenantId, input.purchaseOrderId))!;
    });
  }

  cancelPurchaseOrder(
    input: Parameters<ProcurementStore["cancelPurchaseOrder"]>[0]
  ): Promise<PurchaseOrder> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<{ status: PurchaseOrder["status"] }[]>`
        select status from procurement.purchase_orders
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId} for update
      `;
      if (!rows[0])
        throw new ProcurementProblem(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase Order not found.");
      if (!["DRAFT", "APPROVED"].includes(rows[0].status))
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_ALREADY_TERMINAL",
          "Purchase Order cannot be cancelled."
        );
      const receipts = await tx<{ count: string }[]>`
        select count(*)::text as count from procurement.goods_receipts
        where tenant_id = ${input.tenantId} and purchase_order_id = ${input.purchaseOrderId}
          and status = 'POSTED'
      `;
      if (receipts[0].count !== "0")
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_HAS_RECEIPTS",
          "Purchase Order has posted receipts."
        );
      await tx`
        update procurement.purchase_orders set status = 'CANCELLED', cancelled_at = now(),
          updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId}
      `;
      await audit(tx, {
        ...input,
        action: "procurement.purchase_order.cancelled",
        resourceType: "PurchaseOrder",
        resourceId: input.purchaseOrderId
      });
      return (await loadPurchaseOrder(tx, input.tenantId, input.purchaseOrderId))!;
    });
  }

  closePurchaseOrder(
    input: Parameters<ProcurementStore["closePurchaseOrder"]>[0]
  ): Promise<PurchaseOrder> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<{ status: PurchaseOrder["status"] }[]>`
        select status from procurement.purchase_orders
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId} for update
      `;
      if (!rows[0])
        throw new ProcurementProblem(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase Order not found.");
      if (!["PARTIALLY_RECEIVED", "RECEIVED"].includes(rows[0].status))
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_ALREADY_TERMINAL",
          "Purchase Order cannot be closed."
        );
      await tx`
        update procurement.purchase_orders set status = 'CLOSED', closed_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId}
      `;
      await audit(tx, {
        ...input,
        action: "procurement.purchase_order.closed",
        resourceType: "PurchaseOrder",
        resourceId: input.purchaseOrderId
      });
      return (await loadPurchaseOrder(tx, input.tenantId, input.purchaseOrderId))!;
    });
  }

  async listGoodsReceipts(tenantId: string): Promise<GoodsReceipt[]> {
    const rows = await this.sql<{ id: string }[]>`
      select id from procurement.goods_receipts where tenant_id = ${tenantId}
      order by received_at desc, id
    `;
    return Promise.all(rows.map((row) => loadGoodsReceipt(this.sql, tenantId, row.id))) as Promise<
      GoodsReceipt[]
    >;
  }

  findGoodsReceipt(tenantId: string, receiptId: string) {
    return loadGoodsReceipt(this.sql, tenantId, receiptId);
  }

  createGoodsReceipt(
    input: Parameters<ProcurementStore["createGoodsReceipt"]>[0]
  ): Promise<GoodsReceipt> {
    return this.sql.begin(async (tx) => {
      const orders = await tx<{ supplier_id: string; status: PurchaseOrder["status"] }[]>`
        select supplier_id, status from procurement.purchase_orders
        where tenant_id = ${input.tenantId} and id = ${input.purchaseOrderId} for update
      `;
      if (!orders[0])
        throw new ProcurementProblem(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase Order not found.");
      if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(orders[0].status))
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_NOT_EDITABLE",
          "Purchase Order cannot receive goods."
        );
      const owner = await requireSupplier(tx, input.tenantId, orders[0].supplier_id, true);
      if (owner.status === "ARCHIVED")
        throw new ProcurementProblem(409, "SUPPLIER_ARCHIVED", "Supplier is archived.");
      const rows = await tx<{ id: string }[]>`
        insert into procurement.goods_receipts (
          tenant_id, receipt_number, purchase_order_id, supplier_id,
          supplier_delivery_reference, received_at, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.receiptNumber}, ${input.purchaseOrderId},
          ${orders[0].supplier_id}, ${input.supplierDeliveryReference ?? null},
          ${new Date(input.receivedAt)}, ${input.actorUserId}
        ) returning id
      `;
      await insertGoodsReceiptLines(tx, { ...input, receiptId: rows[0].id, lines: input.lines });
      await audit(tx, {
        ...input,
        action: "procurement.goods_receipt.created",
        resourceType: "GoodsReceipt",
        resourceId: rows[0].id
      });
      return (await loadGoodsReceipt(tx, input.tenantId, rows[0].id))!;
    });
  }

  updateGoodsReceipt(
    input: Parameters<ProcurementStore["updateGoodsReceipt"]>[0]
  ): Promise<GoodsReceipt> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<{ status: GoodsReceipt["status"] }[]>`
        select status from procurement.goods_receipts
        where tenant_id = ${input.tenantId} and id = ${input.receiptId} for update
      `;
      if (!rows[0])
        throw new ProcurementProblem(404, "GOODS_RECEIPT_NOT_FOUND", "Goods Receipt not found.");
      if (rows[0].status !== "DRAFT")
        throw new ProcurementProblem(
          409,
          "GOODS_RECEIPT_NOT_EDITABLE",
          "Goods Receipt is immutable."
        );
      if (input.changes.supplierDeliveryReference !== undefined)
        await tx`
          update procurement.goods_receipts set
            supplier_delivery_reference = ${input.changes.supplierDeliveryReference}, updated_at = now()
          where tenant_id = ${input.tenantId} and id = ${input.receiptId}
        `;
      if (input.changes.receivedAt !== undefined)
        await tx`
          update procurement.goods_receipts set received_at = ${new Date(input.changes.receivedAt)}, updated_at = now()
          where tenant_id = ${input.tenantId} and id = ${input.receiptId}
        `;
      if (input.changes.lines) {
        await tx`delete from procurement.goods_receipt_lines where tenant_id = ${input.tenantId} and goods_receipt_id = ${input.receiptId}`;
        await insertGoodsReceiptLines(tx, {
          ...input,
          receiptId: input.receiptId,
          lines: input.changes.lines
        });
      }
      await audit(tx, {
        ...input,
        action: "procurement.goods_receipt.updated",
        resourceType: "GoodsReceipt",
        resourceId: input.receiptId
      });
      return (await loadGoodsReceipt(tx, input.tenantId, input.receiptId))!;
    });
  }

  postGoodsReceipt(
    input: Parameters<ProcurementStore["postGoodsReceipt"]>[0]
  ): Promise<GoodsReceipt> {
    return this.sql.begin(async (tx) => {
      const receipts = await tx<{ purchase_order_id: string; status: GoodsReceipt["status"] }[]>`
        select purchase_order_id, status from procurement.goods_receipts
        where tenant_id = ${input.tenantId} and id = ${input.receiptId} for update
      `;
      if (!receipts[0])
        throw new ProcurementProblem(404, "GOODS_RECEIPT_NOT_FOUND", "Goods Receipt not found.");
      if (receipts[0].status === "POSTED")
        return (await loadGoodsReceipt(tx, input.tenantId, input.receiptId))!;
      if (receipts[0].status !== "DRAFT")
        throw new ProcurementProblem(
          409,
          "GOODS_RECEIPT_NOT_EDITABLE",
          "Goods Receipt is terminal."
        );

      const orders = await tx<{ status: PurchaseOrder["status"] }[]>`
        select status from procurement.purchase_orders
        where tenant_id = ${input.tenantId} and id = ${receipts[0].purchase_order_id}
        for update
      `;
      if (!orders[0] || !["APPROVED", "PARTIALLY_RECEIVED"].includes(orders[0].status))
        throw new ProcurementProblem(
          409,
          "PURCHASE_ORDER_NOT_EDITABLE",
          "Purchase Order cannot receive goods."
        );

      const receiptLines = await tx<GoodsReceiptLineRow[]>`
        select line.*, material.display_name as material_display_name
        from procurement.goods_receipt_lines as line
        join material_intelligence.materials as material on material.id = line.material_id
        where line.tenant_id = ${input.tenantId} and line.goods_receipt_id = ${input.receiptId}
        order by line.purchase_order_line_id, line.id
      `;
      if (receiptLines.length === 0)
        throw new ProcurementProblem(
          409,
          "GOODS_RECEIPT_POST_FAILED",
          "Goods Receipt has no lines."
        );
      const lineIds = [...new Set(receiptLines.map((line) => line.purchase_order_line_id))].sort();
      const poLines = await tx<
        { id: string; material_id: string; ordered_quantity_mg: string | bigint }[]
      >`
        select id, material_id, ordered_quantity_mg
        from procurement.purchase_order_lines
        where tenant_id = ${input.tenantId}
          and purchase_order_id = ${receipts[0].purchase_order_id}
          and id in ${tx(lineIds)}
        order by id
        for update
      `;
      if (poLines.length !== lineIds.length)
        throw new ProcurementProblem(
          409,
          "RECEIPT_PO_MISMATCH",
          "Receipt Line does not belong to its PO."
        );
      const already = await tx<{ purchase_order_line_id: string; received_mg: string | bigint }[]>`
        select line.purchase_order_line_id,
          coalesce(sum(line.received_quantity_mg), 0)::bigint as received_mg
        from procurement.goods_receipt_lines as line
        join procurement.goods_receipts as receipt
          on receipt.tenant_id = line.tenant_id and receipt.id = line.goods_receipt_id
        where line.tenant_id = ${input.tenantId}
          and line.purchase_order_line_id in ${tx(lineIds)}
          and receipt.status = 'POSTED'
        group by line.purchase_order_line_id
      `;
      const previous = new Map(
        already.map((row) => [row.purchase_order_line_id, BigInt(row.received_mg)])
      );
      const incoming = new Map<string, bigint>();
      for (const line of receiptLines)
        incoming.set(
          line.purchase_order_line_id,
          (incoming.get(line.purchase_order_line_id) ?? 0n) + BigInt(line.received_quantity_mg)
        );
      for (const line of poLines) {
        const total = (previous.get(line.id) ?? 0n) + (incoming.get(line.id) ?? 0n);
        if (total > BigInt(line.ordered_quantity_mg))
          throw new ProcurementProblem(
            409,
            "OVER_RECEIPT_NOT_ALLOWED",
            "Posted quantity would exceed the ordered quantity."
          );
      }

      const inventoryReferences: Array<{
        receiptLineId: string;
        inventoryLotId: string;
        inventoryMovementId: string;
        operationKey: string;
      }> = [];
      for (const line of receiptLines) {
        const operationKey = `procurement:receipt-line:${line.id}`;
        const movement = await receiveProcurementLotInTransaction(tx, {
          context: input,
          procurementReceiptId: line.id,
          materialId: line.material_id,
          lotCode: line.lot_code,
          supplierLotCode: line.supplier_lot_code,
          manufacturedAt: line.manufactured_at,
          expiresAt: line.expires_at,
          retestAt: line.retest_at,
          locationId: line.destination_location_id,
          quantityMg: String(line.received_quantity_mg) as QuantityMg,
          operationKey
        });
        await tx`
          update procurement.goods_receipt_lines set
            inventory_lot_id = ${movement.lotId}, inventory_movement_id = ${movement.id}
          where tenant_id = ${input.tenantId} and id = ${line.id}
        `;
        inventoryReferences.push({
          receiptLineId: line.id,
          inventoryLotId: movement.lotId,
          inventoryMovementId: movement.id,
          operationKey
        });
      }
      await tx`
        update procurement.goods_receipts set status = 'POSTED', posted_by_user_id = ${input.actorUserId},
          posted_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.receiptId}
      `;
      const fulfillment = await tx<{ incomplete: boolean }[]>`
        select exists (
          select 1 from procurement.purchase_order_lines as po_line
          where po_line.tenant_id = ${input.tenantId}
            and po_line.purchase_order_id = ${receipts[0].purchase_order_id}
            and coalesce((
              select sum(receipt_line.received_quantity_mg)
              from procurement.goods_receipt_lines as receipt_line
              join procurement.goods_receipts as receipt
                on receipt.tenant_id = receipt_line.tenant_id
                and receipt.id = receipt_line.goods_receipt_id
              where receipt_line.tenant_id = po_line.tenant_id
                and receipt_line.purchase_order_line_id = po_line.id
                and receipt.status = 'POSTED'
            ), 0) < po_line.ordered_quantity_mg
        ) as incomplete
      `;
      await tx`
        update procurement.purchase_orders set
          status = ${fulfillment[0].incomplete ? "PARTIALLY_RECEIVED" : "RECEIVED"},
          updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${receipts[0].purchase_order_id}
      `;
      await audit(tx, {
        ...input,
        action: "procurement.goods_receipt.posted",
        resourceType: "GoodsReceipt",
        resourceId: input.receiptId,
        metadata: {
          purchaseOrderId: receipts[0].purchase_order_id,
          inventoryReferences
        }
      });
      return (await loadGoodsReceipt(tx, input.tenantId, input.receiptId))!;
    });
  }

  cancelGoodsReceipt(
    input: Parameters<ProcurementStore["cancelGoodsReceipt"]>[0]
  ): Promise<GoodsReceipt> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<{ status: GoodsReceipt["status"] }[]>`
        select status from procurement.goods_receipts
        where tenant_id = ${input.tenantId} and id = ${input.receiptId} for update
      `;
      if (!rows[0])
        throw new ProcurementProblem(404, "GOODS_RECEIPT_NOT_FOUND", "Goods Receipt not found.");
      if (rows[0].status !== "DRAFT")
        throw new ProcurementProblem(
          409,
          "GOODS_RECEIPT_ALREADY_POSTED",
          "Only a DRAFT Goods Receipt can be cancelled."
        );
      await tx`
        update procurement.goods_receipts set status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.receiptId}
      `;
      await audit(tx, {
        ...input,
        action: "procurement.goods_receipt.cancelled",
        resourceType: "GoodsReceipt",
        resourceId: input.receiptId
      });
      return (await loadGoodsReceipt(tx, input.tenantId, input.receiptId))!;
    });
  }
}

export function createPostgresProcurementStore(sql: Sql): ProcurementStore {
  return new PostgresProcurementStore(sql);
}
