import type { AccordTaxonomyTarget, NormalizedOlfactoryIntent, SourceSignal } from "./contracts.js";
import {
  normalizedOlfactoryIntentSchema,
  sourceSignalSchema,
  taxonomyTargetSchema
} from "./contracts.js";
import { DesignStudioProblem } from "./problem.js";
import { isCanonicalTaxonomyTarget, taxonomyTargetKey } from "./taxonomy.js";

export type IntentArbitrationInput = {
  rawBriefSummary: string;
  applicationProfile: NormalizedOlfactoryIntent["applicationProfile"];
  explicitTags: readonly AccordTaxonomyTarget[];
  explicitExclusions: readonly Omit<AccordTaxonomyTarget, "targetStrength">[];
  signals: readonly SourceSignal[];
};

export type IntentDraft = {
  status: "PENDING_CONFIRMATION";
  intent: NormalizedOlfactoryIntent;
  provenance: readonly SourceSignal[];
};

export type ConfirmedIntent = {
  status: "CONFIRMED";
  confirmedByUserId: string;
  intent: NormalizedOlfactoryIntent;
  provenance: readonly SourceSignal[];
};

function assertCanonical(target: AccordTaxonomyTarget): void {
  taxonomyTargetSchema.parse(target);
  if (!isCanonicalTaxonomyTarget(target)) {
    throw new DesignStudioProblem(
      400,
      "INVALID_TAXONOMY_TERM",
      "Explicit taxonomy selections must use osmo_v1.2 canonical terms."
    );
  }
}

function uniqueTargets(values: readonly AccordTaxonomyTarget[]): AccordTaxonomyTarget[] {
  const result = new Map<string, AccordTaxonomyTarget>();
  for (const value of values)
    if (!result.has(taxonomyTargetKey(value))) result.set(taxonomyTargetKey(value), value);
  return [...result.values()];
}

export function arbitrateIntent(input: IntentArbitrationInput): IntentDraft {
  input.explicitTags.forEach(assertCanonical);
  input.explicitExclusions.forEach(assertCanonical);
  const signals = input.signals.map((signal) => sourceSignalSchema.parse(signal));
  const exclusions = new Set(input.explicitExclusions.map(taxonomyTargetKey));
  const required = uniqueTargets(
    input.explicitTags.filter((target) => !exclusions.has(taxonomyTargetKey(target)))
  );
  const preferred: AccordTaxonomyTarget[] = [];
  const inferred: AccordTaxonomyTarget[] = [];
  const unresolved = new Set<string>();
  const selectedSignal = new Map<string, { signal: SourceSignal; priority: number }>();
  const priorities = { TEXT: 2, REFERENCE: 3, IMAGE: 4 } as const;

  for (const signal of signals) {
    if (!signal.suggestedTaxonomyTerm) {
      unresolved.add(signal.concept);
      continue;
    }
    const target: AccordTaxonomyTarget = {
      assignmentType: signal.suggestedAssignmentType,
      taxonomyTerm: signal.suggestedTaxonomyTerm,
      targetStrength: signal.strength
    };
    if (!isCanonicalTaxonomyTarget(target)) {
      unresolved.add(signal.concept);
      continue;
    }
    const key = taxonomyTargetKey(target);
    if (exclusions.has(key) || required.some((value) => taxonomyTargetKey(value) === key)) continue;
    const priority = priorities[signal.modality];
    const current = selectedSignal.get(key);
    if (!current || priority < current.priority) selectedSignal.set(key, { signal, priority });
  }

  for (const { signal } of selectedSignal.values()) {
    const target = {
      assignmentType: signal.suggestedAssignmentType,
      taxonomyTerm: signal.suggestedTaxonomyTerm!,
      targetStrength: signal.strength
    };
    if (signal.modality === "IMAGE") inferred.push(target);
    else preferred.push(target);
  }

  const intent = normalizedOlfactoryIntentSchema.parse({
    schemaVersion: 1,
    taxonomySource: "OSMO",
    taxonomyVersion: "osmo_v1.2",
    required,
    preferred: uniqueTargets(preferred),
    excluded: input.explicitExclusions,
    inferred: uniqueTargets(inferred),
    applicationProfile: input.applicationProfile,
    rawBriefSummary: input.rawBriefSummary,
    unresolvedConcepts: [...unresolved].sort()
  });
  return { status: "PENDING_CONFIRMATION", intent, provenance: signals };
}

export function confirmIntent(
  draft: IntentDraft,
  confirmation: { confirmed: boolean; confirmedByUserId: string }
): ConfirmedIntent {
  if (!confirmation.confirmed) {
    throw new DesignStudioProblem(
      409,
      "HUMAN_CONFIRMATION_REQUIRED",
      "Human confirmation is required before finalizing intent."
    );
  }
  return {
    status: "CONFIRMED",
    confirmedByUserId: confirmation.confirmedByUserId,
    intent: normalizedOlfactoryIntentSchema.parse(draft.intent),
    provenance: [...draft.provenance]
  };
}
