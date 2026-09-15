import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  DesignStudioStore,
  FreezeFormulaInput,
  FrozenFormulaVersion
} from "@nox-os/design-studio";
import { createPostgresDesignStudioStore } from "./design-studio-store.js";
import { createPostgresTrialSensoryStore, lockFinalTrialEvidence } from "./trial-sensory-store.js";
import { g5FrozenFormula } from "../../../tests/helpers/g5-formula-fixture.js";
import { g6Evidence } from "../../../tests/helpers/g6-release-fixture.js";
import { createPostgresReleaseReadinessStore } from "./release-readiness-store.js";
import type { ReleaseReadinessStore } from "@nox-os/release-readiness";

// Only disposable CI PostgreSQL with canonical migrations. No provider URLs.
const url = process.env.G4_EVIDENCE_TEST_DATABASE_URL;
if (url && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
  throw new Error("Evidence tests require disposable loopback PostgreSQL.");

describe.skipIf(!url)("G4/G5 commit evidence and revision replay — PostgreSQL", () => {
  let admin: Sql;
  let runtime: Sql;
  let store: DesignStudioStore;
  const tenantId = randomUUID();
  const actorUserId = randomUUID();
  const trace = { tenantId, actorUserId, requestId: "g4-evidence", correlationId: "g4-evidence" };
  let base: FreezeFormulaInput;

  beforeAll(async () => {
    admin = postgres(url!, { prepare: false, max: 2 });
    runtime = postgres(url!, {
      prepare: false,
      max: 4,
      connection: { options: "-c role=nox_app_runtime -c statement_timeout=5000" }
    });
    expect((await runtime`select current_user as role`)[0].role).toBe("nox_app_runtime");
    store = createPostgresDesignStudioStore(runtime);
    await admin`insert into auth.users (id) values (${actorUserId})`;
    await admin`insert into platform.platform_users (id, status) values (${actorUserId}, 'ACTIVE')`;
    await admin`insert into platform.tenants (id, name, slug, status) values (${tenantId}, 'Evidence fixture', ${"evidence-" + tenantId}, 'ACTIVE')`;
    const project = await store.createProject({
      ...trace,
      name: "Evidence fixture",
      description: null
    });
    const template = g5FrozenFormula().candidate;
    const brief = await store.createBrief({
      ...trace,
      projectId: project.id,
      workflowMode: "FORMULA_GENERATION",
      rawBrief: "Citrus woods",
      briefPayload: {},
      normalizedIntent: template.intentSnapshot
    });
    const candidate = structuredClone(template);
    candidate.projectId = project.id;
    candidate.sourceBriefId = brief.id;
    for (const line of candidate.lines) {
      line.materialId = randomUUID();
      line.materialSnapshot.material.id = line.materialId;
      const rows = await admin`insert into material_intelligence.materials
        (id, scope, visibility, display_name, normalized_display_name, material_type, approval_status,
          contributor_user_id, approved_by_user_id, approved_by_authority, updated_at)
        values (${line.materialId}, 'PLATFORM', 'SHARED', 'Evidence material', 'evidence material', 'SINGLE_MOLECULE',
          'APPROVED', ${actorUserId}, ${actorUserId}, 'PLATFORM', '2026-09-01T00:00:00Z') returning updated_at`;
      line.materialSnapshot.sourceMaterialUpdatedAt = rows[0].updated_at.toISOString();
    }
    base = {
      ...trace,
      projectId: project.id,
      sourceBriefId: brief.id,
      formulaName: "Evidence formula",
      candidate,
      freshSnapshots: candidate.lines.map((line) => line.materialSnapshot)
    };
  });

  // Immutable evidence is intentionally retained in the disposable database;
  // the existing CI job destroys it with supabase stop --no-backup.
  afterAll(async () => {
    await runtime?.end();
    await admin?.end();
  });

  async function evidence(
    parent: FrozenFormulaVersion,
    decision: "READY_FOR_APPROVAL" | "REVISION_REQUIRED"
  ) {
    const trialId = randomUUID();
    const evaluationId = randomUUID();
    // Administrative fixture setup only; commands under test always use limited runtime.
    await admin`insert into trial_sensory.trials (id, tenant_id, formula_version_id, formula_bundle_hash,
      composition_kind, taxonomy_source, taxonomy_version, preparation_mode, application_key, dosage_pct,
      target_mass_mg, scaling_policy_version, status, created_by_user_id, prepared_by_user_id, prepared_at)
      values (${trialId}, ${tenantId}, ${parent.formulaVersionId}, ${parent.bundleHash}, 'FULL_FORMULA', 'OSMO',
        'osmo_v1.2', 'CONCENTRATE', 'fine-fragrance', 100, 1000000, 'g4-largest-remainder-v1', 'PREPARED',
        ${actorUserId}, ${actorUserId}, now())`;
    await admin`insert into trial_sensory.sensory_evaluations
      (id, tenant_id, trial_id, evaluation_medium, sample_age_minutes, evaluation_text, evaluated_by_user_id)
      values (${evaluationId}, ${tenantId}, ${trialId}, 'BLOTTER', 10, 'Controlled fixture', ${actorUserId})`;
    await createPostgresTrialSensoryStore(runtime).finalizeEvaluation({
      ...trace,
      trialId,
      evaluationId,
      decision,
      deltas:
        decision === "REVISION_REQUIRED"
          ? [
              {
                phase: "MID",
                assignmentType: "DESCRIPTOR",
                taxonomyTerm: "Bergamotty",
                confirmedDelta: 1
              }
            ]
          : []
    });
    return {
      ...trace,
      formulaVersionId: parent.formulaVersionId,
      sourceTrialId: trialId,
      sourceEvaluationId: evaluationId
    };
  }

  it("G6 serializes keyed creation/reassessment, rejects key reuse and rolls back failed audit", async () => {
    const parent = await store.freezeFormula(base);
    const approved = await store.approveFrozenFormulaVersion(
      await evidence(parent, "READY_FOR_APPROVAL")
    );
    const g6 = createPostgresReleaseReadinessStore(runtime);
    const input: Parameters<ReleaseReadinessStore["createFinalAssessment"]>[0] = {
      context: { ...trace, idempotencyKey: randomUUID() },
      formulaVersionId: parent.formulaVersionId,
      formulaBundleHash: parent.bundleHash,
      releaseProfile: {
        formulaVersionId: parent.formulaVersionId,
        applicationKey: "fine-fragrance",
        dosagePct: 20,
        policyKey: "g6-known-limit-v1"
      },
      evidenceSnapshot: g6Evidence(approved, { materials: [] }),
      decision: "REVIEW_REQUIRED",
      checks: [
        {
          checkKey: "TEST_REVIEW",
          subjectType: "FORMULA",
          materialId: null,
          result: "REVIEW",
          evidence: {},
          message: "Controlled persistence probe"
        }
      ],
      supersedesAssessmentId: null,
      auditAction: "release-readiness.assessed"
    };
    const [a, b] = await Promise.all([
      g6.createFinalAssessment(input),
      g6.createFinalAssessment(input)
    ]);
    expect(b.id).toBe(a.id);
    await expect(
      g6.createFinalAssessment({
        ...input,
        releaseProfile: { ...input.releaseProfile, dosagePct: 21 }
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const next = {
      ...input,
      supersedesAssessmentId: a.id,
      auditAction: "release-readiness.reassessed" as const,
      context: { ...trace, idempotencyKey: randomUUID() }
    };
    await expect(
      g6.createFinalAssessment({
        ...next,
        context: { ...next.context, requestId: null as unknown as string }
      })
    ).rejects.toMatchObject({ code: "23502" });
    expect(await g6.listAssessments(tenantId)).toHaveLength(1);
    const [c, d] = await Promise.all([
      g6.createFinalAssessment(next),
      g6.createFinalAssessment(next)
    ]);
    expect(c.id).toBe(d.id);
    expect(c.supersedesAssessmentId).toBe(a.id);
    expect(await g6.listAssessments(tenantId)).toHaveLength(2);
    expect(
      await admin`select id from platform.audit_events where tenant_id=${tenantId} and resource_type='ReleaseAssessment'`
    ).toHaveLength(2);
  });

  it("rejects stale/forged evidence at the store boundary before any approval or audit", async () => {
    const parent = await store.freezeFormula(base);
    const valid = await evidence(parent, "READY_FOR_APPROVAL");
    const wrongDecision = await evidence(parent, "REVISION_REQUIRED");
    for (const input of [
      { ...valid, sourceEvaluationId: randomUUID() },
      { ...valid, sourceTrialId: randomUUID() },
      { ...valid, tenantId: randomUUID() },
      { ...valid, formulaVersionId: randomUUID() },
      wrongDecision
    ]) {
      await expect(store.approveFrozenFormulaVersion(input)).rejects.toMatchObject({
        code: "APPROVAL_EVIDENCE_INVALID"
      });
    }
    expect(
      (await store.findFrozenFormulaVersion(tenantId, parent.formulaVersionId))?.approvalState
    ).toBe("NOT_APPROVED");
    expect(
      await admin`select id from platform.audit_events where tenant_id = ${tenantId} and resource_id = ${parent.formulaVersionId} and action = 'formula.approved'`
    ).toHaveLength(0);
  });

  it("holds the evidence lock through transaction completion", async () => {
    const parent = await store.freezeFormula(base);
    const input = await evidence(parent, "READY_FOR_APPROVAL");
    await runtime.begin(async (tx) => {
      expect(await lockFinalTrialEvidence(tx, input, "READY_FOR_APPROVAL")).toBe(true);
      // NOWAIT gives deterministic lock proof, not a timing-dependent sleep.
      await expect(
        admin.begin(async (other) => {
          await other`select id from trial_sensory.sensory_evaluations where id = ${input.sourceEvaluationId} for update nowait`;
        })
      ).rejects.toMatchObject({ code: "55P03" });
    });
    await admin.begin(async (tx) => {
      await tx`select id from trial_sensory.sensory_evaluations where id = ${input.sourceEvaluationId} for update nowait`;
    });
  });

  it("rolls back approval when audit fails; concurrent retries approve once", async () => {
    const parent = await store.freezeFormula(base);
    const input = await evidence(parent, "READY_FOR_APPROVAL");
    await expect(
      store.approveFrozenFormulaVersion({ ...input, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(
      (await store.findFrozenFormulaVersion(tenantId, parent.formulaVersionId))?.approvalState
    ).toBe("NOT_APPROVED");
    const results = await Promise.all([
      store.approveFrozenFormulaVersion(input),
      store.approveFrozenFormulaVersion(input)
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await admin`select id from platform.audit_events where tenant_id = ${tenantId} and resource_id = ${parent.formulaVersionId} and action = 'formula.approved'`
    ).toHaveLength(1);
  });

  it("replays exact concurrent revision intent, rejects changed intent and emits one audit pair", async () => {
    const parent = await store.freezeFormula(base);
    const input = await evidence(parent, "REVISION_REQUIRED");
    const revision = {
      ...base,
      parentFormulaVersionId: parent.formulaVersionId,
      sourceTrialId: input.sourceTrialId,
      sourceEvaluationId: input.sourceEvaluationId
    };
    const [a, b] = await Promise.all([
      store.freezeFormula(revision),
      store.freezeFormula({ ...revision, requestId: "retry" })
    ]);
    expect(a.formulaVersionId).toBe(b.formulaVersionId);
    expect(a.versionNumber).toBe(2);
    const recaptured = structuredClone(revision);
    recaptured.candidate.lines.forEach((line) => {
      line.materialSnapshot.capturedAt = new Date().toISOString();
    });
    expect((await store.freezeFormula(recaptured)).formulaVersionId).toBe(a.formulaVersionId);
    await expect(
      store.freezeFormula({
        ...revision,
        candidate: { ...revision.candidate, engineVersion: "different-engine" }
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(
      await admin`select id from design_studio.formula_versions where tenant_id = ${tenantId} and parent_formula_version_id = ${parent.formulaVersionId}`
    ).toHaveLength(1);
    expect(
      await admin`select id from platform.audit_events where tenant_id = ${tenantId} and resource_id = ${a.formulaVersionId}`
    ).toHaveLength(2);
  });

  it("revision audit failure rolls back version/lines; request replay adds no duplicate audit", async () => {
    const parent = await store.freezeFormula(base);
    const input = await evidence(parent, "REVISION_REQUIRED");
    const revision = {
      ...base,
      parentFormulaVersionId: parent.formulaVersionId,
      sourceTrialId: input.sourceTrialId,
      sourceEvaluationId: input.sourceEvaluationId
    };
    await expect(
      store.freezeFormula({ ...revision, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(
      await admin`select id from design_studio.formula_versions where tenant_id = ${tenantId} and parent_formula_version_id = ${parent.formulaVersionId}`
    ).toHaveLength(0);
    expect((await store.freezeFormula(revision)).versionNumber).toBe(2);
    const g5 = createPostgresTrialSensoryStore(runtime);
    const request = { ...input, parentFormulaVersionId: parent.formulaVersionId };
    await expect(
      g5.recordRevisionRequest({ ...request, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    await Promise.all([g5.recordRevisionRequest(request), g5.recordRevisionRequest(request)]);
    expect(
      await admin`select id from platform.audit_events where tenant_id = ${tenantId} and resource_id = ${input.sourceEvaluationId} and action = 'revision.requested'`
    ).toHaveLength(1);
  });
});
