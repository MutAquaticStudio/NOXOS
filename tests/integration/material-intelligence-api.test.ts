import { describe, expect, it } from "vitest";
import type {
  ApiRequest,
  AuthenticatedRequestContext,
  TenantRequestContext
} from "@nox-os/contracts";
import { InternalApiRouter } from "@nox-os/platform";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import {
  createMaterialIntelligenceApi,
  MATERIAL_ENTITLEMENT,
  MATERIAL_PERMISSIONS,
  MaterialProblem,
  type MaterialRecord,
  type TgscReferenceAdapter
} from "@nox-os/material-intelligence";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { InMemoryMaterialStore } from "../helpers/in-memory-material-store";

const IDS = {
  tenantA: "10000000-0000-4000-8000-000000000001",
  tenantB: "10000000-0000-4000-8000-000000000002",
  ownerA: "20000000-0000-4000-8000-000000000001",
  memberA: "20000000-0000-4000-8000-000000000002",
  ownerB: "20000000-0000-4000-8000-000000000003",
  platform: "20000000-0000-4000-8000-000000000004",
  molecule: "30000000-0000-4000-8000-000000000009",
  platformReference: "30000000-0000-4000-8000-000000000010",
  chemical: "40000000-0000-4000-8000-000000000001"
} as const;

const ownerPermissions = Object.values(MATERIAL_PERMISSIONS);
function tenantContext(
  userId: string,
  tenantId: string,
  permissions: readonly string[]
): TenantRequestContext {
  return {
    requestId: "req_g3",
    correlationId: "corr_g3",
    environment: "test",
    sourceSha: "g3-test",
    actor: { userId, platformRoleKey: null, platformPermissions: [] },
    tenant: {
      tenantId,
      roleKey: permissions.includes(MATERIAL_PERMISSIONS.approve) ? "TENANT_OWNER" : "TENANT_MEMBER"
    },
    authorization: { tenantPermissions: [], modulePermissions: permissions },
    entitlements: [MATERIAL_ENTITLEMENT]
  };
}
function authenticatedContext(userId: string): AuthenticatedRequestContext {
  return {
    requestId: "req_g3",
    correlationId: "corr_g3",
    environment: "test",
    sourceSha: "g3-test",
    actor: {
      userId,
      platformRoleKey: "PLATFORM_OWNER",
      platformPermissions: [
        "module.material-intelligence.reference.read",
        "module.material-intelligence.reference.manage",
        "module.material-intelligence.review.approve"
      ]
    }
  };
}

function fixture(input: { tgscReferenceAdapter?: TgscReferenceAdapter } = {}) {
  const store = new InMemoryMaterialStore();
  store.setTenantName(IDS.tenantA, "Tenant A");
  store.setTenantName(IDS.tenantB, "Tenant B");
  store.setPlatformUserDisplayName(IDS.ownerA, "User A");
  const authorization = {
    async tenantContext(request: ApiRequest) {
      const actor = request.headers.authorization?.replace("Bearer ", "");
      const tenantId = request.headers["x-nox-tenant-id"];
      if (actor === "owner-a" && tenantId === IDS.tenantA)
        return tenantContext(IDS.ownerA, IDS.tenantA, ownerPermissions);
      if (actor === "member-a" && tenantId === IDS.tenantA)
        return tenantContext(IDS.memberA, IDS.tenantA, [
          MATERIAL_PERMISSIONS.read,
          MATERIAL_PERMISSIONS.create,
          MATERIAL_PERMISSIONS.requestChange
        ]);
      if (actor === "owner-b" && tenantId === IDS.tenantB)
        return tenantContext(IDS.ownerB, IDS.tenantB, ownerPermissions);
      throw new MaterialProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
    },
    async authenticated(request: ApiRequest) {
      if (request.headers.authorization === "Bearer platform")
        return authenticatedContext(IDS.platform);
      throw new MaterialProblem(403, "PLATFORM_ACCESS_DENIED", "Platform access is not granted.");
    }
  };
  const service = createMaterialIntelligenceApi({
    store,
    authorization,
    definitions: moduleDefinitions,
    featureFlags: new LocalFeatureFlagResolver(["module.material-intelligence"]),
    tgscReferenceAdapter: input.tgscReferenceAdapter
  });
  const router = new InternalApiRouter();
  service.registerRoutes(router);
  const request = async (input: {
    path: string;
    method?: string;
    actor: string;
    tenantId?: string;
    body?: unknown;
    query?: Record<string, string>;
    headers?: Record<string, string>;
  }) => {
    const headers = {
      authorization: `Bearer ${input.actor}`,
      ...(input.tenantId ? { "x-nox-tenant-id": input.tenantId } : {}),
      ...input.headers
    };
    return router.dispatch({
      method: input.method ?? "GET",
      path: input.path,
      headers,
      body: input.body,
      query: input.query,
      context: {
        requestId: "req_g3",
        correlationId: "corr_g3",
        environment: "test",
        sourceSha: "g3-test"
      }
    });
  };
  return { store, service, request };
}

async function createTenantMaterial(
  request: ReturnType<typeof fixture>["request"],
  name = "Vanillin"
) {
  const response = await request({
    method: "POST",
    path: "/materials",
    actor: "owner-a",
    tenantId: IDS.tenantA,
    body: {
      displayName: name,
      materialType: "SINGLE_MOLECULE",
      identifiers: [{ identifierType: "CAS", value: "121-33-5" }],
      odorAssignments: [
        {
          taxonomyVersion: "1.2",
          assignmentType: "GRAND_FAMILY",
          taxonomyTerm: "Sweet/Balsamic",
          intensity: 5
        }
      ]
    }
  });
  expect(response.status).toBe(201);
  return response.body as { material: { id: string }; changeRequestId: string };
}

describe("G3-A Material API", () => {
  it("creates tenant Materials atomically as pending CREATE requests and rejects injected tenant authority", async () => {
    const { request, store } = fixture();
    const created = await createTenantMaterial(request);
    expect(created.material).toMatchObject({
      approvalStatus: "PENDING_REVIEW",
      scope: "TENANT",
      tenantId: IDS.tenantA
    });
    const forged = await request({
      method: "POST",
      path: "/materials",
      actor: "member-a",
      tenantId: IDS.tenantA,
      headers: { "x-role": "TENANT_OWNER", "x-permission": MATERIAL_PERMISSIONS.approve },
      body: { displayName: "Forged", materialType: "SINGLE_MOLECULE", tenantId: IDS.tenantB }
    });
    expect(forged.status).toBe(201);
    expect((forged.body as { material: { tenantId: string } }).material.tenantId).toBe(IDS.tenantA);
    const forgedApproval = await request({
      method: "POST",
      path: `/material-change-requests/${created.changeRequestId}/approve`,
      actor: "member-a",
      tenantId: IDS.tenantA,
      headers: { "x-role": "TENANT_OWNER", "x-permission": MATERIAL_PERMISSIONS.approve },
      body: {}
    });
    expect(forgedApproval.status).toBe(403);
    const crossTenant = await request({
      path: `/materials/${created.material.id}`,
      actor: "owner-b",
      tenantId: IDS.tenantB
    });
    expect(crossTenant.status).toBe(404);
    const crossTenantChange = await request({
      method: "POST",
      path: `/materials/${created.material.id}/change-requests`,
      actor: "owner-b",
      tenantId: IDS.tenantB,
      body: { requestType: "GENERAL", displayName: "Attempted cross-tenant change" }
    });
    expect(crossTenantChange.status).toBe(404);
  });

  it("enforces approval authority, first valid decision wins, and mandatory audit atomicity", async () => {
    const { request, store } = fixture();
    const created = await createTenantMaterial(request, "Hedione");
    const denied = await request({
      method: "POST",
      path: `/material-change-requests/${created.changeRequestId}/approve`,
      actor: "member-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    expect(denied.status).toBe(403);
    const [one, two] = await Promise.all([
      request({
        method: "POST",
        path: `/material-change-requests/${created.changeRequestId}/approve`,
        actor: "owner-a",
        tenantId: IDS.tenantA,
        body: {}
      }),
      request({
        method: "POST",
        path: `/material-change-requests/${created.changeRequestId}/approve`,
        actor: "owner-a",
        tenantId: IDS.tenantA,
        body: {}
      })
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(
      store.auditEvents.filter(
        (item) => item.action === "module.material-intelligence.change.approve"
      )
    ).toHaveLength(1);
    const pending = await createTenantMaterial(request, "Linalool");
    store.setAuditInsertFailure(true);
    await expect(
      request({
        method: "POST",
        path: `/material-change-requests/${pending.changeRequestId}/approve`,
        actor: "owner-a",
        tenantId: IDS.tenantA,
        body: {}
      })
    ).rejects.toThrow("controlled audit failure");
    expect((await store.findChangeRequest(pending.changeRequestId))?.status).toBe("PENDING_REVIEW");
    expect((await store.findMaterialById(pending.material.id))?.approvalStatus).toBe(
      "PENDING_REVIEW"
    );
    store.setAuditInsertFailure(false);
    const raced = await createTenantMaterial(request, "Race material");
    const [approve, reject] = await Promise.all([
      request({
        method: "POST",
        path: `/material-change-requests/${raced.changeRequestId}/approve`,
        actor: "owner-a",
        tenantId: IDS.tenantA,
        body: {}
      }),
      request({
        method: "POST",
        path: `/material-change-requests/${raced.changeRequestId}/reject`,
        actor: "owner-a",
        tenantId: IDS.tenantA,
        body: {}
      })
    ]);
    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
  });

  it("allows approved sharing only through the sharing permission and preserves cross-tenant contributor privacy", async () => {
    const { request } = fixture();
    const created = await createTenantMaterial(request, "Ambroxan");
    await request({
      method: "POST",
      path: `/material-change-requests/${created.changeRequestId}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    const forbiddenSharing = await request({
      method: "POST",
      path: `/materials/${created.material.id}/change-requests`,
      actor: "member-a",
      tenantId: IDS.tenantA,
      body: { requestType: "GENERAL", visibility: "SHARED" }
    });
    expect(forbiddenSharing.status).toBe(403);
    const sharing = await request({
      method: "POST",
      path: `/materials/${created.material.id}/change-requests`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: { requestType: "GENERAL", visibility: "SHARED" }
    });
    expect(sharing.status).toBe(201);
    const change = sharing.body as { changeRequest: { id: string } };
    await request({
      method: "POST",
      path: `/material-change-requests/${change.changeRequest.id}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    const crossTenant = await request({
      path: `/materials/${created.material.id}`,
      actor: "owner-b",
      tenantId: IDS.tenantB
    });
    expect(crossTenant.status).toBe(200);
    expect(JSON.stringify(crossTenant.body)).not.toContain(IDS.ownerA);
    expect(crossTenant.body).toMatchObject({
      material: { contributor: { tenantName: "Tenant A" } }
    });
  });

  it("governs application formulation guidance through review and includes it in the deterministic snapshot", async () => {
    const { request, service } = fixture();
    const created = await createTenantMaterial(request, "Guided Bergamot");
    await request({
      method: "POST",
      path: `/material-change-requests/${created.changeRequestId}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    const invalid = await request({
      method: "POST",
      path: `/materials/${created.material.id}/change-requests`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {
        requestType: "FORMULATION_GUIDANCE",
        guidance: [
          {
            applicationKey: "fine-fragrance",
            minFormulaPct: 10,
            recommendedFormulaPct: 9,
            maxFormulaPct: 20,
            impactClass: "MEDIUM",
            confidence: "CURATED"
          }
        ]
      }
    });
    expect(invalid.status).toBe(400);
    const submitted = await request({
      method: "POST",
      path: `/materials/${created.material.id}/change-requests`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {
        requestType: "FORMULATION_GUIDANCE",
        guidance: [
          {
            applicationKey: "fine-fragrance",
            minFormulaPct: 1,
            recommendedFormulaPct: 12,
            maxFormulaPct: 20,
            impactClass: "MEDIUM",
            confidence: "CURATED",
            sourceReference: "TGSC curated reference"
          }
        ]
      }
    });
    expect(submitted.status).toBe(201);
    const change = submitted.body as { changeRequest: { id: string } };
    await request({
      method: "POST",
      path: `/material-change-requests/${change.changeRequest.id}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    const snapshot = await service.buildSnapshot(created.material.id, {
      includeScientificInternal: false
    });
    expect(snapshot.formulationGuidance).toEqual([
      expect.objectContaining({
        applicationKey: "fine-fragrance",
        minFormulaPct: 1,
        recommendedFormulaPct: 12,
        maxFormulaPct: 20,
        confidence: "CURATED"
      })
    ]);
  });

  it("uses PostgreSQL-backed text and taxonomy filters without widening tenant visibility", async () => {
    const { request } = fixture();
    const created = await createTenantMaterial(request, "Filtered Vanillin");
    const own = await request({
      path: "/materials",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      query: {
        query: "vanillin",
        taxonomyAssignmentType: "GRAND_FAMILY",
        taxonomyTerm: "Sweet/Balsamic"
      }
    });
    expect(own.status).toBe(200);
    expect(
      (own.body as { materials: readonly { id: string }[] }).materials.map((item) => item.id)
    ).toContain(created.material.id);
    const foreign = await request({
      path: "/materials",
      actor: "owner-b",
      tenantId: IDS.tenantB,
      query: { query: "vanillin" }
    });
    expect(
      (foreign.body as { materials: readonly { id: string }[] }).materials.map((item) => item.id)
    ).not.toContain(created.material.id);
  });

  it("projects registry views, pinned taxonomy, safe TGSC unavailability, and audit history without cross-tenant actor disclosure", async () => {
    const { request, store } = fixture();
    const created = await createTenantMaterial(request, "History material");
    const taxonomy = await request({
      path: "/materials/taxonomy",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      query: { version: "1.2" }
    });
    expect(taxonomy.status).toBe(200);
    expect(
      (taxonomy.body as { taxonomy: { GRAND_FAMILIES: string[] } }).taxonomy.GRAND_FAMILIES
    ).toContain("Sweet/Balsamic");
    const identity = await request({
      path: "/materials/identity-resolution",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      query: { displayName: "History material", cas: "121-33-5" }
    });
    expect(identity.status).toBe(200);
    expect(identity.body).toMatchObject({
      identityResolution: { kind: "EXACT_MATCH", materialId: created.material.id }
    });
    const unavailable = await request({
      path: "/materials/reference/tgsc",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      query: { cas: "121-33-5" }
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toMatchObject({ reference: { state: "UNAVAILABLE" } });
    const ownRegistry = await request({
      path: "/materials",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      query: { view: "MY_TENANT" }
    });
    expect(
      (ownRegistry.body as { materials: readonly { id: string }[] }).materials.map(
        (item) => item.id
      )
    ).toContain(created.material.id);
    const ownHistory = await request({
      path: `/materials/${created.material.id}/history`,
      actor: "owner-a",
      tenantId: IDS.tenantA
    });
    expect(ownHistory.status).toBe(200);
    expect(JSON.stringify(ownHistory.body)).toContain(IDS.ownerA);

    await request({
      method: "POST",
      path: `/material-change-requests/${created.changeRequestId}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    const sharing = await request({
      method: "POST",
      path: `/materials/${created.material.id}/change-requests`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: { requestType: "GENERAL", visibility: "SHARED" }
    });
    const sharingId = (sharing.body as { changeRequest: { id: string } }).changeRequest.id;
    await request({
      method: "POST",
      path: `/material-change-requests/${sharingId}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    const sharedRegistry = await request({
      path: "/materials",
      actor: "owner-b",
      tenantId: IDS.tenantB,
      query: { view: "SHARED" }
    });
    expect(
      (sharedRegistry.body as { materials: readonly { id: string }[] }).materials.map(
        (item) => item.id
      )
    ).toContain(created.material.id);
    await store.seedMaterial({
      id: IDS.platformReference,
      tenantId: null,
      scope: "PLATFORM",
      visibility: "SHARED",
      displayName: "Platform reference",
      normalizedDisplayName: "platform reference",
      materialType: "NATURAL",
      approvalStatus: "APPROVED",
      noteClassification: null,
      chemicalEntityId: null,
      contributorUserId: IDS.platform,
      approvedByUserId: IDS.platform,
      approvedByAuthority: "PLATFORM"
    });
    const sharedWithPlatformReference = await request({
      path: "/materials",
      actor: "owner-b",
      tenantId: IDS.tenantB,
      query: { view: "SHARED" }
    });
    expect(
      (sharedWithPlatformReference.body as { materials: readonly { id: string }[] }).materials.map(
        (item) => item.id
      )
    ).toContain(IDS.platformReference);
    const foreignHistory = await request({
      path: `/materials/${created.material.id}/history`,
      actor: "owner-b",
      tenantId: IDS.tenantB
    });
    expect(foreignHistory.status).toBe(200);
    expect(JSON.stringify(foreignHistory.body)).not.toContain(IDS.ownerA);
  });

  it("presents a server-side TGSC candidate as explicit reference data without approving Material", async () => {
    const { request } = fixture({
      tgscReferenceAdapter: {
        async lookupByCas() {
          return {
            cas: "121-33-5",
            displayName: "Vanillin",
            sourceReference: "https://reference.example.test/tgsc/121-33-5",
            fields: { appearance: "White crystals", assay: "99%" }
          };
        }
      }
    });
    const response = await request({
      path: "/materials/reference/tgsc",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      query: { cas: "121-33-5" }
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reference: {
        source: "https://reference.example.test/tgsc/121-33-5",
        referenceUrl: "https://reference.example.test/tgsc/121-33-5",
        values: { appearance: "White crystals", assay: "99%" }
      }
    });
  });

  it("keeps ChemicalEntity data inside the internal review/snapshot boundary", async () => {
    const { request, store } = fixture();
    await store.insertChemicalEntity({
      id: IDS.chemical,
      canonicalName: "Vanillin",
      canonicalSmiles: "COc1ccc",
      isomericSmiles: null,
      inchikey: "MUQZ",
      molecularFormula: "C8H8O3",
      molecularWeight: 152.15,
      structureStatus: "VERIFIED",
      structureSourceReference: "curated"
    });
    const seeded: MaterialRecord = {
      id: IDS.molecule,
      tenantId: IDS.tenantA,
      scope: "TENANT",
      visibility: "PRIVATE",
      displayName: "Molecule",
      normalizedDisplayName: "molecule",
      materialType: "SINGLE_MOLECULE",
      approvalStatus: "APPROVED",
      noteClassification: null,
      chemicalEntityId: IDS.chemical,
      contributorUserId: IDS.ownerA,
      approvedByUserId: IDS.ownerA,
      approvedByAuthority: "TENANT",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await store.seedMaterial(seeded);
    const response = await request({
      path: `/materials/${IDS.molecule}`,
      actor: "owner-a",
      tenantId: IDS.tenantA
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /chemical_entity|chemicalEntity|smiles|inchikey|molecular|structure/i
    );
  });

  it("reserves Platform review for Platform authority and denies a tenant reviewer global truth", async () => {
    const { request, store } = fixture();
    const global: MaterialRecord = {
      id: "30000000-0000-4000-8000-000000000020",
      tenantId: null,
      scope: "PLATFORM",
      visibility: "SHARED",
      displayName: "Platform Material",
      normalizedDisplayName: "platform material",
      materialType: "NATURAL",
      approvalStatus: "APPROVED",
      noteClassification: null,
      chemicalEntityId: null,
      contributorUserId: IDS.platform,
      approvedByUserId: IDS.platform,
      approvedByAuthority: "PLATFORM",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await store.seedMaterial(global);
    const submitted = await request({
      method: "POST",
      path: `/materials/${global.id}/change-requests`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: { requestType: "GENERAL", displayName: "Corrected Platform Material" }
    });
    expect(submitted.status).toBe(201);
    const id = (submitted.body as { changeRequest: { id: string } }).changeRequest.id;
    const tenantDenied = await request({
      method: "POST",
      path: `/material-change-requests/${id}/approve`,
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {}
    });
    expect(tenantDenied.status).toBe(403);
    const platformApproved = await request({
      method: "POST",
      path: `/platform/material-intelligence/review/${id}/approve`,
      actor: "platform",
      body: {}
    });
    expect(platformApproved.status).toBe(200);
  });
});
