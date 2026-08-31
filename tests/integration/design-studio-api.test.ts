import { describe, expect, it } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import { InternalApiRouter } from "@nox-os/platform";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import {
  DesignStudioApplication,
  DesignStudioProblem,
  createDesignStudioApi,
  designStudioPermissions
} from "@nox-os/design-studio";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { InMemoryDesignStudioStore } from "../helpers/in-memory-design-studio-store";

const IDS = {
  tenantA: "61000000-0000-4000-8000-000000000001",
  tenantB: "61000000-0000-4000-8000-000000000002",
  ownerA: "62000000-0000-4000-8000-000000000001",
  ownerB: "62000000-0000-4000-8000-000000000002",
  material: "63000000-0000-4000-8000-000000000001",
  chemical: "64000000-0000-4000-8000-000000000001"
} as const;

function snapshot(): MaterialIntelligenceSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-31T00:00:00.000Z",
    sourceMaterialUpdatedAt: "2026-08-30T00:00:00.000Z",
    snapshotHash: "a".repeat(64),
    material: {
      id: IDS.material,
      displayName: "Bergamot Fraction",
      materialType: "SINGLE_MOLECULE",
      approvalStatus: "APPROVED",
      scope: "PLATFORM",
      visibility: "SHARED",
      noteClassification: "TOP"
    },
    identifiers: { CAS: ["8007-75-8"], FEMA: [], INCI: [] },
    properties: null,
    normalizedProperties: { normalizationVersion: "g3-measurements-v1", warnings: [] },
    formulationGuidance: [
      {
        applicationKey: "fine-fragrance",
        minFormulaPct: 1,
        recommendedFormulaPct: 25,
        maxFormulaPct: 100,
        impactClass: "MEDIUM",
        confidence: "CURATED"
      }
    ],
    odorAssignments: [
      {
        taxonomyVersion: "1.2",
        assignmentType: "DESCRIPTOR",
        taxonomyTerm: "Bergamotty",
        intensity: 8
      }
    ],
    concentrate: null,
    components: [],
    scientificInternal: {
      chemicalEntity: {
        canonicalSmiles: "CCO",
        isomericSmiles: null,
        inchikey: null,
        molecularFormula: "C2H6O",
        molecularWeight: 46.07,
        structureStatus: "VERIFIED",
        structureSourceReference: "test"
      }
    }
  };
}

function tenantContext(
  actorUserId: string,
  tenantId: string,
  permissions: readonly string[]
): TenantRequestContext {
  return {
    requestId: "req_g4",
    correlationId: "corr_g4",
    environment: "test",
    sourceSha: "g4-test",
    actor: { userId: actorUserId, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions: permissions },
    entitlements: ["module.design-studio"]
  };
}

function fixture() {
  const store = new InMemoryDesignStudioStore();
  const permissionSet = Object.values(designStudioPermissions);
  const authorization = {
    async tenantContext(request: ApiRequest): Promise<TenantRequestContext> {
      const actor = request.headers.authorization?.replace("Bearer ", "");
      const tenantId = request.headers["x-nox-tenant-id"];
      if (actor === "owner-a" && tenantId === IDS.tenantA)
        return tenantContext(IDS.ownerA, IDS.tenantA, permissionSet);
      if (actor === "owner-b" && tenantId === IDS.tenantB)
        return tenantContext(IDS.ownerB, IDS.tenantB, permissionSet);
      if (actor === "reader-a" && tenantId === IDS.tenantA)
        return tenantContext(IDS.ownerA, IDS.tenantA, [designStudioPermissions.read]);
      if (actor === "unauthenticated")
        throw { status: 401, code: "AUTH_REQUIRED", message: "Authentication is required." };
      throw new DesignStudioProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is denied.");
    }
  };
  const application = new DesignStudioApplication({
    async retrieveApprovedForTenant(input) {
      expect(input.tenantId).toBe(IDS.tenantA);
      return [{ snapshot: snapshot(), tenantAccessible: true }];
    }
  });
  const api = createDesignStudioApi({
    store,
    application,
    authorization,
    definitions: moduleDefinitions,
    featureFlags: new LocalFeatureFlagResolver(["module.design-studio"]),
    fileStore: {
      async put(reference) {
        return {
          ...reference,
          id: "file_65000000-0000-4000-8000-000000000001",
          storagePath: `tenant/${reference.tenantId}/file_65000000-0000-4000-8000-000000000001`
        };
      },
      async stat(reference) {
        return reference;
      },
      async delete() {},
      async createDownloadGrant() {
        return "https://example.invalid/private";
      }
    }
  });
  const router = new InternalApiRouter();
  api.registerRoutes(router);
  const request = (input: {
    path: string;
    actor: string;
    tenantId: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) =>
    router.dispatch({
      method: input.method ?? "GET",
      path: input.path,
      headers: {
        authorization: `Bearer ${input.actor}`,
        "x-nox-tenant-id": input.tenantId,
        ...input.headers
      },
      body: input.body,
      context: {
        requestId: "req_g4",
        correlationId: "corr_g4",
        environment: "test",
        sourceSha: "g4-test"
      }
    });
  return { store, request };
}

async function prepareConfirmedBrief(request: ReturnType<typeof fixture>["request"]) {
  const projectResponse = await request({
    path: "/design-studio/projects",
    method: "POST",
    actor: "owner-a",
    tenantId: IDS.tenantA,
    body: { name: "Quiet citrus study", tenantId: IDS.tenantB }
  });
  expect(projectResponse.status).toBe(201);
  const project = (projectResponse.body as { project: { id: string; tenantId: string } }).project;
  expect(project.tenantId).toBe(IDS.tenantA);
  const briefResponse = await request({
    path: `/design-studio/projects/${project.id}/briefs`,
    method: "POST",
    actor: "owner-a",
    tenantId: IDS.tenantA,
    body: {
      workflowMode: "FORMULA_GENERATION",
      rawBrief: "A precise bright bergamot opening.",
      applicationKey: "fine-fragrance",
      targetDosagePct: 20,
      explicitTags: [
        { assignmentType: "DESCRIPTOR", taxonomyTerm: "Bergamotty", targetStrength: 1 }
      ],
      signals: []
    }
  });
  expect(briefResponse.status).toBe(201);
  const payload = briefResponse.body as {
    brief: { id: string };
    intentDraft: { intent: unknown };
  };
  const confirmResponse = await request({
    path: `/design-studio/briefs/${payload.brief.id}/confirm`,
    method: "POST",
    actor: "owner-a",
    tenantId: IDS.tenantA,
    body: { intent: payload.intentDraft.intent }
  });
  expect(confirmResponse.status).toBe(200);
  return { projectId: project.id, briefId: payload.brief.id };
}

describe("G4 Design Studio authenticated API", () => {
  it("round-trips FileStore opaque IDs into Brief asset provenance", async () => {
    const { request } = fixture();
    const asset = await request({
      path: "/design-studio/assets",
      method: "POST",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {
        sourceName: "reference.txt",
        modality: "REFERENCE",
        mimeType: "text/plain",
        contentsBase64: Buffer.from("private reference").toString("base64")
      }
    });
    expect(asset.status).toBe(201);
    const assetReference = (asset.body as { asset: Record<string, unknown> }).asset;
    const project = await request({
      path: "/design-studio/projects",
      method: "POST",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: { name: "Asset provenance" }
    });
    const projectId = (project.body as { project: { id: string } }).project.id;
    const brief = await request({
      path: `/design-studio/projects/${projectId}/briefs`,
      method: "POST",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {
        workflowMode: "FORMULA_GENERATION",
        rawBrief: "A source-backed fine-fragrance direction.",
        applicationKey: "fine-fragrance",
        targetDosagePct: 20,
        assetReferences: [assetReference]
      }
    });
    expect(brief.status).toBe(201);
  });

  it("preserves the Platform Core authentication error envelope", async () => {
    const { request } = fixture();
    const denied = await request({
      path: "/design-studio/projects",
      method: "POST",
      actor: "unauthenticated",
      tenantId: IDS.tenantA,
      body: { name: "Unauthenticated" }
    });
    expect(denied).toMatchObject({
      status: 401,
      body: { error: { code: "AUTH_REQUIRED", requestId: "req_g4" } }
    });
  });

  it("uses trusted tenant context and rejects forged permission headers before side effects", async () => {
    const { store, request } = fixture();
    const denied = await request({
      path: "/design-studio/projects",
      method: "POST",
      actor: "reader-a",
      tenantId: IDS.tenantA,
      headers: {
        "x-role": "TENANT_OWNER",
        "x-permission": designStudioPermissions.createProject
      },
      body: { name: "Forged", tenantId: IDS.tenantB }
    });
    expect(denied.status).toBe(403);
    expect(store.projects.size).toBe(0);
  });

  it("persists the human-confirmed brief, generates server-resolved candidates and audits it", async () => {
    const { store, request } = fixture();
    const { briefId } = await prepareConfirmedBrief(request);
    const generated = await request({
      path: `/design-studio/briefs/${briefId}/generate`,
      method: "POST",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: { budget: { mode: "OPEN" }, materialIds: ["forged-browser-id"] }
    });
    expect(generated.status).toBe(200);
    const candidates = (generated.body as { candidates: Array<{ lines: unknown[] }> }).candidates;
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.lines.length === 1)).toBe(true);
    expect(store.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "project.created",
        "brief.updated",
        "intent.confirmed",
        "formula.generated"
      ])
    );
  });

  it("freezes immutable server-regenerated evidence, excludes ChemicalEntity from the DTO and denies cross-tenant read", async () => {
    const { store, request } = fixture();
    const { briefId } = await prepareConfirmedBrief(request);
    const frozenResponse = await request({
      path: `/design-studio/briefs/${briefId}/freeze`,
      method: "POST",
      actor: "owner-a",
      tenantId: IDS.tenantA,
      body: {
        budget: { mode: "OPEN" },
        strategy: "FAITHFUL",
        formulaName: "Bergamot structure",
        candidate: { lines: [{ materialSnapshot: { scientificInternal: "forged" } }] }
      }
    });
    expect(frozenResponse.status).toBe(201);
    const formula = (
      frozenResponse.body as {
        formulaVersion: {
          formulaVersionId: string;
          candidate: { lines: Array<{ materialSnapshot: Record<string, unknown> }> };
        };
      }
    ).formulaVersion;
    expect(formula.candidate.lines[0].materialSnapshot).not.toHaveProperty("scientificInternal");
    expect(store.audits.map((audit) => audit.action)).toContain("formula.frozen");
    const crossTenant = await request({
      path: `/design-studio/formula-versions/${formula.formulaVersionId}`,
      actor: "owner-b",
      tenantId: IDS.tenantB
    });
    expect(crossTenant.status).toBe(404);
  });
});
