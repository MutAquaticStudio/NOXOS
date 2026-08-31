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
  evidence: z.object({
    identityConfidence: score.optional(),
    physicalDataCoverage: score.optional(),
    compositionCoveragePct: z.number().finite().min(0).max(100).optional()
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
      curatedTaxonomyFit: desired.length === 0 ? 0 : matchedTerms.length / desired.length,
      matchedTerms,
      conflictingTerms
    },
    evidence: {
      physicalDataCoverage: Math.min(1, physicalValues.length / 8),
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
    molecular: {
      applicability:
        input.snapshot.material.materialType === "SINGLE_MOLECULE"
          ? "SINGLE_MOLECULE"
          : input.snapshot.components.length > 0
            ? "KNOWN_COMPOSITION"
            : "CURATED_ONLY"
    },
    warnings: []
  });
  return { ...evidence, snapshot: input.snapshot };
}
