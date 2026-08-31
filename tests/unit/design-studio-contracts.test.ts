import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import {
  REFERENCE_FORMULA_MASS_MG,
  designWorkflowModeSchema,
  formatMassMg,
  formulaCandidateSchema,
  massMgSchema,
  releaseReadinessSchema,
  resolveMaterialLineMass,
  scaleFormulaMasses,
  trialContextSchema
} from "@nox-os/design-studio";

const sourceManifest = JSON.parse(readFileSync("contracts/g4-sources.json", "utf8")) as {
  masterBlueprint: { version: string };
  masterPrompt: { version: string; beginMarker: string; endMarker: string; endOfFile: boolean };
};

function snapshot(
  materialType: MaterialIntelligenceSnapshot["material"]["materialType"] = "SINGLE_MOLECULE",
  concentrate: MaterialIntelligenceSnapshot["concentrate"] = null
): MaterialIntelligenceSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-31T00:00:00.000Z",
    sourceMaterialUpdatedAt: "2026-08-30T00:00:00.000Z",
    snapshotHash: "a".repeat(64),
    material: {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Name deliberately contains no concentration",
      materialType,
      approvalStatus: "APPROVED",
      scope: "PLATFORM",
      visibility: "SHARED",
      noteClassification: "MID"
    },
    identifiers: { CAS: [], FEMA: [], INCI: [] },
    properties: null,
    normalizedProperties: { normalizationVersion: "g3-measurements-v1", warnings: [] },
    formulationGuidance: [],
    odorAssignments: [],
    concentrate,
    components: []
  };
}

describe("G4 canonical source and contract preflight", () => {
  it("records the complete canonical source versions and markers", () => {
    expect(sourceManifest).toMatchObject({
      masterBlueprint: { version: "2.0-FINAL CANONICAL" },
      masterPrompt: {
        version: "2.2-COMPLETE",
        beginMarker: "G4_MASTER_PROMPT_BEGIN",
        endMarker: "G4_MASTER_PROMPT_END",
        endOfFile: true
      }
    });
  });

  it("allows exactly the two primary Design Studio workflows", () => {
    expect(designWorkflowModeSchema.parse("FORMULA_GENERATION")).toBe("FORMULA_GENERATION");
    expect(designWorkflowModeSchema.parse("ACCORD_ARCHITECTURE")).toBe("ACCORD_ARCHITECTURE");
    expect(designWorkflowModeSchema.safeParse("TRIAL").success).toBe(false);
  });

  it("keeps release readiness outside G4", () => {
    expect(releaseReadinessSchema.parse("NOT_ASSESSED")).toBe("NOT_ASSESSED");
    expect(releaseReadinessSchema.safeParse("READY").success).toBe(false);
  });

  it("requires integer milligram strings and the amended TrialContext field", () => {
    for (const value of ["0", "1", "1000000"]) expect(massMgSchema.parse(value)).toBe(value);
    for (const value of ["-1", "+1", "01", "1.0", " 1", "1 "]) {
      expect(massMgSchema.safeParse(value).success).toBe(false);
    }
    expect(REFERENCE_FORMULA_MASS_MG).toBe("1000000");
    expect(
      trialContextSchema.safeParse({
        formulaVersionId: "11111111-1111-4111-8111-111111111111",
        preparationMode: "CONCENTRATE",
        applicationKey: "fine-fragrance",
        dosagePct: 20,
        targetMassMg: "25000",
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 15
      }).success
    ).toBe(true);
    expect(
      trialContextSchema.safeParse({
        formulaVersionId: "11111111-1111-4111-8111-111111111111",
        preparationMode: "CONCENTRATE",
        applicationKey: "fine-fragrance",
        dosagePct: 20,
        targetMassG: "25",
        evaluationMedium: "BLOTTER",
        sampleAgeMinutes: 15
      }).success
    ).toBe(false);
  });
});

describe("G4 exact integer-mg math", () => {
  it("resolves a dilution only from structured concentrate data", () => {
    const result = resolveMaterialLineMass(
      snapshot("DILUTION", {
        sourceMaterialId: "22222222-2222-4222-8222-222222222222",
        concentrationPct: 10,
        solventMaterialId: null,
        solventCustomName: "TEC"
      }),
      "20250"
    );
    expect(result).toMatchObject({
      normalizedMassMg: "20250",
      activeAromaticMassMg: "2025",
      carrierSolventMassMg: "18225",
      solventType: "TEC"
    });
    expect(BigInt(result.activeAromaticMassMg) + BigInt(result.carrierSolventMassMg)).toBe(
      BigInt(result.normalizedMassMg)
    );
  });

  it("formats mass without decimals", () => {
    expect(formatMassMg("12500000")).toBe("12 kg 500 g");
    expect(formatMassMg("20250")).toBe("20 g 250 mg");
    expect(formatMassMg("750")).toBe("750 mg");
  });

  it("uses deterministic largest-remainder scaling and preserves the exact target", () => {
    const scaled = scaleFormulaMasses(
      [
        { materialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", normalizedMassMg: "500000" },
        { materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", normalizedMassMg: "500000" }
      ],
      "3"
    );
    expect(scaled).toEqual([
      { materialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", scaledMassMg: "1" },
      { materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", scaledMassMg: "2" }
    ]);
    expect(scaled.reduce((total, line) => total + BigInt(line.scaledMassMg), 0n)).toBe(3n);
  });

  it("rejects a FormulaCandidate that does not total exactly one kilogram", () => {
    const candidate = {
      candidateId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      sourceBriefId: "33333333-3333-4333-8333-333333333333",
      compositionKind: "FULL_FORMULA",
      referenceFormulaMassMg: "1000000",
      generationStrategy: "FAITHFUL",
      engineVersion: "g4-v1",
      taxonomySource: "OSMO",
      taxonomyVersion: "osmo_v1.2",
      intentSnapshot: {
        schemaVersion: 1,
        taxonomySource: "OSMO",
        taxonomyVersion: "osmo_v1.2",
        required: [],
        preferred: [],
        excluded: [],
        inferred: [],
        applicationProfile: { applicationKey: "fine-fragrance", targetDosagePct: 20 },
        rawBriefSummary: "A quiet floral direction.",
        unresolvedConcepts: []
      },
      lines: [
        {
          materialId: "11111111-1111-4111-8111-111111111111",
          normalizedMassMg: "999999",
          activeAromaticMassMg: "999999",
          carrierSolventMassMg: "0",
          materialSnapshot: snapshot()
        }
      ],
      resolvedComposition: { totalActiveAromaticPct: 100, totalCarrierSolventPct: 0 },
      validation: {
        structuralValidation: "PASS",
        materialEligibility: "PASS",
        knownLimitScreening: "NOT_ASSESSED",
        unresolvedConstraints: [],
        warnings: [],
        releaseReadiness: "NOT_ASSESSED"
      },
      scientificContext: {
        structureStandardizerVersion: "UNAVAILABLE",
        rankingPolicyVersion: "curated-v1",
        formulaScorerVersion: "rules-v1"
      }
    };
    expect(formulaCandidateSchema.safeParse(candidate).success).toBe(false);
  });
});
