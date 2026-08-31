import { describe, expect, it } from "vitest";
import { DesignStudioApplication, DesignStudioFormulaRevisionPort } from "@nox-os/design-studio";
import {
  TrialSensoryApplication,
  finalEvaluationDecisionSchema,
  massMgSchema,
  sensoryDeltaDraftSchema,
  sensoryPhaseSchema,
  supportedTrialCompositionKindSchema
} from "@nox-os/trial-sensory";
import { InMemoryTrialSensoryStore } from "../helpers/in-memory-trial-sensory-store";
import { InMemoryDesignStudioStore } from "../helpers/in-memory-design-studio-store";
import { G5_IDS, g5FrozenFormula } from "../helpers/g5-formula-fixture";

const command = {
  tenantId: G5_IDS.tenantA,
  actorUserId: G5_IDS.actorA,
  requestId: "req_g5",
  correlationId: "corr_g5"
};

function fixture(formula = g5FrozenFormula()) {
  const store = new InMemoryTrialSensoryStore();
  const application = new TrialSensoryApplication(store, {
    async findFrozenFormulaVersion(tenantId, formulaVersionId) {
      return formula.tenantId === tenantId && formula.formulaVersionId === formulaVersionId
        ? structuredClone(formula)
        : undefined;
    }
  });
  return { store, application };
}

async function draftTrial(application: TrialSensoryApplication, targetMassMg = "10000") {
  return application.createTrial(command, {
    formulaVersionId: G5_IDS.version,
    preparationMode: "CONCENTRATE",
    applicationKey: "fine-fragrance",
    dosagePct: 20,
    carrierOrBaseReference: null,
    targetMassMg
  });
}

describe("Gate 5 contracts", () => {
  it("keeps MassMg integer-only and deltas integer-bound", () => {
    expect(massMgSchema.safeParse("1000").success).toBe(true);
    expect(massMgSchema.safeParse("1.5").success).toBe(false);
    expect(
      sensoryDeltaDraftSchema.safeParse({
        phase: "TOP",
        assignmentType: "DESCRIPTOR",
        taxonomyTerm: "Bergamotty",
        confirmedDelta: 1.5
      }).success
    ).toBe(false);
    expect(
      sensoryDeltaDraftSchema.safeParse({
        phase: "TOP",
        assignmentType: "DESCRIPTOR",
        taxonomyTerm: "Bergamotty",
        confirmedDelta: 6
      }).success
    ).toBe(false);
  });

  it("accepts only canonical phases and executable composition kinds", () => {
    expect(sensoryPhaseSchema.options).toEqual(["TOP", "MID", "BASE", "CROSS_PHASE"]);
    expect(supportedTrialCompositionKindSchema.options).toEqual([
      "FULL_FORMULA",
      "ACCORD_FORMULATION"
    ]);
    expect(finalEvaluationDecisionSchema.options).toEqual([
      "REVISION_REQUIRED",
      "READY_FOR_APPROVAL"
    ]);
  });
});

describe("Trial preparation", () => {
  it("creates from tenant-accessible frozen truth and reuses exact G4 scaling", async () => {
    const { application } = fixture();
    const draft = await draftTrial(application);
    expect(draft.status).toBe("DRAFT");
    expect(draft.formulaBundleHash).toBe("b".repeat(64));
    const prepared = await application.prepareTrial(command, draft.id);
    expect(prepared.lines.map((line) => line.scaledMassMg)).toEqual(["6000", "4000"]);
    expect(prepared.lines.reduce((sum, line) => sum + BigInt(line.scaledMassMg), 0n)).toBe(10000n);
  });

  it("rejects cross-tenant or unsupported Formula truth", async () => {
    const { application } = fixture();
    await expect(
      application.createTrial(
        { ...command, tenantId: G5_IDS.tenantB },
        {
          formulaVersionId: G5_IDS.version,
          preparationMode: "CONCENTRATE",
          applicationKey: "fine-fragrance",
          dosagePct: 20,
          targetMassMg: "10000"
        }
      )
    ).rejects.toMatchObject({ code: "FORMULA_VERSION_NOT_FROZEN" });
    const unsupported = g5FrozenFormula({ compositionKind: "ACCORD_ARCHITECTURE" as never });
    await expect(draftTrial(fixture(unsupported).application)).rejects.toMatchObject({
      code: "UNSUPPORTED_COMPOSITION_KIND"
    });
  });

  it("rejects a non-FROZEN FormulaVersion even if an adapter returns it", async () => {
    const draft = { ...g5FrozenFormula(), status: "DRAFT" as never };
    await expect(draftTrial(fixture(draft).application)).rejects.toMatchObject({
      code: "FORMULA_VERSION_NOT_FROZEN"
    });
  });

  it("prepares an ACCORD_FORMULATION while leaving ACCORD_ARCHITECTURE non-executable", async () => {
    const accord = g5FrozenFormula({ compositionKind: "ACCORD_FORMULATION" });
    const { application } = fixture(accord);
    const prepared = await application.prepareTrial(command, (await draftTrial(application)).id);
    expect(prepared.compositionKind).toBe("ACCORD_FORMULATION");
    expect(prepared.lines.reduce((sum, line) => sum + BigInt(line.scaledMassMg), 0n)).toBe(10000n);
  });

  it("fails closed below the one milligram balance resolution", async () => {
    const { application } = fixture();
    const trial = await draftTrial(application, "1");
    await expect(application.prepareTrial(command, trial.id)).rejects.toMatchObject({
      code: "BELOW_WEIGHABLE_RESOLUTION"
    });
  });

  it("does not prepare a Trial twice", async () => {
    const { application } = fixture();
    const prepared = await application.prepareTrial(command, (await draftTrial(application)).id);
    await expect(application.prepareTrial(command, prepared.id)).rejects.toMatchObject({
      code: "TRIAL_ALREADY_PREPARED"
    });
  });
});

describe("Sensory evidence and G4 handoff", () => {
  it("preserves raw text, supports manual mapping, finalizes atomically and locks FINAL", async () => {
    const { application } = fixture();
    const prepared = await application.prepareTrial(command, (await draftTrial(application)).id);
    const evaluation = await application.createEvaluation(command, prepared.id, {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 30,
      temperatureC: 24,
      humidityPct: 60,
      evaluationText: "Opening is too quiet; drydown is balanced.",
      diagnosticNote: "Whole formula observation"
    });
    const deltas = [
      {
        phase: "TOP" as const,
        assignmentType: "DESCRIPTOR" as const,
        taxonomyTerm: "Bergamotty",
        proposedDelta: 2,
        confirmedDelta: 3,
        proposalConfidence: 0.6,
        interpreterVersion: "manual-test"
      }
    ];
    await application.updateEvaluation(command, prepared.id, evaluation.id, {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 30,
      temperatureC: 24,
      humidityPct: 60,
      evaluationText: "Opening is too quiet; drydown is balanced.",
      diagnosticNote: "Whole formula observation",
      deltas
    });
    const finalized = await application.finalizeEvaluation(command, prepared.id, evaluation.id, {
      decision: "REVISION_REQUIRED",
      deltas
    });
    expect(finalized.status).toBe("FINAL");
    expect(finalized.evaluationText).toContain("Opening is too quiet");
    expect((await application.requireTrial(G5_IDS.tenantA, prepared.id)).status).toBe("COMPLETED");
    await expect(
      application.updateEvaluation(command, prepared.id, evaluation.id, {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 30,
        evaluationText: "mutate",
        diagnosticNote: null,
        deltas
      })
    ).rejects.toMatchObject({ code: "EVALUATION_ALREADY_FINAL" });
    const context = await application.findRevisionContext({
      tenantId: G5_IDS.tenantA,
      sourceTrialId: prepared.id,
      sourceEvaluationId: evaluation.id
    });
    expect(context).toMatchObject({
      parentFormulaVersionId: G5_IDS.version,
      compositionKind: "FULL_FORMULA",
      confirmedDeltas: [{ delta: 3 }]
    });
    expect(context?.trialContext).toMatchObject({
      targetMassMg: "10000",
      sampleAgeMinutes: 30,
      ambientContext: { temperatureC: 24, humidityPct: 60 }
    });
  });

  it("keeps manual finalization available when the interpreter is unavailable", () => {
    expect(() => fixture().application.interpret()).toThrow(
      expect.objectContaining({ code: "INTERPRETER_UNAVAILABLE" })
    );
  });

  it("requires a PREPARED Trial and rejects non-canonical taxonomy", async () => {
    const { application } = fixture();
    const draft = await draftTrial(application);
    await expect(
      application.createEvaluation(command, draft.id, {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 0,
        evaluationText: "Draft Trial must fail.",
        diagnosticNote: null
      })
    ).rejects.toMatchObject({ code: "TRIAL_NOT_PREPARED" });
    const prepared = await application.prepareTrial(command, draft.id);
    const evaluation = await application.createEvaluation(command, prepared.id, {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 15,
      evaluationText: "Manual evaluation.",
      diagnosticNote: null
    });
    await expect(
      application.finalizeEvaluation(command, prepared.id, evaluation.id, {
        decision: "REVISION_REQUIRED",
        deltas: [
          {
            phase: "TOP",
            assignmentType: "DESCRIPTOR",
            taxonomyTerm: "Invented taxonomy term",
            proposedDelta: 1,
            confirmedDelta: 2
          }
        ]
      })
    ).rejects.toMatchObject({ code: "INVALID_TAXONOMY_TERM" });
  });

  it("keeps proposals non-canonical until the evaluator confirms a different integer", async () => {
    const { application } = fixture();
    const prepared = await application.prepareTrial(command, (await draftTrial(application)).id);
    const evaluation = await application.createEvaluation(command, prepared.id, {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 45,
      evaluationText: "The opening needs adjustment.",
      diagnosticNote: null
    });
    const finalized = await application.finalizeEvaluation(command, prepared.id, evaluation.id, {
      decision: "REVISION_REQUIRED",
      deltas: [
        {
          phase: "TOP",
          assignmentType: "DESCRIPTOR",
          taxonomyTerm: "Bergamotty",
          proposedDelta: 1,
          confirmedDelta: 3,
          proposalConfidence: 0.7,
          interpreterVersion: "optional-interpreter"
        }
      ]
    });
    expect(finalized.deltas[0]).toMatchObject({ proposedDelta: 1, confirmedDelta: 3 });
  });

  it("emits approval evidence only for FINAL READY_FOR_APPROVAL on the same Formula", async () => {
    const { application } = fixture();
    const trial = await application.prepareTrial(command, (await draftTrial(application)).id);
    const evaluation = await application.createEvaluation(command, trial.id, {
      evaluationMedium: "PRODUCT",
      sampleAgeMinutes: 120,
      evaluationText: "Balanced and ready.",
      diagnosticNote: null
    });
    await application.finalizeEvaluation(command, trial.id, evaluation.id, {
      decision: "READY_FOR_APPROVAL",
      deltas: []
    });
    await expect(
      application.findApprovalEvidence({
        tenantId: G5_IDS.tenantA,
        formulaVersionId: G5_IDS.version,
        sourceTrialId: trial.id,
        sourceEvaluationId: evaluation.id
      })
    ).resolves.toMatchObject({ decision: "READY_FOR_APPROVAL", formulaVersionId: G5_IDS.version });
  });

  it("lets G4 regenerate revision candidates without letting G5 choose Materials or masses", async () => {
    const parent = g5FrozenFormula();
    const designStore = new InMemoryDesignStudioStore();
    designStore.formulaVersions.set(parent.formulaVersionId, parent);
    const designApplication = new DesignStudioApplication({
      async retrieveApprovedForTenant() {
        return parent.candidate.lines.map((line) => ({
          snapshot: line.materialSnapshot,
          tenantAccessible: true
        }));
      }
    });
    const port = new DesignStudioFormulaRevisionPort(designApplication, designStore, {
      tenantId: G5_IDS.tenantA,
      actorUserId: G5_IDS.actorA,
      permissions: new Set()
    });
    const candidates = await port.createRevisionCandidate({
      parentFormulaVersionId: G5_IDS.version,
      sourceTrialId: "89000000-0000-4000-8000-000000000001",
      sourceEvaluationId: "89000000-0000-4000-8000-000000000002",
      compositionKind: "FULL_FORMULA",
      taxonomySource: "OSMO",
      taxonomyVersion: "osmo_v1.2",
      trialContext: {
        formulaVersionId: G5_IDS.version,
        preparationMode: "CONCENTRATE",
        applicationKey: "fine-fragrance",
        dosagePct: 20,
        targetMassMg: "10000",
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 45
      },
      evaluationText: "Increase the citrus opening.",
      confirmedDeltas: [
        {
          phase: "TOP",
          assignmentType: "DESCRIPTOR",
          taxonomyTerm: "Bergamotty",
          delta: 3
        }
      ]
    });
    expect(candidates[0].intentSnapshot.required[0].targetStrength).toBeCloseTo(0.95);
    expect(parent.candidate.intentSnapshot.required[0].targetStrength).toBe(0.8);
    expect(
      candidates[0].lines.every((line) =>
        parent.candidate.lines.some((source) => source.materialId === line.materialId)
      )
    ).toBe(true);
  });

  it("returns Accord revision and approval evidence without Material sensory scores", async () => {
    const { application } = fixture(g5FrozenFormula({ compositionKind: "ACCORD_FORMULATION" }));
    const trial = await application.prepareTrial(command, (await draftTrial(application)).id);
    const revisionEvaluation = await application.createEvaluation(command, trial.id, {
      evaluationMedium: "BLOTTER",
      sampleAgeMinutes: 60,
      evaluationText: "The Accord needs a stronger jasminy center.",
      diagnosticNote: "Whole Accord only"
    });
    await application.finalizeEvaluation(command, trial.id, revisionEvaluation.id, {
      decision: "REVISION_REQUIRED",
      deltas: [
        {
          phase: "MID",
          assignmentType: "DESCRIPTOR",
          taxonomyTerm: "Jasminy",
          confirmedDelta: 2
        }
      ]
    });
    const context = await application.findRevisionContext({
      tenantId: G5_IDS.tenantA,
      sourceTrialId: trial.id,
      sourceEvaluationId: revisionEvaluation.id
    });
    expect(context?.compositionKind).toBe("ACCORD_FORMULATION");
    expect(JSON.stringify(context)).not.toContain("materialId");

    const approvalFixture = fixture(g5FrozenFormula({ compositionKind: "ACCORD_FORMULATION" }));
    const approvalTrial = await approvalFixture.application.prepareTrial(
      command,
      (await draftTrial(approvalFixture.application)).id
    );
    const approvalEvaluation = await approvalFixture.application.createEvaluation(
      command,
      approvalTrial.id,
      {
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 60,
        evaluationText: "The Accord is ready.",
        diagnosticNote: null
      }
    );
    await approvalFixture.application.finalizeEvaluation(
      command,
      approvalTrial.id,
      approvalEvaluation.id,
      { decision: "READY_FOR_APPROVAL", deltas: [] }
    );
    await expect(
      approvalFixture.application.findApprovalEvidence({
        tenantId: G5_IDS.tenantA,
        formulaVersionId: G5_IDS.version,
        sourceTrialId: approvalTrial.id,
        sourceEvaluationId: approvalEvaluation.id
      })
    ).resolves.toMatchObject({ compositionKind: "ACCORD_FORMULATION" });
  });
});
