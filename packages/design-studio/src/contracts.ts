import { z } from "zod";
import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";

export const REFERENCE_FORMULA_MASS_MG = "1000000" as const;
export const G4_TAXONOMY_SOURCE = "OSMO" as const;
export const G4_TAXONOMY_VERSION = "osmo_v1.2" as const;

export const designWorkflowModeSchema = z.enum(["FORMULA_GENERATION", "ACCORD_ARCHITECTURE"]);
export type DesignWorkflowMode = z.infer<typeof designWorkflowModeSchema>;

export const compositionKindSchema = z.enum(["FULL_FORMULA", "ACCORD_FORMULATION"]);
export type CompositionKind = z.infer<typeof compositionKindSchema>;

export const massMgSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const positiveMassMgSchema = massMgSchema.refine((value) => BigInt(value) > 0n, {
  message: "Mass must be greater than zero."
});
export type MassMg = z.infer<typeof massMgSchema>;

export const releaseReadinessSchema = z.literal("NOT_ASSESSED");
export const knownLimitScreeningSchema = z.enum([
  "KNOWN_LIMIT_PASS",
  "KNOWN_LIMIT_EXCEEDED",
  "REFERENCE_DATA_MISSING",
  "NOT_ASSESSED"
]);
export type KnownLimitScreening = z.infer<typeof knownLimitScreeningSchema>;

export const osmoTaxonomyAssignmentTypeSchema = z.enum([
  "GRAND_FAMILY",
  "SUBFAMILY",
  "DESCRIPTOR",
  "TEXTURE",
  "SENSATION"
]);
export type OsmoTaxonomyAssignmentType = z.infer<typeof osmoTaxonomyAssignmentTypeSchema>;

export const taxonomyTargetSchema = z.object({
  assignmentType: osmoTaxonomyAssignmentTypeSchema,
  taxonomyTerm: z.string().trim().min(1).max(160),
  targetStrength: z.number().finite().min(0).max(1).optional()
});
export type AccordTaxonomyTarget = z.infer<typeof taxonomyTargetSchema>;

export const sourceSignalSchema = z.object({
  sourceAssetId: z.string().uuid().optional(),
  modality: z.enum(["TEXT", "IMAGE", "REFERENCE"]),
  signalType: z.enum(["OBJECT", "MOOD", "ENVIRONMENT", "TEXTURE", "CONCEPT"]),
  concept: z.string().trim().min(1).max(500),
  suggestedTaxonomyTerm: z.string().trim().min(1).max(160).optional(),
  suggestedAssignmentType: osmoTaxonomyAssignmentTypeSchema,
  strength: z.number().finite().min(0).max(1),
  inferenceConfidence: z.number().finite().min(0).max(1),
  interpreterVersion: z.string().trim().min(1).max(120)
});
export type SourceSignal = z.infer<typeof sourceSignalSchema>;

export const normalizedOlfactoryIntentSchema = z.object({
  schemaVersion: z.literal(1),
  taxonomySource: z.literal(G4_TAXONOMY_SOURCE),
  taxonomyVersion: z.literal(G4_TAXONOMY_VERSION),
  required: z.array(taxonomyTargetSchema),
  preferred: z.array(taxonomyTargetSchema),
  excluded: z.array(taxonomyTargetSchema.omit({ targetStrength: true })),
  inferred: z.array(taxonomyTargetSchema),
  applicationProfile: z.object({
    applicationKey: z.string().trim().min(1).max(120),
    targetDosagePct: z.number().finite().positive().max(100)
  }),
  rawBriefSummary: z.string().trim().min(1).max(4000),
  unresolvedConcepts: z.array(z.string().trim().min(1).max(500))
});
export type NormalizedOlfactoryIntent = z.infer<typeof normalizedOlfactoryIntentSchema>;

export const generationStrategySchema = z.string().trim().min(1).max(80);
export type GenerationStrategy =
  "FAITHFUL" | "EXPRESSIVE" | "MINIMALIST" | "BUDGET_EFFICIENT" | "LAYERED_ACCORD" | (string & {});

export const budgetContextSchema = z.object({
  mode: z.enum(["CONSTRAINED", "STANDARD", "OPEN"]),
  maxFormulaCostPerKg: z.number().finite().nonnegative().optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .optional()
});
export type BudgetContext = z.infer<typeof budgetContextSchema>;

const materialSnapshotSchema = z.custom<MaterialIntelligenceSnapshot>(
  (value) => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<MaterialIntelligenceSnapshot>;
    return (
      candidate.schemaVersion === 1 &&
      typeof candidate.snapshotHash === "string" &&
      candidate.snapshotHash.length === 64 &&
      typeof candidate.material?.id === "string" &&
      Array.isArray(candidate.components) &&
      Array.isArray(candidate.odorAssignments)
    );
  },
  { message: "Material snapshot is invalid." }
);

export const resolvedFormulaLineSchema = z
  .object({
    materialId: z.string().uuid(),
    normalizedMassMg: positiveMassMgSchema,
    activeAromaticMassMg: massMgSchema,
    carrierSolventMassMg: massMgSchema,
    solventType: z.string().trim().min(1).max(240).optional(),
    contributionEvidence: z.array(
      z.object({
        target: taxonomyTargetSchema,
        taxonomyMatch: z.number().min(0).max(1),
        intensityNormalization: z.number().min(0).max(1),
        phaseCompatibility: z.number().min(0).max(1),
        guidanceConfidence: z.number().min(0).max(1),
        evidenceQuality: z.number().min(0).max(1),
        molecularBonus: z.number().min(0).max(1),
        weightedScore: z.number().min(0).max(1)
      })
    ),
    materialSnapshot: materialSnapshotSchema
  })
  .superRefine((line, context) => {
    if (line.materialId !== line.materialSnapshot.material.id) {
      context.addIssue({ code: "custom", message: "Material ID must match its snapshot." });
    }
    if (
      BigInt(line.activeAromaticMassMg) + BigInt(line.carrierSolventMassMg) !==
      BigInt(line.normalizedMassMg)
    ) {
      context.addIssue({
        code: "custom",
        message: "Active and carrier mass must equal the line mass."
      });
    }
  });
export type ResolvedFormulaLine = z.infer<typeof resolvedFormulaLineSchema>;

export const formulaCandidateSchema = z
  .object({
    candidateId: z.string().uuid(),
    projectId: z.string().uuid(),
    sourceBriefId: z.string().uuid(),
    compositionKind: compositionKindSchema,
    referenceFormulaMassMg: z.literal(REFERENCE_FORMULA_MASS_MG),
    generationStrategy: generationStrategySchema,
    engineVersion: z.string().trim().min(1).max(120),
    taxonomySource: z.literal(G4_TAXONOMY_SOURCE),
    taxonomyVersion: z.literal(G4_TAXONOMY_VERSION),
    intentSnapshot: normalizedOlfactoryIntentSchema,
    lines: z.array(resolvedFormulaLineSchema).min(1),
    resolvedComposition: z.object({
      totalActiveAromaticPct: z.number().finite().min(0).max(100),
      totalCarrierSolventPct: z.number().finite().min(0).max(100),
      compositionCoveragePct: z.number().finite().min(0).max(100).optional(),
      unresolvedFractionPct: z.number().finite().min(0).max(100).optional()
    }),
    validation: z.object({
      structuralValidation: z.enum(["PASS", "FAIL"]),
      materialEligibility: z.enum(["PASS", "FAIL"]),
      knownLimitScreening: knownLimitScreeningSchema,
      unresolvedConstraints: z.array(z.string()),
      warnings: z.array(z.string()),
      releaseReadiness: releaseReadinessSchema
    }),
    scientificContext: z
      .object({
        capability: z.enum(["CURATED_ONLY", "MOLECULAR_AUGMENTED"]),
        structureStandardizerVersion: z.string().trim().min(1).optional(),
        molecularModelVersion: z.string().trim().min(1).optional(),
        rankingPolicyVersion: z.string().trim().min(1),
        formulaScorerVersion: z.string().trim().min(1),
        featureSchemaHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
      })
      .superRefine((value, context) => {
        if (
          value.capability === "MOLECULAR_AUGMENTED" &&
          (!value.structureStandardizerVersion ||
            !value.molecularModelVersion ||
            !value.featureSchemaHash)
        ) {
          context.addIssue({
            code: "custom",
            message: "Molecular capability requires verified model and feature-schema identity."
          });
        }
      })
  })
  .superRefine((candidate, context) => {
    const materialIds = new Set<string>();
    let total = 0n;
    for (const line of candidate.lines) {
      total += BigInt(line.normalizedMassMg);
      if (materialIds.has(line.materialId)) {
        context.addIssue({ code: "custom", message: "Duplicate Material lines are forbidden." });
      }
      materialIds.add(line.materialId);
    }
    if (total !== BigInt(REFERENCE_FORMULA_MASS_MG)) {
      context.addIssue({
        code: "custom",
        message: "Executable composition must total exactly 1,000,000 mg."
      });
    }
  });
export type FormulaCandidate = z.infer<typeof formulaCandidateSchema>;

export const trialContextSchema = z.object({
  formulaVersionId: z.string().uuid(),
  preparationMode: z.enum(["CONCENTRATE", "FINISHED_APPLICATION"]),
  applicationKey: z.string().trim().min(1).max(120),
  dosagePct: z.number().finite().positive().max(100),
  carrierOrBaseReference: z.string().trim().min(1).max(240).optional(),
  targetMassMg: positiveMassMgSchema,
  evaluationMedium: z.enum(["BLOTTER", "SKIN", "PRODUCT", "OTHER"]),
  sampleAgeMinutes: z.number().int().nonnegative(),
  ambientContext: z
    .object({
      temperatureC: z.number().finite().optional(),
      humidityPct: z.number().finite().min(0).max(100).optional()
    })
    .optional()
});
export type TrialContext = z.infer<typeof trialContextSchema>;

export type SensoryPhase = "TOP" | "MID" | "BASE" | "CROSS_PHASE";
export interface ConfirmedSensoryDelta {
  phase: SensoryPhase;
  assignmentType: OsmoTaxonomyAssignmentType;
  taxonomyTerm: string;
  delta: number;
}
export interface FormulaRevisionContext {
  parentFormulaVersionId: string;
  sourceTrialId: string;
  sourceEvaluationId: string;
  compositionKind: CompositionKind;
  taxonomySource: "OSMO";
  taxonomyVersion: "osmo_v1.2";
  trialContext: TrialContext;
  evaluationText: string;
  confirmedDeltas: ConfirmedSensoryDelta[];
}
export interface FormulaApprovalEvidence {
  formulaVersionId: string;
  sourceTrialId: string;
  sourceEvaluationId: string;
  compositionKind: CompositionKind;
  decision: "READY_FOR_APPROVAL";
  finalizedAt: string;
  taxonomySource: "OSMO";
  taxonomyVersion: "osmo_v1.2";
}

export interface FormulaRevisionPort {
  createRevisionCandidate(context: FormulaRevisionContext): Promise<FormulaCandidate[]>;
}
export interface FormulaApprovalPort {
  approveFrozenVersion(evidence: FormulaApprovalEvidence): Promise<void>;
}

/** Dependency-neutral G4 read boundary implemented by the G5 bounded context. */
export interface FormulaRevisionContextReader {
  findRevisionContext(input: {
    tenantId: string;
    sourceTrialId: string;
    sourceEvaluationId: string;
  }): Promise<FormulaRevisionContext | undefined>;
}

/** Dependency-neutral G4 evidence boundary implemented by the G5 bounded context. */
export interface FormulaApprovalEvidenceReader {
  findApprovalEvidence(input: {
    tenantId: string;
    formulaVersionId: string;
    sourceTrialId: string;
    sourceEvaluationId: string;
  }): Promise<FormulaApprovalEvidence | undefined>;
}
