import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Page } from "@playwright/test";
import type { createRuntimeDatabase } from "@nox-os/database";
import { createPostgresCommercialOrdersStore } from "@nox-os/database";
type Sql = ReturnType<typeof createRuntimeDatabase>;

type ApiResult<T = unknown> = { status: number; body: T };
export type CommercialAcceptanceApi = <T = unknown>(
  actor: string,
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; tenantId?: string }
) => Promise<ApiResult<T>>;

// One domain acceptance journey used by both cloud environments.
export async function runG13Acceptance({
  page,
  tenantA,
  tenantB,
  actor,
  otherActor,
  actorUserId,
  suffix,
  runtime,
  maintenance,
  stock,
  api,
  ensureActorPage,
  baseUrl,
  expectedSourceSha,
  environment,
  g13VisualCaptureDirectory
}: {
  page: Page;
  tenantA: string;
  tenantB: string;
  actor: string;
  otherActor: string;
  actorUserId: string;
  suffix: string;
  runtime: Sql;
  maintenance: Sql;
  stock: { locationId: string; lots: Map<string, string> } | undefined;
  api: CommercialAcceptanceApi;
  ensureActorPage: () => Promise<void>;
  baseUrl: string;
  expectedSourceSha: string;
  environment: "preview" | "staging";
  g13VisualCaptureDirectory?: string;
}): Promise<void> {
  type QuoteEnvelope = { quote: { id: string; status: string }; lines: Array<{ id: string }> };
  type OrderEnvelope = {
    order: { id: string; status: string; fulfillmentStatus: string; shippingStatus: string };
    lines: Array<{
      id: string;
      line_kind: string;
      material_id?: string;
      formula_version_id?: string;
      service_order_line_id?: string;
    }>;
    allocations: Array<{ id: string; state: string; inventory_reservation_id?: string | null }>;
    shipments: Array<{ id: string; status: string }>;
  };
  type Fulfillment = { id: string; status?: string };
  const lotEntry = stock ? [...stock.lots.entries()][0] : undefined;
  if (!stock || !lotEntry) throw new Error("G13 requires the accepted G7 Lot/Location fixture.");
  const [materialId, lotId] = lotEntry;
  const batch = (
    await runtime<
      { id: string; formula_version_id: string; actual_output_mass_mg: string; decision: string }[]
    >`
      select batch.id::text, batch.formula_version_id::text, batch.actual_output_mass_mg::text,
             decision.decision
      from production.production_batches batch
      join lateral (
        select decision from quality_control.batch_release_decisions
        where tenant_id=batch.tenant_id and batch_id=batch.id
        order by decided_at desc, id desc limit 1
      ) decision on true
      where batch.tenant_id=${tenantA} and batch.actual_output_mass_mg >= 1000
        and decision.decision='RELEASED'
      order by batch.completed_at desc, batch.id desc limit 1
    `
  )[0];
  if (!batch) throw new Error("G13 requires one current G10 RELEASED Batch.");
  const materialQuantity = "1";
  const batchOutputMg = BigInt(batch.actual_output_mass_mg);
  const primaryBatchQuantity = (batchOutputMg / 2n).toString();
  const batchRaceQuantity = (batchOutputMg - BigInt(primaryBatchQuantity)).toString();
  if (BigInt(primaryBatchQuantity) <= 0n || BigInt(batchRaceQuantity) <= 0n)
    throw new Error("G13 requires a positive current G10 Batch output.");

  const customer = await api<{ customer: { id: string; status: string } }>(
    actor,
    "/lab-services/customers",
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        customerCode: `G13_${suffix.slice(0, 10).toUpperCase()}`,
        customerType: "BUSINESS",
        displayName: `G13 Commercial Customer ${suffix.slice(0, 8)}`,
        legalName: "G13 Staging Fixture",
        taxIdentifier: null,
        countryCode: "AU",
        notes: "Disposable G13 acceptance fixture"
      }
    }
  );
  expectStatus(customer, 201, "G13 PROSPECT Customer creation");
  const service = await api<{
    serviceOrder: { id: string; lines: Array<{ id: string }> };
  }>(actor, "/lab-services/service-orders", {
    method: "POST",
    tenantId: tenantA,
    body: {
      orderNumber: `G13-SERVICE-${suffix.slice(0, 10).toUpperCase()}`,
      customerId: customer.body.customer.id,
      customerContactId: null,
      customerExternalReference: null,
      intakeSummary: "G13 controlled Service fulfillment source",
      requestedCompletionDate: null,
      notes: null,
      lines: [
        {
          lineOrder: 1,
          serviceType: "FORMULATION_RND",
          title: "G13 commercial service scope",
          scopeDescription: "One controlled lab service scope.",
          notes: null
        }
      ]
    }
  });
  expectStatus(service, 201, "G13 Service source creation");
  const serviceLineId = service.body.serviceOrder.lines[0]?.id;
  if (!serviceLineId) throw new Error("G13 Service Order lacks its source line.");

  const lines = [
    {
      lineOrder: 1,
      lineKind: "MATERIAL",
      titleSnapshot: "G13 Material",
      descriptionSnapshot: null,
      materialId,
      quantityValue: materialQuantity,
      unitPriceMinor: "1250",
      priceBasisQuantity: "1000",
      discountMinor: "0",
      notes: null
    },
    {
      lineOrder: 2,
      lineKind: "SERVICE_SCOPE",
      titleSnapshot: "G13 Service",
      descriptionSnapshot: null,
      serviceOrderLineId: serviceLineId,
      quantityValue: "1",
      unitPriceMinor: "2500",
      priceBasisQuantity: "1",
      discountMinor: "0",
      notes: null
    },
    {
      lineOrder: 3,
      lineKind: "MANUFACTURED_PRODUCT",
      titleSnapshot: "G13 Manufactured Product",
      descriptionSnapshot: null,
      formulaVersionId: batch.formula_version_id,
      quantityValue: primaryBatchQuantity,
      unitPriceMinor: "5000",
      priceBasisQuantity: "1000",
      discountMinor: "0",
      notes: null
    }
  ];
  const quoteNumber = `G13-Q-${suffix.slice(0, 10).toUpperCase()}`;
  const quoteCreated = await api<{ quote: QuoteEnvelope }>(actor, "/commercial-orders/quotes", {
    method: "POST",
    tenantId: tenantA,
    body: {
      quoteNumber,
      customerId: customer.body.customer.id,
      customerContactId: null,
      sourceServiceOrderId: service.body.serviceOrder.id,
      sourceProjectId: null,
      currencyCode: "USD",
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      commercialTerms: "G13 exact acceptance terms",
      paymentTermsText: "No payment workflow in G13",
      shippingTermsText: "G13 controlled dispatch",
      shipToSnapshot: { country: "AU", locality: "Sydney" },
      lines
    }
  });
  expectStatus(quoteCreated, 201, "G13 Quote creation for PROSPECT");
  const quoteId = quoteCreated.body.quote.quote.id;
  expectStatus(
    await api(actor, `/commercial-orders/quotes/${quoteId}/issue`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Quote issue"
  );
  expectError(
    await api(actor, `/commercial-orders/quotes/${quoteId}`, {
      method: "PUT",
      tenantId: tenantA,
      body: { commercialTerms: "Forbidden issued quote rewrite" }
    }),
    409,
    "COMMERCIAL_QUOTE_NOT_EDITABLE",
    "G13 issued Quote immutability"
  );
  const revision = await api<{ quote: QuoteEnvelope }>(
    actor,
    `/commercial-orders/quotes/${quoteId}/revise`,
    { method: "POST", tenantId: tenantA, body: { quoteNumber } }
  );
  expectStatus(revision, 201, "G13 Quote revision");
  if (revision.body.quote.quote.status !== "DRAFT")
    throw new Error("G13 Quote revision did not preserve issued history with a new Draft.");
  expectStatus(
    await api(actor, `/commercial-orders/quotes/${quoteId}/accept`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Quote acceptance"
  );

  const orderNumber = `G13-O-${suffix.slice(0, 10).toUpperCase()}`;
  const createOrder = () =>
    api<{ order: OrderEnvelope }>(actor, `/commercial-orders/quotes/${quoteId}/create-order`, {
      method: "POST",
      tenantId: tenantA,
      body: { orderNumber }
    });
  const [firstOrder, duplicateOrder] = await Promise.all([createOrder(), createOrder()]);
  expectStatus(firstOrder, 201, "G13 Quote-to-Order first conversion");
  expectStatus(duplicateOrder, 201, "G13 Quote-to-Order idempotent conversion");
  const orderId = firstOrder.body.order.order.id;
  if (duplicateOrder.body.order.order.id !== orderId)
    throw new Error("G13 concurrent Quote-to-Order conversion created duplicate Orders.");
  expectError(
    await api(actor, `/commercial-orders/orders/${orderId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "COMMERCIAL_ORDER_CUSTOMER_NOT_ACTIVE",
    "G13 PROSPECT Order confirmation"
  );
  expectStatus(
    await api(actor, `/lab-services/customers/${customer.body.customer.id}/activate`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Customer activation through G11"
  );
  expectStatus(
    await api(actor, `/lab-services/service-orders/${service.body.serviceOrder.id}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Service Order confirmation through G11"
  );
  expectStatus(
    await api(actor, `/commercial-orders/orders/${orderId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Order confirmation"
  );
  const order = await api<OrderEnvelope>(actor, `/commercial-orders/orders/${orderId}`, {
    tenantId: tenantA
  });
  expectStatus(order, 200, "G13 confirmed Order read");
  const materialLine = order.body.lines.find((line) => line.line_kind === "MATERIAL");
  const serviceLine = order.body.lines.find((line) => line.line_kind === "SERVICE_SCOPE");
  const manufacturedLine = order.body.lines.find(
    (line) => line.line_kind === "MANUFACTURED_PRODUCT"
  );
  if (!materialLine || !serviceLine || !manufacturedLine)
    throw new Error("G13 Order did not preserve its three exact line shapes.");
  const lotBefore = await api<{
    lot: {
      balances: Array<{
        locationId: string;
        onHandMg: string;
        reservedMg: string;
        availableMg: string;
      }>;
    };
  }>(actor, `/inventory/lots/${lotId}`, { tenantId: tenantA });
  expectStatus(lotBefore, 200, "G13 material allocation opening balance");
  const opening = lotBefore.body.lot.balances.find(
    (entry) => entry.locationId === stock.locationId
  );
  if (!opening || BigInt(opening.availableMg) < BigInt(materialQuantity))
    throw new Error("G13 fixture Lot has insufficient available stock.");
  const materialAllocation = await api<{
    allocation: { id: string; inventory_reservation_id: string };
  }>(actor, `/commercial-orders/orders/${orderId}/allocations`, {
    method: "POST",
    tenantId: tenantA,
    body: {
      allocationType: "MATERIAL_LOT",
      orderLineId: materialLine.id,
      materialLotId: lotId,
      locationId: stock.locationId,
      quantityValue: materialQuantity
    }
  });
  expectStatus(materialAllocation, 201, "G13 exact G7 material reservation");
  const lotReserved = await api<{
    lot: {
      balances: Array<{
        locationId: string;
        onHandMg: string;
        reservedMg: string;
        availableMg: string;
      }>;
    };
  }>(actor, `/inventory/lots/${lotId}`, { tenantId: tenantA });
  expectStatus(lotReserved, 200, "G13 material allocation reserved balance");
  const reserved = lotReserved.body.lot.balances.find(
    (entry) => entry.locationId === stock.locationId
  );
  if (
    !reserved ||
    reserved.onHandMg !== opening.onHandMg ||
    BigInt(reserved.reservedMg) !== BigInt(opening.reservedMg) + BigInt(materialQuantity) ||
    BigInt(reserved.availableMg) !== BigInt(opening.availableMg) - BigInt(materialQuantity)
  )
    throw new Error(
      "G13 material allocation did not preserve G7 On Hand / Reserved / Available semantics."
    );
  const batchAllocation = await api<{ allocation: { id: string } }>(
    actor,
    `/commercial-orders/orders/${orderId}/allocations`,
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        allocationType: "RELEASED_BATCH",
        orderLineId: manufacturedLine.id,
        productionBatchId: batch.id,
        quantityValue: primaryBatchQuantity
      }
    }
  );
  expectStatus(batchAllocation, 201, "G13 released Batch allocation");

  const createConfirmedDirectOrder = async (orderNumber: string, line: (typeof lines)[number]) => {
    const created = await api<{ order: OrderEnvelope }>(actor, "/commercial-orders/orders", {
      method: "POST",
      tenantId: tenantA,
      body: {
        orderNumber,
        customerId: customer.body.customer.id,
        currencyCode: "USD",
        lines: [{ ...line, lineOrder: 1 }]
      }
    });
    expectStatus(created, 201, `G13 ${orderNumber} direct Draft Order`);
    const createdOrderId = created.body.order.order.id;
    expectStatus(
      await api(actor, `/commercial-orders/orders/${createdOrderId}/confirm`, {
        method: "POST",
        tenantId: tenantA
      }),
      200,
      `G13 ${orderNumber} direct Order confirmation`
    );
    const detail = await api<OrderEnvelope>(actor, `/commercial-orders/orders/${createdOrderId}`, {
      tenantId: tenantA
    });
    expectStatus(detail, 200, `G13 ${orderNumber} direct Order detail`);
    return { orderId: createdOrderId, lineId: detail.body.lines[0]!.id };
  };

  const materialRaceQuantity = (BigInt(opening.availableMg) - BigInt(materialQuantity)).toString();
  if (BigInt(materialRaceQuantity) <= 0n)
    throw new Error("G13 requires spare G7 availability for the reservation race.");
  const [materialRaceA, materialRaceB] = await Promise.all([
    createConfirmedDirectOrder(`G13-RACE-MA-${suffix.slice(0, 8)}`, {
      ...lines[0],
      quantityValue: materialRaceQuantity
    }),
    createConfirmedDirectOrder(`G13-RACE-MB-${suffix.slice(0, 8)}`, {
      ...lines[0],
      quantityValue: materialRaceQuantity
    })
  ]);
  const materialRaceResults = await Promise.all(
    [materialRaceA, materialRaceB].map(({ orderId, lineId }) =>
      api<{ allocation?: { id: string }; error?: { code?: string } }>(
        actor,
        `/commercial-orders/orders/${orderId}/allocations`,
        {
          method: "POST",
          tenantId: tenantA,
          body: {
            allocationType: "MATERIAL_LOT",
            orderLineId: lineId,
            materialLotId: lotId,
            locationId: stock.locationId,
            quantityValue: materialRaceQuantity
          }
        }
      )
    )
  );
  if (
    materialRaceResults.filter((result) => result.status === 201).length !== 1 ||
    materialRaceResults
      .filter((result) => result.status !== 201)
      .some((result) => result.status !== 409)
  )
    throw new Error("G13 concurrent G7 Commercial reservation did not fail closed.");
  const materialRaceWinner = materialRaceResults.findIndex((result) => result.status === 201);
  expectStatus(
    await api(
      actor,
      `/commercial-orders/orders/${[materialRaceA, materialRaceB][materialRaceWinner]!.orderId}/cancel`,
      {
        method: "POST",
        tenantId: tenantA,
        body: { reason: "G13 reservation race cleanup" }
      }
    ),
    200,
    "G13 material reservation race cleanup"
  );

  const [batchRaceA, batchRaceB] = await Promise.all([
    createConfirmedDirectOrder(`G13-RACE-BA-${suffix.slice(0, 8)}`, {
      ...lines[2],
      quantityValue: batchRaceQuantity
    }),
    createConfirmedDirectOrder(`G13-RACE-BB-${suffix.slice(0, 8)}`, {
      ...lines[2],
      quantityValue: batchRaceQuantity
    })
  ]);
  const batchRaceResults = await Promise.all(
    [batchRaceA, batchRaceB].map(({ orderId, lineId }) =>
      api<{ allocation?: { id: string }; error?: { code?: string } }>(
        actor,
        `/commercial-orders/orders/${orderId}/allocations`,
        {
          method: "POST",
          tenantId: tenantA,
          body: {
            allocationType: "RELEASED_BATCH",
            orderLineId: lineId,
            productionBatchId: batch.id,
            quantityValue: batchRaceQuantity
          }
        }
      )
    )
  );
  if (
    batchRaceResults.filter((result) => result.status === 201).length !== 1 ||
    batchRaceResults
      .filter((result) => result.status !== 201)
      .some((result) => result.status !== 409)
  )
    throw new Error("G13 concurrent released Batch allocation did not prevent over-allocation.");
  const batchRaceWinner = batchRaceResults.findIndex((result) => result.status === 201);
  expectStatus(
    await api(
      actor,
      `/commercial-orders/orders/${[batchRaceA, batchRaceB][batchRaceWinner]!.orderId}/cancel`,
      {
        method: "POST",
        tenantId: tenantA,
        body: { reason: "G13 Batch allocation race cleanup" }
      }
    ),
    200,
    "G13 Batch allocation race cleanup"
  );

  const createFulfillment = async (number: string) => {
    const result = await api<{ fulfillment: Fulfillment }>(
      actor,
      `/commercial-orders/orders/${orderId}/fulfillments`,
      { method: "POST", tenantId: tenantA, body: { fulfillmentNumber: number, notes: null } }
    );
    expectStatus(result, 201, `G13 ${number} draft Fulfillment`);
    return result.body.fulfillment.id;
  };
  const materialFulfillmentId = await createFulfillment(`G13-F-M-${suffix.slice(0, 8)}`);
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${materialFulfillmentId}/lines`, {
      method: "PUT",
      tenantId: tenantA,
      body: {
        lines: [
          {
            orderLineId: materialLine.id,
            allocationId: materialAllocation.body.allocation.id,
            quantityValue: materialQuantity
          }
        ]
      }
    }),
    200,
    "G13 Material Fulfillment exact lines"
  );
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${materialFulfillmentId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Material Fulfillment confirmation"
  );
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${materialFulfillmentId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 idempotent Fulfillment confirmation"
  );
  const lotConsumed = await api<{
    lot: {
      balances: Array<{
        locationId: string;
        onHandMg: string;
        reservedMg: string;
        availableMg: string;
      }>;
    };
    movements: Array<{
      sourceModule: string;
      sourceReferenceId: string | null;
      quantityMg: string;
    }>;
  }>(actor, `/inventory/lots/${lotId}`, { tenantId: tenantA });
  expectStatus(lotConsumed, 200, "G13 material consumption trace");
  const consumed = lotConsumed.body.lot.balances.find(
    (entry) => entry.locationId === stock.locationId
  );
  if (
    !consumed ||
    BigInt(consumed.onHandMg) !== BigInt(opening.onHandMg) - BigInt(materialQuantity) ||
    BigInt(consumed.reservedMg) !== BigInt(opening.reservedMg) ||
    !lotConsumed.body.movements.some(
      (movement) =>
        movement.sourceModule === "COMMERCIAL" &&
        movement.sourceReferenceId === materialAllocation.body.allocation.id &&
        movement.quantityMg === materialQuantity
    )
  )
    throw new Error("G13 Fulfillment did not create one exact COMMERCIAL G7 consumption.");
  const partialOrder = await api<OrderEnvelope>(actor, `/commercial-orders/orders/${orderId}`, {
    tenantId: tenantA
  });
  expectStatus(partialOrder, 200, "G13 partial Fulfillment derived status");
  if (partialOrder.body.order.fulfillmentStatus !== "PARTIAL")
    throw new Error("G13 first exact Fulfillment did not derive PARTIAL status.");

  // G10 RELEASED/REJECTED decisions are terminal. Model a stale Commercial
  // allocation using an already-REJECTED disposable G10 fixture; never reopen
  // a Released Batch or rewrite upstream decision history for this test.
  const rejectedBatch = (
    await runtime<{ id: string; decision_id: string }[]>`
      select b.id::text, d.id::text decision_id
      from production.production_batches b
      join quality_control.batch_release_decisions d
        on d.tenant_id=b.tenant_id and d.batch_id=b.id and d.decision='REJECTED'
      where b.tenant_id=${tenantA} and b.formula_version_id=${batch.formula_version_id}
      order by b.completed_at desc, b.id desc limit 1
    `
  )[0];
  if (!rejectedBatch) throw new Error("G13 requires the existing rejected G10 fixture.");
  const staleOrder = await createConfirmedDirectOrder(`G13-STALE-${suffix.slice(0, 8)}`, lines[2]!);
  expectError(
    await api(actor, `/commercial-orders/orders/${staleOrder.orderId}/allocations`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        allocationType: "RELEASED_BATCH",
        orderLineId: staleOrder.lineId,
        productionBatchId: rejectedBatch.id,
        quantityValue: primaryBatchQuantity
      }
    }),
    409,
    "COMMERCIAL_ALLOCATION_BATCH_NOT_RELEASED",
    "G13 rejected Batch allocation denial"
  );
  const upstreamDecisionBefore = await runtime`
    select * from quality_control.batch_release_decisions
    where tenant_id=${tenantA} and batch_id=${rejectedBatch.id} order by id
  `;
  // Admin fixture creation is restricted to this run's temporary tenant and
  // G13 table. The deployed API must reject this deliberately stale reference.
  const staleAllocation = (
    await maintenance<{ id: string }[]>`
      insert into commercial.order_allocations (
        tenant_id,order_id,order_line_id,allocation_type,quantity_value,
        production_batch_id,batch_release_decision_id,state,created_by_user_id
      ) values (
        ${tenantA},${staleOrder.orderId},${staleOrder.lineId},'RELEASED_BATCH',
        ${primaryBatchQuantity},${rejectedBatch.id},${rejectedBatch.decision_id},
        'ACTIVE',${actorUserId}
      ) returning id::text
    `
  )[0]!;
  const staleFulfillment = await api<{ fulfillment: Fulfillment }>(
    actor,
    `/commercial-orders/orders/${staleOrder.orderId}/fulfillments`,
    {
      method: "POST",
      tenantId: tenantA,
      body: { fulfillmentNumber: `G13-F-STALE-${suffix.slice(0, 8)}`, notes: null }
    }
  );
  expectStatus(staleFulfillment, 201, "G13 stale allocation Fulfillment fixture");
  const staleFulfillmentId = staleFulfillment.body.fulfillment.id;
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${staleFulfillmentId}/lines`, {
      method: "PUT",
      tenantId: tenantA,
      body: {
        lines: [
          {
            orderLineId: staleOrder.lineId,
            allocationId: staleAllocation.id,
            quantityValue: primaryBatchQuantity
          }
        ]
      }
    }),
    200,
    "G13 stale allocation Fulfillment lines"
  );
  expectError(
    await api(actor, `/commercial-orders/fulfillments/${staleFulfillmentId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "COMMERCIAL_ALLOCATION_BATCH_NOT_RELEASED",
    "G13 current G10 release revalidation"
  );
  const rejectedState = (
    await runtime<{ state: string; status: string }[]>`
      select a.state,f.status from commercial.order_allocations a
      join commercial.fulfillments f on f.tenant_id=a.tenant_id and f.order_id=a.order_id
      where a.tenant_id=${tenantA} and a.id=${staleAllocation.id} and f.id=${staleFulfillmentId}
    `
  )[0];
  const upstreamDecisionAfter = await runtime`
    select * from quality_control.batch_release_decisions
    where tenant_id=${tenantA} and batch_id=${rejectedBatch.id} order by id
  `;
  if (
    rejectedState?.state !== "ACTIVE" ||
    rejectedState.status !== "DRAFT" ||
    !isDeepStrictEqual(upstreamDecisionBefore, upstreamDecisionAfter)
  )
    throw new Error("G13 rejected Fulfillment mutated allocation, Fulfillment, or G10 truth.");
  expectStatus(
    await api(actor, `/commercial-orders/orders/${staleOrder.orderId}/cancel`, {
      method: "POST",
      tenantId: tenantA,
      body: { reason: "G13 stale fixture cleanup" }
    }),
    200,
    "G13 stale allocation cleanup"
  );
  const batchFulfillmentId = await createFulfillment(`G13-F-B-${suffix.slice(0, 8)}`);
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${batchFulfillmentId}/lines`, {
      method: "PUT",
      tenantId: tenantA,
      body: {
        lines: [
          {
            orderLineId: manufacturedLine.id,
            allocationId: batchAllocation.body.allocation.id,
            quantityValue: primaryBatchQuantity
          }
        ]
      }
    }),
    200,
    "G13 Batch Fulfillment exact lines"
  );
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${batchFulfillmentId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 manufactured Fulfillment confirmation"
  );

  expectStatus(
    await api(actor, `/lab-services/service-orders/${service.body.serviceOrder.id}/start`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Service Order start"
  );
  const serviceFulfillmentId = await createFulfillment(`G13-F-S-${suffix.slice(0, 8)}`);
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${serviceFulfillmentId}/lines`, {
      method: "PUT",
      tenantId: tenantA,
      body: { lines: [{ orderLineId: serviceLine.id, quantityValue: "1" }] }
    }),
    200,
    "G13 Service Fulfillment exact line"
  );
  expectError(
    await api(actor, `/commercial-orders/fulfillments/${serviceFulfillmentId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    409,
    "COMMERCIAL_SERVICE_NOT_COMPLETED",
    "G13 incomplete G11 Service guard"
  );
  expectStatus(
    await api(actor, `/lab-services/service-orders/${service.body.serviceOrder.id}/complete`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Service Order completion through G11"
  );
  expectStatus(
    await api(actor, `/commercial-orders/fulfillments/${serviceFulfillmentId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 service Fulfillment confirmation"
  );

  const createShipment = async (fulfillmentId: string, label: string) => {
    const result = await api<{ shipment: { id: string } }>(
      actor,
      `/commercial-orders/fulfillments/${fulfillmentId}/shipment`,
      {
        method: "POST",
        tenantId: tenantA,
        body: {
          shipmentNumber: `G13-SHIP-${label}-${suffix.slice(0, 8)}`,
          shipToSnapshot: { country: "AU", locality: "Sydney" },
          carrierName: "Controlled Carrier",
          serviceLevel: "Standard",
          trackingNumber: null,
          notes: null
        }
      }
    );
    expectStatus(result, 201, `G13 ${label} Shipment creation`);
    return result.body.shipment.id;
  };
  const materialShipment = await createShipment(materialFulfillmentId, "M");
  expectError(
    await api(actor, `/commercial-orders/fulfillments/${materialFulfillmentId}/shipment`, {
      method: "POST",
      tenantId: tenantA,
      body: {
        shipmentNumber: `G13-DUP-${suffix.slice(0, 8)}`,
        shipToSnapshot: {},
        carrierName: null,
        serviceLevel: null,
        trackingNumber: null,
        notes: null
      }
    }),
    409,
    "COMMERCIAL_SHIPMENT_NOT_SHIPPABLE",
    "G13 duplicate Shipment guard"
  );
  const batchShipment = await createShipment(batchFulfillmentId, "B");
  const movementCountBeforeShipment = (
    await runtime<{ count: string }[]>`
    select count(*)::text count from inventory.stock_movements where tenant_id=${tenantA}
  `
  )[0]!.count;
  for (const shipmentId of [materialShipment, batchShipment]) {
    expectStatus(
      await api(actor, `/commercial-orders/shipments/${shipmentId}/ship`, {
        method: "POST",
        tenantId: tenantA
      }),
      200,
      "G13 Shipment dispatch"
    );
    expectStatus(
      await api(actor, `/commercial-orders/shipments/${shipmentId}/deliver`, {
        method: "POST",
        tenantId: tenantA
      }),
      200,
      "G13 Shipment delivery"
    );
  }
  const finalOrder = await api<OrderEnvelope>(actor, `/commercial-orders/orders/${orderId}`, {
    tenantId: tenantA
  });
  expectStatus(finalOrder, 200, "G13 final Order read");
  if (
    finalOrder.body.order.fulfillmentStatus !== "FULFILLED" ||
    finalOrder.body.order.shippingStatus !== "DELIVERED"
  )
    throw new Error("G13 did not derive completed fulfillment/shipment status.");
  expectStatus(
    await api(actor, `/commercial-orders/orders/${orderId}/close`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 Commercial Order close"
  );

  const movementCountAfterShipment = (
    await runtime<{ count: string }[]>`
    select count(*)::text count from inventory.stock_movements where tenant_id=${tenantA}
  `
  )[0]!.count;
  if (movementCountAfterShipment !== movementCountBeforeShipment)
    throw new Error("G13 Shipment created an additional Inventory Movement.");
  const analytics = createPostgresCommercialOrdersStore(runtime);
  const projection = (await analytics.listCommercialOrders({ tenantId: tenantA })).find(
    (row) => row.orderId === orderId
  );
  if (
    projection?.commercialStatus !== "CLOSED" ||
    projection.fulfillmentStatus !== "FULFILLED" ||
    projection.shippingStatus !== "DELIVERED" ||
    (await analytics.listCommercialOrders({ tenantId: tenantB })).some(
      (row) => row.orderId === orderId
    )
  )
    throw new Error(
      "G13 G14 read projection failed closed-state or tenant-isolation verification."
    );

  const cancellation = await api<{ order: OrderEnvelope }>(actor, "/commercial-orders/orders", {
    method: "POST",
    tenantId: tenantA,
    body: {
      orderNumber: `G13-CANCEL-${suffix.slice(0, 8)}`,
      customerId: customer.body.customer.id,
      customerContactId: null,
      sourceServiceOrderId: null,
      sourceProjectId: null,
      currencyCode: "USD",
      commercialTerms: null,
      paymentTermsText: null,
      shippingTermsText: null,
      shipToSnapshot: null,
      lines: [{ ...lines[0], quantityValue: "200" }]
    }
  });
  expectStatus(cancellation, 201, "G13 cancellation fixture Draft Order");
  const cancellationOrderId = cancellation.body.order.order.id;
  expectStatus(
    await api(actor, `/commercial-orders/orders/${cancellationOrderId}/confirm`, {
      method: "POST",
      tenantId: tenantA
    }),
    200,
    "G13 cancellation fixture confirmation"
  );
  const cancelDetail = await api<OrderEnvelope>(
    actor,
    `/commercial-orders/orders/${cancellationOrderId}`,
    { tenantId: tenantA }
  );
  expectStatus(cancelDetail, 200, "G13 cancellation fixture detail");
  const cancelLine = cancelDetail.body.lines[0];
  const cancelAllocation = await api<{ allocation: { id: string } }>(
    actor,
    `/commercial-orders/orders/${cancellationOrderId}/allocations`,
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        allocationType: "MATERIAL_LOT",
        orderLineId: cancelLine.id,
        materialLotId: lotId,
        locationId: stock.locationId,
        quantityValue: "100"
      }
    }
  );
  expectStatus(cancelAllocation, 201, "G13 cancellation fixture reservation");
  const consumedCancelAllocation = await api<{ allocation: { id: string } }>(
    actor,
    `/commercial-orders/orders/${cancellationOrderId}/allocations`,
    {
      method: "POST",
      tenantId: tenantA,
      body: {
        allocationType: "MATERIAL_LOT",
        orderLineId: cancelLine.id,
        materialLotId: lotId,
        locationId: stock.locationId,
        quantityValue: "100"
      }
    }
  );
  expectStatus(consumedCancelAllocation, 201, "G13 cancellation fixture consumed allocation");
  const cancellationFulfillment = await api<{ fulfillment: { id: string } }>(
    actor,
    `/commercial-orders/orders/${cancellationOrderId}/fulfillments`,
    {
      method: "POST",
      tenantId: tenantA,
      body: { fulfillmentNumber: `G13-CANCEL-F-${suffix.slice(0, 8)}`, notes: null }
    }
  );
  expectStatus(cancellationFulfillment, 201, "G13 partial cancellation Fulfillment draft");
  expectStatus(
    await api(
      actor,
      `/commercial-orders/fulfillments/${cancellationFulfillment.body.fulfillment.id}/lines`,
      {
        method: "PUT",
        tenantId: tenantA,
        body: {
          lines: [
            {
              orderLineId: cancelLine.id,
              allocationId: consumedCancelAllocation.body.allocation.id,
              quantityValue: "100"
            }
          ]
        }
      }
    ),
    200,
    "G13 partial cancellation Fulfillment exact line"
  );
  expectStatus(
    await api(
      actor,
      `/commercial-orders/fulfillments/${cancellationFulfillment.body.fulfillment.id}/confirm`,
      {
        method: "POST",
        tenantId: tenantA
      }
    ),
    200,
    "G13 partial cancellation Fulfillment confirmation"
  );
  const beforeCancellation = await api<{
    lot: { balances: Array<{ locationId: string; onHandMg: string; reservedMg: string }> };
  }>(actor, `/inventory/lots/${lotId}`, { tenantId: tenantA });
  expectStatus(beforeCancellation, 200, "G13 partial cancellation pre-cancel balance");
  expectStatus(
    await api(actor, `/commercial-orders/orders/${cancellationOrderId}/cancel`, {
      method: "POST",
      tenantId: tenantA,
      body: { reason: "G13 controlled cancellation" }
    }),
    200,
    "G13 cancellation releases active Reservation"
  );
  const releasedAllocation = await api<{ allocations: Array<{ id: string; state: string }> }>(
    actor,
    `/commercial-orders/orders/${cancellationOrderId}/allocations`,
    { tenantId: tenantA }
  );
  expectStatus(releasedAllocation, 200, "G13 cancellation allocation read");
  if (
    releasedAllocation.body.allocations.find(
      (item) => item.id === cancelAllocation.body.allocation.id
    )?.state !== "RELEASED" ||
    releasedAllocation.body.allocations.find(
      (item) => item.id === consumedCancelAllocation.body.allocation.id
    )?.state !== "CONSUMED"
  )
    throw new Error("G13 cancellation did not release the active Commercial allocation.");
  const afterCancellation = await api<{
    lot: { balances: Array<{ locationId: string; onHandMg: string; reservedMg: string }> };
  }>(actor, `/inventory/lots/${lotId}`, { tenantId: tenantA });
  expectStatus(afterCancellation, 200, "G13 partial cancellation post-cancel balance");
  const beforeCancelBalance = beforeCancellation.body.lot.balances.find(
    (entry) => entry.locationId === stock.locationId
  );
  const afterCancelBalance = afterCancellation.body.lot.balances.find(
    (entry) => entry.locationId === stock.locationId
  );
  if (
    !beforeCancelBalance ||
    !afterCancelBalance ||
    afterCancelBalance.onHandMg !== beforeCancelBalance.onHandMg ||
    BigInt(afterCancelBalance.reservedMg) !== BigInt(beforeCancelBalance.reservedMg) - 100n
  )
    throw new Error(
      "G13 partial Order cancellation restored consumed stock or failed to release only active stock."
    );

  const crossTenantOrder = await api<{ error?: { code?: string } }>(
    otherActor,
    `/commercial-orders/orders/${orderId}`,
    {
      tenantId: tenantB
    }
  );
  if (
    crossTenantOrder.status !== 404 ||
    crossTenantOrder.body.error?.code !== "COMMERCIAL_ORDER_NOT_FOUND"
  )
    throw new Error(
      `G13 cross-tenant Commercial Order read did not fail closed: ${JSON.stringify(crossTenantOrder.body)}`
    );
  const forged = await api<{ error?: { code?: string } }>(actor, "/commercial-orders/orders", {
    method: "POST",
    tenantId: tenantA,
    body: {
      ...{
        orderNumber: `G13-FORGED-${suffix.slice(0, 8)}`,
        customerId: customer.body.customer.id,
        currencyCode: "USD",
        lines: [lines[0]]
      },
      tenantId: tenantB,
      actorUserId: "00000000-0000-4000-8000-000000000001",
      commercialAmountMinor: "1",
      sourceModule: "COMMERCIAL"
    }
  });
  expectError(forged, 400, "VALIDATION_FAILED", "G13 browser authority forgery");

  const auditActions = await maintenance<{ action: string }[]>`
    select action from platform.audit_events where tenant_id=${tenantA} and action like 'commercial.%'
  `;
  for (const action of [
    "commercial.quote.created",
    "commercial.quote.issued",
    "commercial.quote.accepted",
    "commercial.order.confirmed",
    "commercial.allocation.created",
    "commercial.allocation.consumed",
    "commercial.fulfillment.confirmed",
    "commercial.shipment.shipped",
    "commercial.shipment.delivered"
  ])
    if (!auditActions.some((event) => event.action === action))
      throw new Error(`G13 transactional AuditEvent ${action} is missing.`);

  await ensureActorPage();
  await page.goto(new URL("/commercial-orders", baseUrl).toString(), {
    waitUntil: "networkidle"
  });
  // A full navigation restores Auth, but intentionally does not choose among
  // multiple workspaces. Select through the real shell after each page load.
  await page.getByLabel("Current tenant").selectOption(tenantA);
  await expectHeading(page, "Commercial Orders");
  await captureG13(page, "commercial-orders-registry-desktop", "/commercial-orders");
  await page.goto(new URL(`/commercial-orders/${orderId}`, baseUrl).toString(), {
    waitUntil: "networkidle"
  });
  await page.getByLabel("Current tenant").selectOption(tenantA);
  await expectHeading(page, orderNumber);
  if (await page.getByRole("alert").count())
    throw new Error("G13 Order detail retained an error after loading the selected workspace.");
  await captureG13(page, "commercial-orders-detail-desktop", `/commercial-orders/${orderId}`);

  console.log(`G13_${environment.toUpperCase()}_COMMERCIAL_ORDERS_ACCEPTANCE=PASS`);
  console.log(`G13_${environment.toUpperCase()}_G7_COMMERCIAL_PROVENANCE=PASS`);
  console.log(`G13_${environment.toUpperCase()}_G10_RELEASE_REVALIDATION=PASS`);
  console.log(`G13_${environment.toUpperCase()}_G11_SERVICE_REVALIDATION=PASS`);
  console.log(`G13_${environment.toUpperCase()}_TENANT_SECURITY=PASS`);

  async function captureG13(page: Page, name: string, route: string): Promise<void> {
    if (!g13VisualCaptureDirectory) return;
    await mkdir(g13VisualCaptureDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(g13VisualCaptureDirectory, `${name}.png`),
      fullPage: true
    });
    await writeFile(
      resolve(g13VisualCaptureDirectory, `${name}.json`),
      JSON.stringify(
        {
          route,
          viewport: page.viewportSize(),
          sha: expectedSourceSha,
          environment,
          capturedAt: new Date().toISOString()
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }
}

function expectStatus(result: ApiResult, expected: number, label: string): void {
  if (result.status !== expected)
    throw new Error(
      `${label} returned ${result.status}, expected ${expected}: ${JSON.stringify(result.body)}`
    );
}
function expectError(
  result: ApiResult<{ error?: { code?: string } }>,
  status: number,
  code: string,
  label: string
): void {
  if (result.status !== status || result.body.error?.code !== code)
    throw new Error(
      `${label} did not fail closed with ${status} ${code}: ${JSON.stringify(result.body)}.`
    );
}
async function expectHeading(page: Page, text: string): Promise<void> {
  await page.getByRole("heading", { name: text, exact: true }).waitFor({ state: "visible" });
}
