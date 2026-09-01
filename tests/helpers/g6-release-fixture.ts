import type { FrozenFormulaVersion } from "@nox-os/design-studio";
import type {
  ApprovalTraceEvidence,
  RegulatoryEvidenceSnapshot,
  RegulatoryMaterialEvidence
} from "@nox-os/release-readiness";
import { G5_IDS, g5FrozenFormula } from "./g5-formula-fixture";

export const G6_IDS = {
  ...G5_IDS,
  actorB: "82000000-0000-4000-8000-000000000002",
  trial: "91000000-0000-4000-8000-000000000001",
  evaluation: "92000000-0000-4000-8000-000000000001"
} as const;

export function g6Formula(overrides: Partial<FrozenFormulaVersion> = {}): FrozenFormulaVersion {
  return g5FrozenFormula({ approvalState: "APPROVED", ...overrides });
}

export function g6MaterialEvidence(
  overrides: Partial<RegulatoryMaterialEvidence> = {}
): RegulatoryMaterialEvidence {
  return {
    materialId: G6_IDS.materialA,
    displayName: "Restricted Aromatic",
    materialType: "SINGLE_MOLECULE",
    approvalStatus: "APPROVED",
    tenantAccessible: true,
    frozenSnapshotHash: "a".repeat(64),
    frozenSourceMaterialUpdatedAt: "2026-08-31T00:00:00.000Z",
    currentSourceMaterialUpdatedAt: "2026-09-01T00:00:00.000Z",
    activeAromaticMassMg: "100000",
    carrierSolventMassMg: "0",
    ifraRestricted: true,
    ifraCat4MaxPct: 1,
    ifraLimits: {},
    ifraAmendment: "51",
    ifraSourceReference: "IFRA-STD-TEST",
    sourceReference: null,
    euAllergens: [],
    ...overrides
  };
}

export function verifiedTrace(): ApprovalTraceEvidence {
  return {
    verified: true,
    sourceTrialId: G6_IDS.trial,
    sourceEvaluationId: G6_IDS.evaluation,
    decision: "READY_FOR_APPROVAL",
    finalizedAt: "2026-09-01T00:00:00.000Z"
  };
}

export function g6Evidence(
  formula = g6Formula(),
  overrides: Partial<RegulatoryEvidenceSnapshot> = {}
): RegulatoryEvidenceSnapshot {
  return {
    resolvedAt: "2026-09-01T00:00:00.000Z",
    formulaVersionId: formula.formulaVersionId,
    formulaBundleHash: formula.bundleHash,
    compositionKind: formula.compositionKind,
    formulaStatus: formula.status,
    approvalState: formula.approvalState,
    referenceFormulaMassMg: formula.candidate.referenceFormulaMassMg,
    formulaLineCount: 1,
    approvalTrace: verifiedTrace(),
    materials: [g6MaterialEvidence()],
    ...overrides
  };
}
