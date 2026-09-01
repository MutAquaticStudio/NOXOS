import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import {
  createProcurementApi,
  ProcurementApplication,
  procurementPermissions,
  type GoodsReceipt,
  type ProcurementStore
} from "@nox-os/procurement";
import { InternalApiRouter } from "@nox-os/platform";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const tenantId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const receiptId = "10000000-0000-4000-8000-000000000003";
const purchaseOrderId = "10000000-0000-4000-8000-000000000004";
const purchaseOrderLineId = "10000000-0000-4000-8000-000000000005";
const materialId = "10000000-0000-4000-8000-000000000006";
const locationId = "10000000-0000-4000-8000-000000000007";

function tenantContext(modulePermissions: readonly string[]): TenantRequestContext {
  return {
    requestId: "req_g8",
    correlationId: "corr_g8",
    environment: "test",
    sourceSha: "g8-test",
    actor: { userId: actorId, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions },
    entitlements: ["module.procurement"]
  };
}

function request(path: string, body?: unknown): ApiRequest {
  return {
    method: "POST",
    path,
    headers: {
      authorization: "Bearer test",
      "x-nox-tenant-id": tenantId,
      "x-role": "PLATFORM_OWNER",
      "x-permission": procurementPermissions.postReceipt,
      "x-user-id": crypto.randomUUID()
    },
    body,
    context: {
      requestId: "req_g8",
      correlationId: "corr_g8",
      environment: "test",
      sourceSha: "g8-test"
    }
  };
}

function receipt(): GoodsReceipt {
  const now = new Date();
  return {
    id: receiptId,
    tenantId,
    receiptNumber: "GR-1",
    purchaseOrderId,
    purchaseOrderNumber: "PO-1",
    supplierId: crypto.randomUUID(),
    supplierDisplayName: "Supplier",
    supplierDeliveryReference: null,
    status: "POSTED",
    receivedAt: now,
    createdByUserId: actorId,
    postedByUserId: actorId,
    createdAt: now,
    updatedAt: now,
    postedAt: now,
    cancelledAt: null,
    lines: []
  };
}

function fixture(modulePermissions: readonly string[]) {
  const postGoodsReceipt = vi.fn(async () => receipt());
  const createGoodsReceipt = vi.fn(async () => receipt());
  const store = {
    postGoodsReceipt,
    createGoodsReceipt
  } as unknown as ProcurementStore;
  const application = new ProcurementApplication(store, {
    async findTenantAccessibleMaterial(_tenantId, id) {
      return {
        materialId: id,
        displayName: "Pending Material",
        materialType: "MIXTURE" as const,
        approvalStatus: "PENDING_REVIEW" as const,
        tenantAccessible: true as const
      };
    }
  });
  const router = new InternalApiRouter();
  createProcurementApi({
    application,
    authorization: {
      async tenantContext() {
        return tenantContext(modulePermissions);
      }
    },
    definitions: moduleDefinitions,
    featureFlags: new LocalFeatureFlagResolver(["module.procurement"])
  }).registerRoutes(router);
  return { router, postGoodsReceipt, createGoodsReceipt };
}

describe("Gate 8 Procurement API", () => {
  it("derives actor/tenant authority from RequestContext when posting", async () => {
    const target = fixture([procurementPermissions.postReceipt]);
    const response = await target.router.dispatch(
      request(`/procurement/goods-receipts/${receiptId}/post`)
    );
    expect(response.status).toBe(200);
    expect(target.postGoodsReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: actorId,
        requestId: "req_g8",
        correlationId: "corr_g8",
        receiptId
      })
    );
  });

  it("rejects forged inventory references and PROCUREMENT provenance before persistence", async () => {
    const target = fixture([procurementPermissions.createReceipt]);
    const response = await target.router.dispatch(
      request("/procurement/goods-receipts", {
        receiptNumber: "GR-FORGED",
        purchaseOrderId,
        supplierDeliveryReference: null,
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId,
            materialId,
            receivedQuantityMg: "1000",
            lotCode: "LOT-FORGED",
            supplierLotCode: null,
            manufacturedAt: null,
            expiresAt: null,
            retestAt: null,
            destinationLocationId: locationId,
            inventoryLotId: crypto.randomUUID(),
            inventoryMovementId: crypto.randomUUID(),
            sourceModule: "PROCUREMENT"
          }
        ]
      })
    );
    expect(response.status).toBe(400);
    expect(target.createGoodsReceipt).not.toHaveBeenCalled();
  });

  it("fails closed without the operation permission", async () => {
    const response = await fixture([]).router.dispatch(
      request(`/procurement/goods-receipts/${receiptId}/post`)
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });
});
