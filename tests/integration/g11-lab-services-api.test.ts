import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import {
  createLabServicesApi,
  LabServicesApplication,
  labServicesPermissions,
  type Customer,
  type LabServicesStore,
  type ServiceOrder
} from "@nox-os/lab-services";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import { InternalApiRouter } from "@nox-os/platform";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const tenantId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const customerId = "10000000-0000-4000-8000-000000000003";
const orderId = "10000000-0000-4000-8000-000000000004";
const now = new Date();

const customer = (): Customer => ({
  id: customerId,
  tenantId,
  customerCode: "LAB-001",
  customerType: "BUSINESS",
  displayName: "Atelier One",
  legalName: null,
  taxIdentifier: null,
  countryCode: "VN",
  status: "PROSPECT",
  notes: null,
  createdByUserId: actorId,
  heldByUserId: null,
  archivedByUserId: null,
  createdAt: now,
  updatedAt: now,
  heldAt: null,
  archivedAt: null
});
const order = (): ServiceOrder => ({
  id: orderId,
  tenantId,
  orderNumber: "LSO-001",
  customerId,
  customerCode: "LAB-001",
  customerDisplayName: "Atelier One",
  customerContactId: null,
  contactFullName: null,
  customerExternalReference: null,
  intakeSummary: "R&D scope",
  requestedCompletionDate: null,
  status: "CONFIRMED",
  notes: null,
  cancellationReason: null,
  createdByUserId: actorId,
  confirmedByUserId: actorId,
  startedByUserId: null,
  completedByUserId: null,
  cancelledByUserId: null,
  createdAt: now,
  updatedAt: now,
  confirmedAt: now,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  lines: []
});
function context(modulePermissions: readonly string[]): TenantRequestContext {
  return {
    requestId: "req_g11",
    correlationId: "corr_g11",
    environment: "test",
    sourceSha: "g11-test",
    actor: { userId: actorId, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions },
    entitlements: ["module.lab-services"]
  };
}
function request(method: string, path: string, body?: unknown): ApiRequest {
  return {
    method,
    path,
    body,
    headers: {
      authorization: "Bearer test",
      "x-nox-tenant-id": tenantId,
      "x-role": "PLATFORM_OWNER",
      "x-permission": labServicesPermissions.confirmServiceOrder,
      "x-user-id": crypto.randomUUID()
    },
    context: {
      requestId: "req_g11",
      correlationId: "corr_g11",
      environment: "test",
      sourceSha: "g11-test"
    }
  };
}
function fixture(permissionValues: readonly string[]) {
  const createCustomer = vi.fn(async () => customer());
  const confirmServiceOrder = vi.fn(async () => order());
  const store = { createCustomer, confirmServiceOrder } as unknown as LabServicesStore;
  const router = new InternalApiRouter();
  createLabServicesApi({
    application: new LabServicesApplication(store),
    authorization: {
      async tenantContext() {
        return context(permissionValues);
      }
    },
    definitions: moduleDefinitions,
    featureFlags: new LocalFeatureFlagResolver(["module.lab-services"])
  }).registerRoutes(router);
  return { router, createCustomer, confirmServiceOrder };
}

describe("Gate 11 Lab Services API authority", () => {
  it("derives tenant and actor from RequestContext and ignores forged authority headers", async () => {
    const target = fixture([labServicesPermissions.manageCustomer]);
    const response = await target.router.dispatch(
      request("POST", "/lab-services/customers", {
        customerCode: "LAB-001",
        customerType: "BUSINESS",
        displayName: "Atelier One",
        legalName: null,
        taxIdentifier: null,
        countryCode: "VN",
        notes: null
      })
    );
    expect(response.status).toBe(201);
    expect(target.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: actorId,
        requestId: "req_g11",
        correlationId: "corr_g11"
      })
    );
  });

  it("fails closed without entitlement, feature flag, or exact permission", async () => {
    const target = fixture([]);
    const response = await target.router.dispatch(
      request("POST", `/lab-services/service-orders/${orderId}/confirm`)
    );
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    expect(target.confirmServiceOrder).not.toHaveBeenCalled();
  });

  it("uses the confirmed lifecycle operation without trusting client status", async () => {
    const target = fixture([labServicesPermissions.confirmServiceOrder]);
    const response = await target.router.dispatch(
      request("POST", `/lab-services/service-orders/${orderId}/confirm`, { status: "COMPLETED" })
    );
    expect(response.status).toBe(200);
    expect(target.confirmServiceOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, actorUserId: actorId, serviceOrderId: orderId })
    );
  });
});
