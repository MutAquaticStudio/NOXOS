import { describe, expect, it } from "vitest";
import {
  KnownLimitV1Policy,
  ReleaseReadinessApplication,
  ReleaseReadinessProblem,
  type ApprovalTraceEvidence,
  type RegulatoryEvidenceSnapshot
} from "@nox-os/release-readiness";
import { InMemoryReleaseReadinessStore } from "../helpers/in-memory-release-readiness-store";
import {
  G6_IDS,
  g6Evidence,
  g6Formula,
  g6MaterialEvidence,
  verifiedTrace
} from "../helpers/g6-release-fixture";

function fixture() {
  const store = new InMemoryReleaseReadinessStore();
  let formula = g6Formula();
  let evidence: RegulatoryEvidenceSnapshot = g6Evidence(undefined, {
    materials: [
      g6MaterialEvidence(),
      g6MaterialEvidence({
        materialId: G6_IDS.materialB,
        displayName: "Unrestricted Cedar",
        activeAromaticMassMg: "400000",
        ifraRestricted: false,
        ifraCat4MaxPct: null,
        ifraAmendment: "51",
        ifraSourceReference: "IFRA-NONRESTRICTED-TEST"
      })
    ],
    formulaLineCount: 2
  });
  let trace: ApprovalTraceEvidence = verifiedTrace();
  const sources = {
    async findFrozenFormulaVersion(tenantId: string, formulaVersionId: string) {
      return tenantId === formula.tenantId && formulaVersionId === formula.formulaVersionId
        ? structuredClone(formula)
        : undefined;
    },
    async resolve() {
      return structuredClone(evidence);
    },
    async resolveApprovalTrace() {
      return structuredClone(trace);
    }
  };
  const application = new ReleaseReadinessApplication(
    store,
    sources,
    sources,
    sources,
    new KnownLimitV1Policy()
  );
  const context = {
    tenantId: G6_IDS.tenantA,
    actorUserId: G6_IDS.actorA,
    requestId: "req_g6",
    correlationId: "corr_g6"
  };
  const profile = {
    formulaVersionId: G6_IDS.version,
    applicationKey: "fine-fragrance",
    dosagePct: 10,
    policyKey: "g6-known-limit-v1" as const
  };
  return {
    application,
    store,
    context,
    profile,
    setFormula(value: typeof formula) {
      formula = value;
    },
    setEvidence(value: RegulatoryEvidenceSnapshot) {
      evidence = value;
    },
    setTrace(value: ApprovalTraceEvidence) {
      trace = value;
    }
  };
}

describe("G6 release assessment lifecycle", () => {
  it("creates an immutable READY assessment with authenticated actor provenance", async () => {
    const { application, store, context, profile } = fixture();
    const result = await application.assess(context, profile);
    expect(result.decision).toBe("READY");
    expect(result.createdByUserId).toBe(G6_IDS.actorA);
    expect(result.assessedByUserId).toBe(G6_IDS.actorA);
    expect(result.evidenceSnapshot.approvalTrace.verified).toBe(true);
    expect(store.auditActions).toEqual(["release-readiness.assessed"]);
  });

  it("rejects unapproved, accord, and cross-tenant Formula inputs before persistence", async () => {
    const target = fixture();
    target.setFormula(g6Formula({ approvalState: "NOT_APPROVED" }));
    await expect(target.application.assess(target.context, target.profile)).rejects.toMatchObject({
      code: "APPROVAL_EVIDENCE_REQUIRED"
    } satisfies Partial<ReleaseReadinessProblem>);
    target.setFormula({ ...g6Formula(), status: "DRAFT" } as unknown as ReturnType<
      typeof g6Formula
    >);
    await expect(target.application.assess(target.context, target.profile)).rejects.toMatchObject({
      code: "FORMULA_VERSION_NOT_FROZEN"
    });
    target.setFormula(
      g6Formula({
        compositionKind: "ACCORD_FORMULATION",
        candidate: {
          ...g6Formula().candidate,
          compositionKind: "ACCORD_FORMULATION"
        }
      })
    );
    await expect(target.application.assess(target.context, target.profile)).rejects.toMatchObject({
      code: "UNSUPPORTED_COMPOSITION_KIND"
    });
    await expect(
      target.application.assess({ ...target.context, tenantId: G6_IDS.tenantB }, target.profile)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(target.store.assessments.size).toBe(0);
  });

  it("preserves old evidence and creates explicit reassessment lineage", async () => {
    const target = fixture();
    const first = await target.application.assess(target.context, target.profile);
    target.setEvidence({
      ...first.evidenceSnapshot,
      resolvedAt: "2026-09-01T01:00:00.000Z",
      materials: first.evidenceSnapshot.materials.map((material, index) =>
        index === 0 ? { ...material, approvalStatus: "PENDING_REVIEW" } : material
      )
    });
    const second = await target.application.reassess(target.context, first.id);
    expect(second.decision).toBe("BLOCKED");
    expect(second.supersedesAssessmentId).toBe(first.id);
    expect(
      (await target.application.requireAssessment(target.context.tenantId, first.id)).decision
    ).toBe("READY");
    expect(target.store.auditActions).toEqual([
      "release-readiness.assessed",
      "release-readiness.reassessed"
    ]);
  });

  it("returns REVIEW_REQUIRED when approved legacy traceability is unavailable", async () => {
    const target = fixture();
    target.setTrace({
      verified: false,
      sourceTrialId: null,
      sourceEvaluationId: null,
      decision: null,
      finalizedAt: null
    });
    expect((await target.application.assess(target.context, target.profile)).decision).toBe(
      "REVIEW_REQUIRED"
    );
  });
});
