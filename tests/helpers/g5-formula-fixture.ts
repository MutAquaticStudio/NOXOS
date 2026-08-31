import type { FrozenFormulaVersion, FormulaCandidate } from "@nox-os/design-studio";
import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";

export const G5_IDS = {
  tenantA: "81000000-0000-4000-8000-000000000001",
  tenantB: "81000000-0000-4000-8000-000000000002",
  actorA: "82000000-0000-4000-8000-000000000001",
  formula: "83000000-0000-4000-8000-000000000001",
  version: "84000000-0000-4000-8000-000000000001",
  project: "85000000-0000-4000-8000-000000000001",
  brief: "86000000-0000-4000-8000-000000000001",
  candidate: "87000000-0000-4000-8000-000000000001",
  materialA: "88000000-0000-4000-8000-000000000001",
  materialB: "88000000-0000-4000-8000-000000000002"
} as const;

function snapshot(id: string, name: string, term: string): MaterialIntelligenceSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-01T00:00:00.000Z",
    sourceMaterialUpdatedAt: "2026-08-31T00:00:00.000Z",
    snapshotHash: id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    material: {
      id,
      displayName: name,
      materialType: "SINGLE_MOLECULE",
      approvalStatus: "APPROVED",
      scope: "PLATFORM",
      visibility: "SHARED",
      noteClassification: "MID"
    },
    identifiers: { CAS: [], FEMA: [], INCI: [] },
    properties: null,
    normalizedProperties: { normalizationVersion: "g3-measurements-v1", warnings: [] },
    formulationGuidance: [
      {
        applicationKey: "fine-fragrance",
        minFormulaPct: 0,
        recommendedFormulaPct: 50,
        maxFormulaPct: 100,
        impactClass: "MEDIUM",
        confidence: "CURATED"
      }
    ],
    odorAssignments: [
      {
        taxonomyVersion: "1.2",
        assignmentType: "DESCRIPTOR",
        taxonomyTerm: term,
        intensity: 7
      }
    ],
    concentrate: null,
    components: []
  };
}

export function g5FrozenFormula(
  overrides: Partial<FrozenFormulaVersion> = {}
): FrozenFormulaVersion {
  const first = snapshot(G5_IDS.materialA, "Bergamot Fraction", "Bergamotty");
  const second = snapshot(G5_IDS.materialB, "Cedar Fraction", "Cedarwoody");
  const candidate: FormulaCandidate = {
    candidateId: G5_IDS.candidate,
    projectId: G5_IDS.project,
    sourceBriefId: G5_IDS.brief,
    compositionKind: "FULL_FORMULA",
    referenceFormulaMassMg: "1000000",
    generationStrategy: "FAITHFUL",
    engineVersion: "g4-test-v1",
    taxonomySource: "OSMO",
    taxonomyVersion: "osmo_v1.2",
    intentSnapshot: {
      schemaVersion: 1,
      taxonomySource: "OSMO",
      taxonomyVersion: "osmo_v1.2",
      required: [{ assignmentType: "DESCRIPTOR", taxonomyTerm: "Bergamotty", targetStrength: 0.8 }],
      preferred: [],
      excluded: [],
      inferred: [],
      applicationProfile: { applicationKey: "fine-fragrance", targetDosagePct: 20 },
      rawBriefSummary: "Citrus woods",
      unresolvedConcepts: []
    },
    lines: [
      {
        materialId: first.material.id,
        normalizedMassMg: "600000",
        activeAromaticMassMg: "600000",
        carrierSolventMassMg: "0",
        contributionEvidence: [],
        materialSnapshot: first
      },
      {
        materialId: second.material.id,
        normalizedMassMg: "400000",
        activeAromaticMassMg: "400000",
        carrierSolventMassMg: "0",
        contributionEvidence: [],
        materialSnapshot: second
      }
    ],
    resolvedComposition: {
      totalActiveAromaticPct: 100,
      totalCarrierSolventPct: 0,
      compositionCoveragePct: 100,
      unresolvedFractionPct: 0
    },
    validation: {
      structuralValidation: "PASS",
      materialEligibility: "PASS",
      knownLimitScreening: "REFERENCE_DATA_MISSING",
      unresolvedConstraints: [],
      warnings: [],
      releaseReadiness: "NOT_ASSESSED"
    },
    scientificContext: {
      capability: "CURATED_ONLY",
      rankingPolicyVersion: "curated-evidence-v1",
      formulaScorerVersion: "rules-v1"
    }
  };
  return {
    formulaId: G5_IDS.formula,
    formulaVersionId: G5_IDS.version,
    tenantId: G5_IDS.tenantA,
    projectId: G5_IDS.project,
    sourceBriefId: G5_IDS.brief,
    name: "Citrus Woods",
    versionNumber: 1,
    parentFormulaVersionId: null,
    compositionKind: candidate.compositionKind,
    generationStrategy: candidate.generationStrategy,
    engineVersion: candidate.engineVersion,
    status: "FROZEN",
    approvalState: "NOT_APPROVED",
    bundleHash: "b".repeat(64),
    candidate,
    frozenAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides
  };
}
