import { z } from "zod";
import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import {
  taxonomyTargetSchema,
  type AccordTaxonomyTarget,
  type NormalizedOlfactoryIntent
} from "./contracts.js";
import { DesignStudioProblem } from "./problem.js";
import { taxonomyTargetKey } from "./taxonomy.js";

const score = z.number().finite().min(0).max(1);
export const materialCandidateEvidenceSchema = z.object({
  materialId: z.string().uuid(),
  eligibility: z.object({
    approved: z.boolean(),
    tenantAccessible: z.boolean(),
    explicitExclusionPass: z.boolean(),
    dilutionValid: z.boolean(),
    compositionValid: z.boolean()
  }),
  semantic: z.object({
    curatedTaxonomyFit: score,
    matchedTerms: z.array(taxonomyTargetSchema),
    conflictingTerms: z.array(taxonomyTargetSchema)
  }),
  contributions: z.array(
    z.object({
      target: taxonomyTargetSchema,
      taxonomyMatch: score,
      intensityNormalization: score,
      phaseCompatibility: score,
      guidanceConfidence: score,
      evidenceQuality: score,
      molecularBonus: score,
      weightedScore: score
    })
  ),
  evidence: z.object({
    identityConfidence: score.optional(),
    physicalDataCoverage: score.optional(),
    compositionCoveragePct: z.number().finite().min(0).max(100).optional()
  }),
  guidance: z.object({
    applicationKey: z.string().trim().min(1),
    minFormulaPct: z.number().finite().min(0).max(100),
    recommendedFormulaPct: z.number().finite().min(0).max(100).optional(),
    maxFormulaPct: z.number().finite().min(0).max(100),
    impactClass: z.enum(["TRACE", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
    confidence: z.enum(["CURATED", "SOURCE_DERIVED", "ESTIMATED"])
  }),
  molecular: z
    .object({
      applicability: z.enum(["SINGLE_MOLECULE", "KNOWN_COMPOSITION", "CURATED_ONLY"]),
      modelVersion: z.string().optional(),
      embeddingSimilarity: score.optional(),
      predictedDescriptors: z
        .array(z.object({ taxonomyTerm: z.string().min(1), probability: score }))
        .optional()
    })
    .optional(),
  warnings: z.array(z.string())
});
export type MaterialCandidateEvidence = z.infer<typeof materialCandidateEvidenceSchema>;
export type MaterialCandidate = MaterialCandidateEvidence & {
  snapshot: MaterialIntelligenceSnapshot;
};

function structuralEligibility(snapshot: MaterialIntelligenceSnapshot): {
  dilutionValid: boolean;
  compositionValid: boolean;
} {
  const { material, concentrate, components } = snapshot;
  const componentIds = new Set<string>();
  let componentTotal = 0;
  let compositionValid = true;
  for (const component of components) {
    if (
      component.componentMaterialId === material.id ||
      componentIds.has(component.componentMaterialId)
    ) {
      compositionValid = false;
    }
    componentIds.add(component.componentMaterialId);
    if (component.percentage !== null) componentTotal += component.percentage;
  }
  if (componentTotal > 100) compositionValid = false;
  if (
    !(["NATURAL", "MIXTURE"] as const).includes(material.materialType as "NATURAL" | "MIXTURE") &&
    components.length > 0
  ) {
    compositionValid = false;
  }
  const dilutionValid =
    material.materialType === "DILUTION"
      ? Boolean(
          concentrate &&
          concentrate.sourceMaterialId !== material.id &&
          concentrate.concentrationPct > 0 &&
          concentrate.concentrationPct < 100 &&
          (concentrate.solventMaterialId || concentrate.solventCustomName) &&
          components.length === 0
        )
      : concentrate === null;
  return { dilutionValid, compositionValid };
}

function guidanceConfidence(value: "CURATED" | "SOURCE_DERIVED" | "ESTIMATED"): number {
  return value === "CURATED" ? 1 : value === "SOURCE_DERIVED" ? 0.85 : 0.65;
}

function expectedPhase(term: string): "TOP" | "MID" | "BASE" | undefined {
  if (/citrus|green|fresh|ozonic|aldehydic|mint/i.test(term)) return "TOP";
  if (/woody|balsamic|musky|resin|amber|leather|powder/i.test(term)) return "BASE";
  return undefined;
}

export function createMaterialCandidateEvidence(input: {
  snapshot: MaterialIntelligenceSnapshot;
  tenantAccessible: boolean;
  intent: NormalizedOlfactoryIntent;
}): MaterialCandidate {
  const approved = input.snapshot.material.approvalStatus === "APPROVED";
  if (!approved) {
    throw new DesignStudioProblem(409, "MATERIAL_INELIGIBLE", "Material must be approved.");
  }
  if (!input.tenantAccessible) {
    throw new DesignStudioProblem(403, "TENANT_ACCESS_DENIED", "Tenant access was denied.");
  }
  const { dilutionValid, compositionValid } = structuralEligibility(input.snapshot);
  if (!dilutionValid || !compositionValid) {
    throw new DesignStudioProblem(
      409,
      "MATERIAL_INELIGIBLE",
      "Material dilution or component structure is invalid."
    );
  }
  const desired = [...input.intent.required, ...input.intent.preferred, ...input.intent.inferred];
  const guidance = input.snapshot.formulationGuidance.find(
    (item) => item.applicationKey === input.intent.applicationProfile.applicationKey
  );
  if (!guidance) {
    throw new DesignStudioProblem(
      409,
      "FORMULATION_GUIDANCE_MISSING",
      "Material has no approved formulation guidance for the target application."
    );
  }
  if (guidance.maxFormulaPct <= 0) {
    throw new DesignStudioProblem(
      409,
      "MATERIAL_INELIGIBLE",
      "Material guidance does not permit a positive formula contribution."
    );
  }
  const odorKeys = new Set(
    input.snapshot.odorAssignments.map((assignment) =>
      taxonomyTargetKey({
        assignmentType: assignment.assignmentType,
        taxonomyTerm: assignment.taxonomyTerm
      })
    )
  );
  const matchedTerms = desired.filter((target) => odorKeys.has(taxonomyTargetKey(target)));
  const conflictingTerms = input.intent.excluded.filter((target) =>
    odorKeys.has(taxonomyTargetKey(target))
  );
  if (conflictingTerms.length > 0) {
    throw new DesignStudioProblem(
      409,
      "MATERIAL_INELIGIBLE",
      "Material conflicts with an exclusion."
    );
  }
  const physicalValues = Object.values(input.snapshot.properties ?? {}).filter(
    (value) => value !== null && value !== undefined
  );
  const physicalDataCoverage = Math.min(1, physicalValues.length / 8);
  const confidence = guidanceConfidence(guidance.confidence);
  const contributions = desired.map((target) => {
    const assignment = input.snapshot.odorAssignments.find(
      (value) =>
        value.assignmentType === target.assignmentType && value.taxonomyTerm === target.taxonomyTerm
    );
    const taxonomyMatch = assignment ? 1 : 0;
    const intensityNormalization = assignment
      ? assignment.intensity === null
        ? 0.5
        : assignment.intensity / 10
      : 0;
    const targetPhase = expectedPhase(target.taxonomyTerm);
    const note = input.snapshot.material.noteClassification;
    const phaseCompatibility =
      target.assignmentType === "TEXTURE" || target.assignmentType === "SENSATION"
        ? 1
        : !targetPhase || !note
          ? 0.75
          : targetPhase === note
            ? 1
            : 0.5;
    const evidenceQuality = 0.5 + physicalDataCoverage * 0.5;
    const molecularBonus = 0;
    return {
      target,
      taxonomyMatch,
      intensityNormalization,
      phaseCompatibility,
      guidanceConfidence: confidence,
      evidenceQuality,
      molecularBonus,
      weightedScore:
        taxonomyMatch * intensityNormalization * phaseCompatibility * confidence * evidenceQuality
    };
  });
  const evidence = materialCandidateEvidenceSchema.parse({
    materialId: input.snapshot.material.id,
    eligibility: {
      approved,
      tenantAccessible: input.tenantAccessible,
      explicitExclusionPass: true,
      dilutionValid,
      compositionValid
    },
    semantic: {
      curatedTaxonomyFit:
        contributions.length === 0
          ? 0
          : contributions.reduce((sum, value) => sum + value.weightedScore, 0) /
            contributions.length,
      matchedTerms,
      conflictingTerms
    },
    contributions,
    evidence: {
      physicalDataCoverage,
      compositionCoveragePct:
        input.snapshot.components.length === 0
          ? undefined
          : Math.min(
              100,
              input.snapshot.components.reduce(
                (total, component) => total + (component.percentage ?? 0),
                0
              )
            )
    },
    guidance: {
      applicationKey: guidance.applicationKey,
      minFormulaPct: guidance.minFormulaPct,
      ...(guidance.recommendedFormulaPct === undefined
        ? {}
        : { recommendedFormulaPct: guidance.recommendedFormulaPct }),
      maxFormulaPct: guidance.maxFormulaPct,
      impactClass: guidance.impactClass,
      confidence: guidance.confidence
    },
    molecular: {
      applicability:
        input.snapshot.material.materialType === "SINGLE_MOLECULE"
          ? "SINGLE_MOLECULE"
          : input.snapshot.components.length > 0
            ? "KNOWN_COMPOSITION"
            : "CURATED_ONLY"
    },
    warnings: guidance.confidence === "ESTIMATED" ? ["ESTIMATED_FORMULATION_GUIDANCE"] : []
  });
  return { ...evidence, snapshot: input.snapshot };
}
