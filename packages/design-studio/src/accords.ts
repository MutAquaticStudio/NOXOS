import { z } from "zod";
import {
  normalizedOlfactoryIntentSchema,
  sourceSignalSchema,
  taxonomyTargetSchema,
  type AccordTaxonomyTarget,
  type NormalizedOlfactoryIntent
} from "./contracts.js";
import type { ConfirmedIntent } from "./intent.js";
import { DesignStudioProblem } from "./problem.js";
import { isCanonicalTaxonomyTarget, taxonomyTargetKey } from "./taxonomy.js";

export const accordFunctionalRoleSchema = z.enum([
  "CORE",
  "SUPPORT",
  "BRIDGE",
  "CONTRAST",
  "FOUNDATION"
]);
export const accordPhaseSchema = z.enum(["TOP", "MID", "BASE", "CROSS_PHASE"]);

export const accordSuggestionSchema = z.object({
  accordKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(160),
  phase: accordPhaseSchema,
  functionalRole: accordFunctionalRoleSchema,
  purpose: z.string().trim().min(1).max(1000),
  taxonomyTargets: z.array(taxonomyTargetSchema).min(1),
  required: z.boolean(),
  supportsAccordKeys: z.array(z.string()),
  contrastsAccordKeys: z.array(z.string()),
  excludedConflicts: z.array(taxonomyTargetSchema),
  provenance: z.array(sourceSignalSchema)
});
export type AccordSuggestion = z.infer<typeof accordSuggestionSchema>;

export const accordArchitecturePlanSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  sourceBriefId: z.string().uuid(),
  taxonomySource: z.literal("OSMO"),
  taxonomyVersion: z.literal("osmo_v1.2"),
  intentSnapshot: normalizedOlfactoryIntentSchema,
  accords: z.array(accordSuggestionSchema).min(1),
  unresolvedConcepts: z.array(z.string())
});
export type AccordArchitecturePlan = z.infer<typeof accordArchitecturePlanSchema>;

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "accord"
  );
}

function phaseFor(target: AccordTaxonomyTarget): AccordSuggestion["phase"] {
  return target.assignmentType === "TEXTURE" || target.assignmentType === "SENSATION"
    ? "CROSS_PHASE"
    : "MID";
}

function roleFor(target: AccordTaxonomyTarget, index: number): AccordSuggestion["functionalRole"] {
  if (index === 0) return "CORE";
  if (target.assignmentType === "TEXTURE" || target.assignmentType === "SENSATION") return "BRIDGE";
  return "SUPPORT";
}

export function buildAccordArchitecture(input: {
  projectId: string;
  sourceBriefId: string;
  confirmedIntent: ConfirmedIntent;
}): AccordArchitecturePlan {
  const targets = [
    ...input.confirmedIntent.intent.required.map((target) => ({ target, required: true })),
    ...input.confirmedIntent.intent.preferred.map((target) => ({ target, required: false })),
    ...input.confirmedIntent.intent.inferred.map((target) => ({ target, required: false }))
  ];
  if (targets.length === 0) {
    throw new DesignStudioProblem(
      400,
      "INVALID_TAXONOMY_TERM",
      "At least one confirmed canonical taxonomy target is required."
    );
  }
  const accords = targets.map(({ target, required }, index): AccordSuggestion => ({
    accordKey: `${slug(target.taxonomyTerm)}-${index + 1}`,
    label: `${target.taxonomyTerm} Accord`,
    phase: phaseFor(target),
    functionalRole: roleFor(target, index),
    purpose: required
      ? `Carry the required ${target.taxonomyTerm} intent.`
      : `Support the confirmed ${target.taxonomyTerm} direction.`,
    taxonomyTargets: [target],
    required,
    supportsAccordKeys: index > 0 ? [`${slug(targets[0].target.taxonomyTerm)}-1`] : [],
    contrastsAccordKeys: [],
    excludedConflicts: input.confirmedIntent.intent.excluded.filter(
      (excluded) => excluded.assignmentType === target.assignmentType
    ),
    provenance: input.confirmedIntent.provenance.filter(
      (signal) =>
        signal.suggestedAssignmentType === target.assignmentType &&
        signal.suggestedTaxonomyTerm === target.taxonomyTerm
    )
  }));
  const plan = accordArchitecturePlanSchema.parse({
    schemaVersion: 1,
    projectId: input.projectId,
    sourceBriefId: input.sourceBriefId,
    taxonomySource: "OSMO",
    taxonomyVersion: "osmo_v1.2",
    intentSnapshot: input.confirmedIntent.intent,
    accords,
    unresolvedConcepts: input.confirmedIntent.intent.unresolvedConcepts
  });
  const issues = validateAccordArchitecture(plan);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return plan;
}

export function validateAccordArchitecture(plan: AccordArchitecturePlan): string[] {
  const parsed = accordArchitecturePlanSchema.safeParse(plan);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  const keys = new Set(plan.accords.map((accord) => accord.accordKey));
  const issues: string[] = [];
  for (const accord of plan.accords) {
    for (const target of [...accord.taxonomyTargets, ...accord.excludedConflicts]) {
      if (!isCanonicalTaxonomyTarget(target))
        issues.push(`INVALID_TAXONOMY_TERM:${taxonomyTargetKey(target)}`);
    }
    for (const relation of [...accord.supportsAccordKeys, ...accord.contrastsAccordKeys]) {
      if (!keys.has(relation) || relation === accord.accordKey)
        issues.push(`INVALID_ACCORD_RELATION:${relation}`);
    }
  }
  return issues;
}

export function developAccordIntent(
  plan: AccordArchitecturePlan,
  accordKey: string,
  explicitlyInvoked: boolean
): NormalizedOlfactoryIntent {
  if (!explicitlyInvoked) {
    throw new DesignStudioProblem(
      409,
      "ACCORD_ACTION_NOT_CONFIRMED",
      "Develop This Accord requires an explicit user action."
    );
  }
  const accord = plan.accords.find((value) => value.accordKey === accordKey);
  if (!accord) throw new DesignStudioProblem(404, "ACCORD_NOT_FOUND", "Accord was not found.");
  return normalizedOlfactoryIntentSchema.parse({
    ...plan.intentSnapshot,
    required: accord.taxonomyTargets,
    preferred: [],
    inferred: [],
    excluded: [
      ...plan.intentSnapshot.excluded,
      ...accord.excludedConflicts.map(({ assignmentType, taxonomyTerm }) => ({
        assignmentType,
        taxonomyTerm
      }))
    ],
    rawBriefSummary: `${plan.intentSnapshot.rawBriefSummary} Focus: ${accord.label}.`
  });
}

export function buildFormulaIntentFromAccords(
  plan: AccordArchitecturePlan
): NormalizedOlfactoryIntent {
  const required = new Map<string, AccordTaxonomyTarget>();
  const preferred = new Map<string, AccordTaxonomyTarget>();
  for (const accord of plan.accords) {
    for (const target of accord.taxonomyTargets) {
      (accord.required ? required : preferred).set(taxonomyTargetKey(target), target);
    }
  }
  return normalizedOlfactoryIntentSchema.parse({
    ...plan.intentSnapshot,
    required: [...required.values()],
    preferred: [...preferred.values()]
  });
}
