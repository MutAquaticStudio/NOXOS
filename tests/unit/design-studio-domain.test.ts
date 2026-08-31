import { describe, expect, it } from "vitest";
import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import {
  DesignStudioProblem,
  DesignStudioApplication,
  RuleBasedFormulaPerceptionScorer,
  arbitrateIntent,
  buildAccordArchitecture,
  buildFormulaIntentFromAccords,
  computeFormulaBundleHash,
  confirmIntent,
  createMaterialCandidateEvidence,
  developAccordIntent,
  formulaCandidateSchema,
  generateFormulaCandidates,
  validateAccordArchitecture,
  validateFormulaCandidate
} from "@nox-os/design-studio";

function snapshot(input: {
  id: string;
  type?: MaterialIntelligenceSnapshot["material"]["materialType"];
  status?: MaterialIntelligenceSnapshot["material"]["approvalStatus"];
  term?: string;
  limit?: number | null;
}): MaterialIntelligenceSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-31T00:00:00.000Z",
    sourceMaterialUpdatedAt: "2026-08-30T00:00:00.000Z",
    snapshotHash: input.id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    material: {
      id: input.id,
      displayName: `Material ${input.id.slice(0, 4)}`,
      materialType: input.type ?? "SINGLE_MOLECULE",
      approvalStatus: input.status ?? "APPROVED",
      scope: "PLATFORM",
      visibility: "SHARED",
      noteClassification: "MID"
    },
    identifiers: { CAS: [], FEMA: [], INCI: [] },
    properties:
      input.limit === undefined
        ? null
        : {
            appearance: null,
            assay: null,
            fccListed: null,
            specificGravity: null,
            poundsPerGallon: null,
            refractiveIndex: null,
            boilingPoint: null,
            acidValue: null,
            vaporPressure: null,
            flashPoint: null,
            logpOw: null,
            shelfLife: null,
            storage: null,
            sourceReference: null,
            ifraCat4MaxPct: input.limit,
            ifraAmendment: null,
            ifraSourceReference: null
          },
    odorAssignments: input.term
      ? [
          {
            taxonomyVersion: "1.2",
            assignmentType: "DESCRIPTOR",
            taxonomyTerm: input.term,
            intensity: 7
          }
        ]
      : [],
    concentrate: null,
    components: []
  };
}

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"
] as const;

function confirmedIntent() {
  const draft = arbitrateIntent({
    rawBriefSummary: "A bright bergamot direction with a smooth drydown.",
    applicationProfile: { applicationKey: "fine-fragrance", targetDosagePct: 20 },
    explicitTags: [
      { assignmentType: "DESCRIPTOR", taxonomyTerm: "Bergamotty", targetStrength: 0.9 }
    ],
    explicitExclusions: [],
    signals: []
  });
  return confirmIntent(draft, { confirmed: true, confirmedByUserId: ids[0] });
}

describe("P0-P4 arbitration and confirmation", () => {
  it("lets P0 exclusion defeat explicit tags, text, reference and image signals", () => {
    const result = arbitrateIntent({
      rawBriefSummary: "A bright brief.",
      applicationProfile: { applicationKey: "fine-fragrance", targetDosagePct: 18 },
      explicitTags: [
        { assignmentType: "DESCRIPTOR", taxonomyTerm: "Bergamotty", targetStrength: 1 }
      ],
      explicitExclusions: [{ assignmentType: "DESCRIPTOR", taxonomyTerm: "Bergamotty" }],
      signals: ["TEXT", "REFERENCE", "IMAGE"].map((modality, index) => ({
        modality: modality as "TEXT" | "REFERENCE" | "IMAGE",
        signalType: "CONCEPT" as const,
        concept: `signal-${index}`,
        suggestedAssignmentType: "DESCRIPTOR" as const,
        suggestedTaxonomyTerm: "Bergamotty",
        strength: 0.8,
        inferenceConfidence: 0.8,
        interpreterVersion: "test-v1"
      }))
    });
    expect(result.intent.excluded).toEqual([
      { assignmentType: "DESCRIPTOR", taxonomyTerm: "Bergamotty" }
    ]);
    expect(result.intent.required).toHaveLength(0);
    expect(result.intent.preferred).toHaveLength(0);
    expect(result.intent.inferred).toHaveLength(0);
  });

  it("keeps unsupported concepts unresolved and requires explicit human confirmation", () => {
    const draft = arbitrateIntent({
      rawBriefSummary: "An imaginary impossible term.",
      applicationProfile: { applicationKey: "fine-fragrance", targetDosagePct: 20 },
      explicitTags: [],
      explicitExclusions: [],
      signals: [
        {
          modality: "IMAGE",
          signalType: "CONCEPT",
          concept: "moonlight chrome",
          suggestedAssignmentType: "DESCRIPTOR",
          suggestedTaxonomyTerm: "NOT_A_CANONICAL_TERM",
          strength: 0.7,
          inferenceConfidence: 0.5,
          interpreterVersion: "vision-v1"
        }
      ]
    });
    expect(draft.intent.unresolvedConcepts).toEqual(["moonlight chrome"]);
    expect(() => confirmIntent(draft, { confirmed: false, confirmedByUserId: ids[0] })).toThrow(
      /confirmation/i
    );
  });
});

describe("Accord Architecture", () => {
  it("produces one inspectable material-free plan with valid relationships", () => {
    const plan = buildAccordArchitecture({
      projectId: ids[0],
      sourceBriefId: ids[1],
      confirmedIntent: confirmedIntent()
    });
    expect(plan.accords.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).not.toMatch(/materialId|normalizedMassMg/);
    expect(validateAccordArchitecture(plan)).toEqual([]);
  });

  it("develops one accord only on explicit action and combines accords into one global intent", () => {
    const plan = buildAccordArchitecture({
      projectId: ids[0],
      sourceBriefId: ids[1],
      confirmedIntent: confirmedIntent()
    });
    expect(() => developAccordIntent(plan, plan.accords[0].accordKey, false)).toThrow(/explicit/i);
    expect(developAccordIntent(plan, plan.accords[0].accordKey, true).required).toEqual(
      plan.accords[0].taxonomyTargets
    );
    const global = buildFormulaIntentFromAccords(plan);
    expect(global.required).toEqual(expect.arrayContaining(plan.accords[0].taxonomyTargets));
  });
});

describe("Material evidence and deterministic Formula synthesis", () => {
  it("fails closed for pending, inaccessible and excluded Materials", () => {
    expect(() =>
      createMaterialCandidateEvidence({
        snapshot: snapshot({ id: ids[0], status: "PENDING_REVIEW", term: "Bergamotty" }),
        tenantAccessible: true,
        intent: confirmedIntent().intent
      })
    ).toThrowError(DesignStudioProblem);
    expect(() =>
      createMaterialCandidateEvidence({
        snapshot: snapshot({ id: ids[0], term: "Bergamotty" }),
        tenantAccessible: false,
        intent: confirmedIntent().intent
      })
    ).toThrow(/access/i);
  });

  it("generates three valid directions from curated evidence when molecular data is unavailable", () => {
    const intent = confirmedIntent();
    const evidence = [
      snapshot({ id: ids[0], term: "Bergamotty", limit: 100 }),
      snapshot({ id: ids[1], term: "Smooth", limit: 100 }),
      snapshot({ id: ids[2], term: "Bergamotty", limit: 100 }),
      snapshot({ id: ids[3], term: "Smooth", limit: 100 })
    ].map((material) =>
      createMaterialCandidateEvidence({
        snapshot: material,
        tenantAccessible: true,
        intent: intent.intent
      })
    );
    const candidates = generateFormulaCandidates({
      projectId: ids[0],
      sourceBriefId: ids[1],
      confirmedIntent: intent,
      evidence,
      budget: { mode: "OPEN" },
      scorer: new RuleBasedFormulaPerceptionScorer()
    });
    expect(candidates.map((candidate) => candidate.generationStrategy)).toEqual([
      "FAITHFUL",
      "EXPRESSIVE",
      "LAYERED_ACCORD"
    ]);
    for (const candidate of candidates) {
      expect(formulaCandidateSchema.parse(candidate)).toBeTruthy();
      expect(validateFormulaCandidate(candidate)).toEqual([]);
      expect(candidate.lines.reduce((sum, line) => sum + BigInt(line.normalizedMassMg), 0n)).toBe(
        1_000_000n
      );
      expect(candidate.validation.releaseReadiness).toBe("NOT_ASSESSED");
      expect(candidate.scientificContext.structureStandardizerVersion).toBe("MODEL_UNAVAILABLE");
    }
  });

  it("uses MINIMALIST rather than claiming budget efficiency without a trusted resolver", () => {
    const intent = confirmedIntent();
    const evidence = ids.slice(0, 3).map((id) =>
      createMaterialCandidateEvidence({
        snapshot: snapshot({ id, term: "Bergamotty" }),
        tenantAccessible: true,
        intent: intent.intent
      })
    );
    const candidates = generateFormulaCandidates({
      projectId: ids[0],
      sourceBriefId: ids[1],
      confirmedIntent: intent,
      evidence,
      budget: { mode: "CONSTRAINED", maxFormulaCostPerKg: 100 },
      scorer: new RuleBasedFormulaPerceptionScorer()
    });
    expect(candidates[2].generationStrategy).toBe("MINIMALIST");
    expect(candidates[2].validation.warnings).toContain("COST_RESOLVER_UNAVAILABLE");
  });
});

describe("Formula Bundle Hash", () => {
  it("is stable under line order but changes with mass or snapshot hash", () => {
    const base = [
      { materialId: ids[0], normalizedMassMg: "400000", snapshotHash: "a".repeat(64) },
      { materialId: ids[1], normalizedMassMg: "600000", snapshotHash: "b".repeat(64) }
    ];
    const first = computeFormulaBundleHash("FULL_FORMULA", base);
    expect(computeFormulaBundleHash("FULL_FORMULA", [...base].reverse())).toBe(first);
    expect(
      computeFormulaBundleHash("FULL_FORMULA", [
        { ...base[0], normalizedMassMg: "400001" },
        { ...base[1], normalizedMassMg: "599999" }
      ])
    ).not.toBe(first);
    expect(
      computeFormulaBundleHash("FULL_FORMULA", [
        { ...base[0], snapshotHash: "c".repeat(64) },
        base[1]
      ])
    ).not.toBe(first);
  });
});

describe("server-side tenant and RBAC boundary", () => {
  it("rejects unauthorized planning, generation and Freeze before side effects", async () => {
    let reads = 0;
    const application = new DesignStudioApplication({
      async loadApprovedForTenant() {
        reads += 1;
        return [];
      }
    });
    const context = { actorUserId: ids[0], tenantId: ids[1], permissions: new Set<string>() };
    expect(() =>
      application.planAccordArchitecture(context, {
        projectId: ids[0],
        sourceBriefId: ids[1],
        confirmedIntent: confirmedIntent()
      })
    ).toThrow(/permission/i);
    await expect(
      application.generateFormula(context, {
        projectId: ids[0],
        sourceBriefId: ids[1],
        confirmedIntent: confirmedIntent(),
        materialIds: [ids[2]],
        budget: { mode: "OPEN" },
        scorer: new RuleBasedFormulaPerceptionScorer()
      })
    ).rejects.toThrow(/permission/i);
    expect(() => application.freezeFormula(context)).toThrow(/permission/i);
    expect(reads).toBe(0);
  });

  it("passes only the server-resolved tenant ID to Material retrieval", async () => {
    const tenantIds: string[] = [];
    const material = snapshot({ id: ids[2], term: "Bergamotty", limit: 100 });
    const application = new DesignStudioApplication({
      async loadApprovedForTenant(tenantId) {
        tenantIds.push(tenantId);
        return [{ snapshot: material, tenantAccessible: true }];
      }
    });
    const result = await application.generateFormula(
      {
        actorUserId: ids[0],
        tenantId: ids[1],
        permissions: new Set(["module.design-studio.formula.generate"])
      },
      {
        projectId: ids[0],
        sourceBriefId: ids[1],
        confirmedIntent: confirmedIntent(),
        materialIds: [ids[2]],
        budget: { mode: "OPEN" },
        scorer: new RuleBasedFormulaPerceptionScorer()
      }
    );
    expect(tenantIds).toEqual([ids[1]]);
    expect(result).toHaveLength(3);
  });
});
