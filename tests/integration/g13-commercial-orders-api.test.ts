import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import {
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
