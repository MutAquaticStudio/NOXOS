import { describe, expect, it } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import { InternalApiRouter } from "@nox-os/platform";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import {
  DesignStudioApplication,
  createDesignStudioApi,
  designStudioPermissions
} from "@nox-os/design-studio";
import {
  TrialSensoryApplication,
  createTrialSensoryApi,
  trialSensoryPermissions
} from "@nox-os/trial-sensory";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { InMemoryDesignStudioStore } from "../helpers/in-memory-design-studio-store";
import { InMemoryTrialSensoryStore } from "../helpers/in-memory-trial-sensory-store";
import { G5_IDS, g5FrozenFormula } from "../helpers/g5-formula-fixture";

function context(tenantId: string, modulePermissions: readonly string[]): TenantRequestContext {
  return {
    requestId: "req_g5_api",
    correlationId: "corr_g5_api",
    environment: "test",
    sourceSha: "g5-test",
    actor: { userId: G5_IDS.actorA, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions },
    entitlements: ["module.trial-sensory", "module.design-studio"]
  };
}

function fixture(
  options: { readOnly?: boolean; g5Flag?: boolean; g5RevisionPermission?: boolean } = {}
) {
  const trialStore = new InMemoryTrialSensoryStore();
  const designStore = new InMemoryDesignStudioStore();
  const formula = g5FrozenFormula();
  designStore.formulaVersions.set(formula.formulaVersionId, formula);
  const application = new TrialSensoryApplication(trialStore, designStore);
  let allPermissions = [
    ...Object.values(trialSensoryPermissions),
    ...Object.values(designStudioPermissions)
  ];
  if (options.g5RevisionPermission === false) {
    allPermissions = allPermissions.filter(
      (permission) => permission !== trialSensoryPermissions.requestRevision
    );
  }
  const authorization = {
    async tenantContext(request: ApiRequest) {
      const token = request.headers.authorization;
      const tenantId = request.headers["x-nox-tenant-id"];
      if (token !== "Bearer owner")
        throw { status: 401, code: "AUTH_REQUIRED", message: "Authentication required." };
      if (tenantId !== G5_IDS.tenantA && tenantId !== G5_IDS.tenantB)
        throw { status: 403, code: "TENANT_ACCESS_DENIED", message: "Tenant access denied." };
      return context(
        tenantId,
        options.readOnly ? [trialSensoryPermissions.readTrial] : allPermissions
      );
    }
  };
  const flags = [
    "module.design-studio",
    ...(options.g5Flag === false ? [] : ["module.trial-sensory"])
  ];
  const featureFlags = new LocalFeatureFlagResolver(flags);
  const designApplication = new DesignStudioApplication({
    async retrieveApprovedForTenant() {
      return formula.candidate.lines.map((line) => ({
        snapshot: line.materialSnapshot,
        tenantAccessible: true
      }));
    }
  });
  const trialApi = createTrialSensoryApi({
    application,
    authorization,
    definitions: moduleDefinitions,
    featureFlags,
    revisionPortFactory: () => ({
      async createRevisionCandidate() {
        return [formula.candidate];
      }
    })
  });
  const designApi = createDesignStudioApi({
    store: designStore,
    application: designApplication,
    authorization,
    definitions: moduleDefinitions,
    featureFlags,
    approvalEvidenceReader: application,
    revisionContextReader: application,
    revisionPortFactory: () => ({
      async createRevisionCandidate() {
        return [formula.candidate];
      }
    })
  });
  const router = new InternalApiRouter();
  trialApi.registerRoutes(router);
  designApi.registerRoutes(router);
  const request = (input: {
    path: string;
    method?: string;
    tenantId?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) =>
    router.dispatch({
      method: input.method ?? "GET",
      path: input.path,
      headers: {
        authorization: "Bearer owner",
        "x-nox-tenant-id": input.tenantId ?? G5_IDS.tenantA,
        ...input.headers
      },
      body: input.body,
      context: {
        requestId: "req_g5_api",
        correlationId: "corr_g5_api",
        environment: "test",
        sourceSha: "g5-test"
      }
    });
  return { request, trialStore, designStore };
}

async function createPreparedTrial(request: ReturnType<typeof fixture>["request"]) {
  const created = await request({
    path: "/trials",
    method: "POST",
    body: {
      formulaVersionId: G5_IDS.version,
      preparationMode: "CONCENTRATE",
      applicationKey: "fine-fragrance",
      dosagePct: 20,
      targetMassMg: "10000"
    }
  });
  expect(created.status).toBe(201);
  const trial = (created.body as { trial: { id: string } }).trial;
  const prepared = await request({ path: `/trials/${trial.id}/prepare`, method: "POST" });
  expect(prepared.status).toBe(200);
  return trial.id;
}

describe("Trial and Sensory API", () => {
  it("rejects cross-tenant Formula IDs and ignores forged authority headers", async () => {
    const { request } = fixture();
    const response = await request({
      path: "/trials",
      method: "POST",
      tenantId: G5_IDS.tenantB,
      headers: { "x-role": "TENANT_OWNER", "x-permission": trialSensoryPermissions.createTrial },
      body: {
        formulaVersionId: G5_IDS.version,
        preparationMode: "CONCENTRATE",
        applicationKey: "fine-fragrance",
        dosagePct: 20,
        targetMassMg: "10000"
      }
    });
    expect(response).toMatchObject({
      status: 409,
      body: { error: { code: "FORMULA_VERSION_NOT_FROZEN" } }
    });
  });

  it("fails closed on module flag or permission", async () => {
    const noFlag = await fixture({ g5Flag: false }).request({ path: "/trials" });
    expect(noFlag).toMatchObject({ status: 403, body: { error: { code: "PERMISSION_DENIED" } } });
    const denied = await fixture({ readOnly: true }).request({
      path: "/trials",
      method: "POST",
      body: {
        formulaVersionId: G5_IDS.version,
        preparationMode: "CONCENTRATE",
        applicationKey: "fine-fragrance",
        dosagePct: 20,
        targetMassMg: "10000"
      }
    });
    expect(denied).toMatchObject({ status: 403, body: { error: { code: "PERMISSION_DENIED" } } });
  });

  it("cannot freeze a sensory revision through G4 without the G5 revision permission", async () => {
    const denied = await fixture({ g5RevisionPermission: false }).request({
      path: `/design-studio/formula-versions/${G5_IDS.version}/revisions/freeze`,
      method: "POST",
      body: {
        sourceTrialId: G5_IDS.project,
        sourceEvaluationId: G5_IDS.brief,
        strategy: "FAITHFUL",
        formulaName: "Unauthorized revision"
      }
    });
    expect(denied).toMatchObject({ status: 403, body: { error: { code: "PERMISSION_DENIED" } } });
  });

  it("runs the exact Trial to FINAL revision path without material-level sensory truth", async () => {
    const { request, trialStore } = fixture();
    const trialId = await createPreparedTrial(request);
    const created = await request({
      path: `/trials/${trialId}/evaluations`,
      method: "POST",
      body: {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 45,
        evaluationText: "Citrus opening needs greater presence.",
        diagnosticNote: null
      }
    });
    const evaluationId = (created.body as { evaluation: { id: string } }).evaluation.id;
    const deltas = [
      {
        phase: "TOP",
        assignmentType: "DESCRIPTOR",
        taxonomyTerm: "Bergamotty",
        proposedDelta: 2,
        confirmedDelta: 3,
        proposalConfidence: 0.7,
        interpreterVersion: "test"
      }
    ];
    const updated = await request({
      path: `/trials/${trialId}/evaluations/${evaluationId}`,
      method: "PUT",
      body: {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 45,
        evaluationText: "Citrus opening needs greater presence.",
        diagnosticNote: null,
        deltas
      }
    });
    expect(updated.status).toBe(200);
    const finalized = await request({
      path: `/trials/${trialId}/evaluations/${evaluationId}/finalize`,
      method: "POST",
      body: { decision: "REVISION_REQUIRED", deltas }
    });
    expect(finalized.status).toBe(200);
    const revision = await request({
      path: `/trials/${trialId}/evaluations/${evaluationId}/create-revision`,
      method: "POST"
    });
    expect(revision).toMatchObject({
      status: 200,
      body: { revisionContext: { parentFormulaVersionId: G5_IDS.version } }
    });
    expect(JSON.stringify(trialStore.evaluations.get(evaluationId)?.deltas)).not.toContain(
      "materialId"
    );
  });

  it("blocks evidence-free G4 approval then accepts exact FINAL READY_FOR_APPROVAL evidence", async () => {
    const { request, designStore } = fixture();
    const trialId = await createPreparedTrial(request);
    const before = await request({
      path: `/design-studio/formula-versions/${G5_IDS.version}/approve`,
      method: "POST",
      body: { sourceTrialId: trialId, sourceEvaluationId: G5_IDS.project }
    });
    expect(before).toMatchObject({
      status: 409,
      body: { error: { code: "APPROVAL_EVIDENCE_INVALID" } }
    });
    const created = await request({
      path: `/trials/${trialId}/evaluations`,
      method: "POST",
      body: {
        evaluationMedium: "PRODUCT",
        sampleAgeMinutes: 120,
        evaluationText: "Balanced and ready.",
        diagnosticNote: null
      }
    });
    const evaluationId = (created.body as { evaluation: { id: string } }).evaluation.id;
    await request({
      path: `/trials/${trialId}/evaluations/${evaluationId}/finalize`,
      method: "POST",
      body: { decision: "READY_FOR_APPROVAL", deltas: [] }
    });
    const recommended = await request({
      path: `/trials/${trialId}/evaluations/${evaluationId}/recommend-approval`,
      method: "POST"
    });
    expect(recommended.status).toBe(200);
    const approved = await request({
      path: `/design-studio/formula-versions/${G5_IDS.version}/approve`,
      method: "POST",
      body: { sourceTrialId: trialId, sourceEvaluationId: evaluationId }
    });
    expect(approved.status).toBe(200);
    expect(designStore.formulaVersions.get(G5_IDS.version)?.approvalState).toBe("APPROVED");
  });
});
