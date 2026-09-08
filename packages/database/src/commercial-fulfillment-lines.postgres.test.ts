import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresCommercialOrdersStore } from "./commercial-orders-store.js";

// Existing migration-replay runner only; never target a hosted project.
const url = process.env.G13_FULFILLMENT_TEST_DATABASE_URL;
if (url && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
  throw Error("Fulfillment transaction tests require disposable loopback PostgreSQL.");

describe.skipIf(!url)("Fulfillment lines — PostgreSQL replay and stale-write boundary", () => {
  let admin: Sql;
  let runtime: Sql;
  let store: ReturnType<typeof createPostgresCommercialOrdersStore>;
  const tenantId = randomUUID();
  const actorUserId = randomUUID();
  const orderId = randomUUID();
  const lineIds = [randomUUID(), randomUUID()];
  const context = {
    tenantId,
    actorUserId,
    requestId: "fulfillment-test",
    correlationId: "fulfillment-test"
  };
  const lines = (index: number) => [
    { orderLineId: lineIds[index]!, allocationId: null, quantityValue: "1" }
  ];
  const read = (id: string) => store.findFulfillment(tenantId, id);
  const fixture = async () => {
    const id = randomUUID();
    await admin`insert into commercial.fulfillments (id,tenant_id,fulfillment_number,order_id,status,created_by_user_id) values (${id},${tenantId},${id},${orderId},'DRAFT',${actorUserId})`;
    const envelope = await read(id);
    expect(envelope.fulfillment.revision).toMatch(/^\d+\.\d{6}$/);
    return {
      ...context,
      fulfillmentId: id,
      expectedRevision: envelope.fulfillment.revision as string,
      lines: lines(0)
    };
  };
  const audits = async (id: string) =>
    Number(
      (
        await admin`select count(*) from platform.audit_events where tenant_id=${tenantId} and resource_id=${id}`
      )[0]!.count
    );

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, prepare: false });
    runtime = postgres(url!, {
      max: 4,
      prepare: false,
      connection: { options: "-c role=nox_app_runtime" }
    });
    store = createPostgresCommercialOrdersStore(runtime);
    expect((await runtime`select current_user as role`)[0]!.role).toBe("nox_app_runtime");
    await admin`insert into commercial.orders (id,tenant_id,order_number,customer_id,status,currency_code,created_by_user_id) values (${orderId},${tenantId},${orderId},${randomUUID()},'DRAFT','USD',${actorUserId})`;
    for (const [index, id] of lineIds.entries())
      await admin`insert into commercial.order_lines (id,tenant_id,order_id,line_order,line_kind,title_snapshot,service_order_line_id,quantity_kind,ordered_quantity,unit_price_minor,price_basis_quantity) values (${id},${tenantId},${orderId},${index + 1},'SERVICE_SCOPE','Transaction fixture',${randomUUID()},'UNIT_COUNT',1,0,1)`;
  });
  afterAll(async () => {
    await runtime?.end();
    if (!admin) return;
    try {
      await admin`delete from commercial.fulfillment_lines where tenant_id=${tenantId}`;
      await admin`delete from commercial.fulfillments where tenant_id=${tenantId}`;
      await admin`delete from commercial.order_lines where tenant_id=${tenantId}`;
      await admin`delete from commercial.orders where tenant_id=${tenantId}`;
      await admin`delete from platform.audit_events where tenant_id=${tenantId}`;
    } finally {
      await admin.end();
    }
  });

  it("concurrent identical PUTs keep the same rows and produce one audit", async () => {
    const input = await fixture();
    const [a, b] = await Promise.all([
      store.replaceFulfillmentLines(input),
      store.replaceFulfillmentLines({ ...input, requestId: "retry" })
    ]);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(await audits(input.fulfillmentId)).toBe(1);
    const after = await read(input.fulfillmentId);
    expect(after.fulfillment.revision).not.toBe(input.expectedRevision);
    await store.replaceFulfillmentLines(input);
    expect((await read(input.fulfillmentId)).fulfillment.revision).toBe(after.fulfillment.revision);
    expect(await audits(input.fulfillmentId)).toBe(1);
  });
  it("concurrent different PUTs from one revision cannot overwrite the winner", async () => {
    const input = await fixture();
    const results = await Promise.allSettled([
      store.replaceFulfillmentLines(input),
      store.replaceFulfillmentLines({ ...input, lines: lines(1) })
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409, code: "COMMERCIAL_FULFILLMENT_STALE" }
    });
    expect(await audits(input.fulfillmentId)).toBe(1);
    const winner = results.find((r) => r.status === "fulfilled")!;
    if (winner.status === "fulfilled")
      expect((await read(input.fulfillmentId)).lines).toEqual(winner.value);
  });
  it("fresh edit succeeds, stale edit fails, reordering an equal set is a no-op", async () => {
    const input = await fixture();
    await store.replaceFulfillmentLines(input);
    const fresh = (await read(input.fulfillmentId)).fulfillment.revision;
    await store.replaceFulfillmentLines({
      ...input,
      expectedRevision: fresh,
      lines: [...lines(0), ...lines(1)]
    });
    const after = await read(input.fulfillmentId);
    await store.replaceFulfillmentLines({ ...input, lines: [...lines(1), ...lines(0)] });
    expect(await read(input.fulfillmentId)).toEqual(after);
    await expect(
      store.replaceFulfillmentLines({ ...input, lines: lines(1) })
    ).rejects.toMatchObject({ code: "COMMERCIAL_FULFILLMENT_STALE" });
    expect(await audits(input.fulfillmentId)).toBe(2);
  });
  it("audit failure rolls back replacement, version and audit; same revision can retry", async () => {
    const input = await fixture();
    await store.replaceFulfillmentLines(input);
    const before = await read(input.fulfillmentId);
    const edit = { ...input, expectedRevision: before.fulfillment.revision, lines: lines(1) };
    await expect(
      store.replaceFulfillmentLines({ ...edit, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(await read(input.fulfillmentId)).toEqual(before);
    expect(await audits(input.fulfillmentId)).toBe(1);
    await store.replaceFulfillmentLines(edit);
    expect(await audits(input.fulfillmentId)).toBe(2);
  });
  it("cross-tenant identity and missing revision never authorize a mutation", async () => {
    const input = await fixture();
    await expect(
      store.replaceFulfillmentLines({ ...input, tenantId: randomUUID() })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      store.replaceFulfillmentLines({ ...input, expectedRevision: undefined as unknown as string })
    ).rejects.toMatchObject({ code: "COMMERCIAL_FULFILLMENT_STALE" });
    expect((await read(input.fulfillmentId)).lines).toHaveLength(0);
    expect(await audits(input.fulfillmentId)).toBe(0);
  });
  it("identical notes retries preserve the version and create only one audit", async () => {
    const input = { ...(await fixture()), notes: "Packed separately" };
    const [a, b] = await Promise.all([
      store.updateFulfillment(input),
      store.updateFulfillment({ ...input, requestId: "notes-retry" })
    ]);
    expect(a).toEqual(b);
    expect(a.fulfillment.notes).toBe(input.notes);
    expect(a.fulfillment.revision).not.toBe(input.expectedRevision);
    expect(await store.updateFulfillment(input)).toEqual(a);
    expect(await audits(input.fulfillmentId)).toBe(1);
  });
  it("different notes from the same revision cannot overwrite the winner", async () => {
    const input = await fixture();
    const results = await Promise.allSettled([
      store.updateFulfillment({ ...input, notes: "First editor" }),
      store.updateFulfillment({ ...input, notes: "Second editor" })
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409, code: "COMMERCIAL_FULFILLMENT_STALE" }
    });
    const winner = results.find((r) => r.status === "fulfilled")!;
    if (winner.status === "fulfilled")
      expect(await read(input.fulfillmentId)).toEqual(winner.value);
    expect(await audits(input.fulfillmentId)).toBe(1);
  });
  it("notes and lines share one revision boundary", async () => {
    const input = await fixture();
    const results = await Promise.allSettled([
      store.updateFulfillment({ ...input, notes: "New instructions" }),
      store.replaceFulfillmentLines(input)
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "COMMERCIAL_FULFILLMENT_STALE" }
    });
    expect(await audits(input.fulfillmentId)).toBe(1);
    const after = await read(input.fulfillmentId);
    expect(after.fulfillment.notes !== null).toBe(after.lines.length === 0);
  });
  it("notes audit failure rolls back state and revision; fresh clearing is replay-safe", async () => {
    const input = await fixture();
    const before = await read(input.fulfillmentId);
    await expect(
      store.updateFulfillment({
        ...input,
        notes: "Changed",
        requestId: null as unknown as string
      })
    ).rejects.toMatchObject({ code: "23502" });
    expect(await read(input.fulfillmentId)).toEqual(before);
    expect(await audits(input.fulfillmentId)).toBe(0);
    const updated = await store.updateFulfillment({ ...input, notes: "Changed" });
    await expect(store.updateFulfillment({ ...input, notes: null })).rejects.toMatchObject({
      code: "COMMERCIAL_FULFILLMENT_STALE"
    });
    const clear = { ...input, notes: null, expectedRevision: updated.fulfillment.revision };
    const cleared = await store.updateFulfillment(clear);
    expect(cleared.fulfillment.notes).toBeNull();
    expect(await store.updateFulfillment(clear)).toEqual(cleared);
    expect(await audits(input.fulfillmentId)).toBe(2);
  });
  it("notes preserve tenant, revision and immutable-status denials", async () => {
    const input = { ...(await fixture()), notes: "Changed" };
    await expect(
      store.updateFulfillment({ ...input, tenantId: randomUUID() })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      store.updateFulfillment({ ...input, expectedRevision: undefined as unknown as string })
    ).rejects.toMatchObject({ code: "COMMERCIAL_FULFILLMENT_STALE" });
    await admin`update commercial.fulfillments set status='CANCELLED', cancelled_at=now() where tenant_id=${tenantId} and id=${input.fulfillmentId}`;
    await expect(store.updateFulfillment({ ...input, notes: null })).rejects.toMatchObject({
      code: "COMMERCIAL_FULFILLMENT_NOT_EDITABLE"
    });
    expect((await read(input.fulfillmentId)).fulfillment.notes).toBeNull();
    expect(await audits(input.fulfillmentId)).toBe(0);
  });
});
