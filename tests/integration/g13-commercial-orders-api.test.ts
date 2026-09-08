import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import {
  CommercialOrdersProblem,
  commercialOrdersPermissions,
  createCommercialOrdersApi,
  type CommercialOrdersStore
} from "@nox-os/commercial-orders";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import { InternalApiRouter } from "@nox-os/platform";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const tenantId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const orderId = "10000000-0000-4000-8000-000000000003";
const lineId = "10000000-0000-4000-8000-000000000004";
const lotId = "10000000-0000-4000-8000-000000000005";
const locationId = "10000000-0000-4000-8000-000000000006";

function context(): TenantRequestContext {
  return {
    requestId: "req_g13",
    correlationId: "corr_g13",
    environment: "test",
    sourceSha: "g13-test",
    actor: { userId: actorId, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: {
      tenantPermissions: [],
      modulePermissions: [commercialOrdersPermissions.allocationManage]
    },
    entitlements: ["module.commercial-orders"]
  };
}

function request(): ApiRequest {
  return {
    method: "POST",
    path: `/commercial-orders/orders/${orderId}/allocations`,
    headers: { authorization: "Bearer test", "x-nox-tenant-id": tenantId },
    body: {
      allocationType: "MATERIAL_LOT",
      orderLineId: lineId,
      materialLotId: lotId,
      locationId,
      quantityValue: "1"
    },
    context: {
      requestId: "req_g13",
      correlationId: "corr_g13",
      environment: "test",
      sourceSha: "g13-test"
    }
  };
}

describe("Gate 13 Commercial Orders inventory boundary", () => {
  const fulfillmentApi = (command: ReturnType<typeof vi.fn>, granted = true, notes = false) => {
    const router = new InternalApiRouter();
    createCommercialOrdersApi({
      store: {
        replaceFulfillmentLines: command,
        updateFulfillment: command
      } as unknown as CommercialOrdersStore,
      authorization: {
        async tenantContext() {
          const c = context();
          c.authorization.modulePermissions = granted
            ? [commercialOrdersPermissions.fulfillmentEdit]
            : [];
          return c;
        }
      },
      definitions: moduleDefinitions,
      featureFlags: new LocalFeatureFlagResolver(["module.commercial-orders"])
    }).registerRoutes(router);
    return (body: unknown) =>
      router.dispatch({
        ...request(),
        method: "PUT",
        path: `/commercial-orders/fulfillments/${orderId}${notes ? "" : "/lines"}`,
        body
      });
  };
  const replacement = {
    expectedRevision: "1788600000.123456",
    lines: [{ orderLineId: lineId, allocationId: lotId, quantityValue: "1" }]
  };
  it("requires a precise revision for notes and preserves current authorization", async () => {
    const store = vi.fn(async () => ({}));
    const call = fulfillmentApi(store, true, true);
    expect((await call({ notes: "Updated notes" })).status).toBe(400);
    for (const revision of [undefined, 1788600000, "1788600000.123", "bad"])
      expect((await call({ notes: "Updated notes", expectedRevision: revision })).status).toBe(400);
    expect(store).not.toHaveBeenCalled();
    const body = { notes: "Updated notes", expectedRevision: replacement.expectedRevision };
    expect((await call(body)).status).toBe(200);
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ ...body, tenantId, actorUserId: actorId })
    );
    expect((await fulfillmentApi(store, false, true)(body)).status).toBe(403);
    expect(store).toHaveBeenCalledTimes(1);
  });
  it("keeps stale notes conflicts in the standard 409 envelope", async () => {
    const store = vi.fn(async () => {
      throw new CommercialOrdersProblem(
        409,
        "COMMERCIAL_FULFILLMENT_STALE",
        "Reload before saving."
      );
    });
    const response = await fulfillmentApi(
      store,
      true,
      true
    )({
      notes: "Updated notes",
      expectedRevision: replacement.expectedRevision
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: { code: "COMMERCIAL_FULFILLMENT_STALE", requestId: "req_g13" }
    });
  });
  it("requires the exact server revision before dispatching replacement", async () => {
    const store = vi.fn(async () => []);
    const call = fulfillmentApi(store);
    for (const revision of [undefined, 1788600000, "1788600000.123", "not-a-revision"])
      expect((await call({ ...replacement, expectedRevision: revision })).status).toBe(400);
    expect(store).not.toHaveBeenCalled();
    expect((await call(replacement)).status).toBe(200);
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({
        ...replacement,
        tenantId,
        actorUserId: actorId,
        fulfillmentId: orderId
      })
    );
  });
  it("returns a stale-write 409 without hiding it as a success or server error", async () => {
    const store = vi.fn(async () => {
      throw new CommercialOrdersProblem(
        409,
        "COMMERCIAL_FULFILLMENT_STALE",
        "Reload current lines before saving."
      );
    });
    const response = await fulfillmentApi(store)(replacement);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: { code: "COMMERCIAL_FULFILLMENT_STALE", requestId: "req_g13" }
    });
    expect(store).toHaveBeenCalledTimes(1);
  });
  it("a supplied revision does not bypass fulfillment edit permission", async () => {
    const store = vi.fn(async () => []);
    expect((await fulfillmentApi(store, false)(replacement)).status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });
  it("preserves a G7 available-stock conflict as a 409 envelope", async () => {
    const inventoryConflict = Object.assign(
      new Error("Commercial reservation exceeds available stock."),
      { status: 409, code: "RESERVATION_EXCEEDS_AVAILABLE_STOCK" }
    );
    const createAllocation = vi.fn(async () => {
      throw inventoryConflict;
    });
    const router = new InternalApiRouter();
    createCommercialOrdersApi({
      store: { createAllocation } as unknown as CommercialOrdersStore,
      authorization: {
        async tenantContext() {
          return context();
        }
      },
      definitions: moduleDefinitions,
      featureFlags: new LocalFeatureFlagResolver(["module.commercial-orders"])
    }).registerRoutes(router);

    const response = await router.dispatch(request());

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: {
        code: "RESERVATION_EXCEEDS_AVAILABLE_STOCK",
        requestId: "req_g13"
      }
    });
    expect(createAllocation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, actorUserId: actorId, orderId })
    );
  });
});
