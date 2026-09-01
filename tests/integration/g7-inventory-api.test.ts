import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import { createInventoryApi, InventoryApplication, type InventoryStore } from "@nox-os/inventory";
import { InternalApiRouter } from "@nox-os/platform";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const tenantId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const lotId = "10000000-0000-4000-8000-000000000003";
const locationId = "10000000-0000-4000-8000-000000000004";

function context(modulePermissions: readonly string[]): TenantRequestContext {
  return {
    requestId: "req_g7",
    correlationId: "corr_g7",
    environment: "test",
    sourceSha: "g7-test",
    actor: { userId: actorId, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions },
    entitlements: ["module.inventory"]
  };
}

function request(path: string, body?: unknown): ApiRequest {
  return {
    method: "POST",
    path,
    headers: { authorization: "Bearer test", "x-nox-tenant-id": tenantId },
    body,
    context: {
      requestId: "req_g7",
      correlationId: "corr_g7",
      environment: "test",
      sourceSha: "g7-test"
    }
  };
}

function fixture(modulePermissions = ["module.inventory.stock.receive"]) {
  const createManualMovement = vi.fn(
    async (_input: Parameters<InventoryStore["createManualMovement"]>[0]) => ({
      id: crypto.randomUUID(),
      tenantId,
      lotId,
      materialId: crypto.randomUUID(),
      movementType: "RECEIPT" as const,
      quantityMg: "1000" as const,
      fromLocationId: null,
      toLocationId: locationId,
      sourceModule: "MANUAL" as const,
      sourceReferenceId: null,
      reasonCode: null,
      operationKey: "receive-1",
      createdByUserId: actorId,
      createdAt: new Date()
    })
  );
  const application = new InventoryApplication({ createManualMovement } as never, {} as never);
  const router = new InternalApiRouter();
  createInventoryApi({
    application,
    authorization: {
      async tenantContext() {
        return context(modulePermissions);
      }
    },
    definitions: moduleDefinitions,
    featureFlags: new LocalFeatureFlagResolver(["module.inventory"])
  }).registerRoutes(router);
  return { router, createManualMovement };
}

describe("Gate 7 generic inventory API", () => {
  it("derives MANUAL provenance server-side", async () => {
    const target = fixture();
    const response = await target.router.dispatch(
      request(`/inventory/lots/${lotId}/receive`, {
        quantityMg: "1000",
        toLocationId: locationId,
        reasonCode: null,
        operationKey: "receive-1"
      })
    );
    expect(response.status).toBe(201);
    expect(target.createManualMovement).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, actorUserId: actorId, lotId })
    );
    expect(target.createManualMovement.mock.calls[0]?.[0]).not.toHaveProperty("sourceModule");
  });

  it.each(["TRIAL", "PROCUREMENT", "PRODUCTION"])(
    "rejects browser sourceModule=%s before the store",
    async (sourceModule) => {
      const target = fixture();
      const response = await target.router.dispatch(
        request(`/inventory/lots/${lotId}/receive`, {
          quantityMg: "1000",
          toLocationId: locationId,
          reasonCode: null,
          operationKey: "forged",
          sourceModule
        })
      );
      expect(response.status).toBe(400);
      expect(target.createManualMovement).not.toHaveBeenCalled();
    }
  );

  it("fails closed when the actor lacks the operation permission", async () => {
    const response = await fixture([]).router.dispatch(
      request(`/inventory/lots/${lotId}/receive`, {
        quantityMg: "1000",
        toLocationId: locationId,
        operationKey: "denied"
      })
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });
});
