import { createHash } from "node:crypto";
import {
  REFERENCE_FORMULA_MASS_MG,
  budgetContextSchema,
  formulaCandidateSchema,
  type BudgetContext,
  type FormulaCandidate,
  type GenerationStrategy,
  type NormalizedOlfactoryIntent
} from "./contracts.js";
import type { ConfirmedIntent } from "./intent.js";
import { resolveMaterialLineMass } from "./mass.js";
import type { MaterialCandidate } from "./materials.js";
import { DesignStudioProblem } from "./problem.js";
import { taxonomyTargetKey } from "./taxonomy.js";

export type FormulaPerceptionScore = {
  score: number;
  coverage: number;
  redundancyPenalty: number;
  complexityPenalty: number;
  warnings: string[];
};

export interface FormulaPerceptionScorer {
  readonly version: string;
  score(input: {
    intent: NormalizedOlfactoryIntent;
    evidence: readonly MaterialCandidate[];
  }): FormulaPerceptionScore;
}

export class RuleBasedFormulaPerceptionScorer implements FormulaPerceptionScorer {
  readonly version = "rules-v1";
  score(input: {
    intent: NormalizedOlfactoryIntent;
    evidence: readonly MaterialCandidate[];
  }): FormulaPerceptionScore {
    const coverage =
      input.evidence.length === 0
        ? 0
        : input.evidence.reduce((total, item) => total + item.semantic.curatedTaxonomyFit, 0) /
          input.evidence.length;
    const uniqueMatches = new Set(
      input.evidence.flatMap((item) =>
        item.semantic.matchedTerms.map((term) => `${term.assignmentType}:${term.taxonomyTerm}`)
      )
    ).size;
    const totalMatches = input.evidence.reduce(
      (total, item) => total + item.semantic.matchedTerms.length,
      0
    );
    const redundancyPenalty =
      totalMatches === 0 ? 0 : Math.max(0, (totalMatches - uniqueMatches) / totalMatches);
    const complexityPenalty = Math.max(0, (input.evidence.length - 12) / 40);
    return {
      score: Math.max(0, Math.min(1, coverage - redundancyPenalty * 0.2 - complexityPenalty * 0.1)),
      coverage,
      redundancyPenalty,
      complexityPenalty,
      warnings: input.intent.unresolvedConcepts.length > 0 ? ["UNRESOLVED_CONCEPTS"] : []
    };
  }
}

export interface CostResolver {
  readonly version: string;
  costPerKg(materialId: string): number | undefined;
}

function deterministicUuid(...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function computeFormulaCandidateId(input: {
  projectId: string;
  sourceBriefId: string;
  generationStrategy: string;
  lines: readonly Pick<FormulaCandidate["lines"][number], "materialId" | "normalizedMassMg">[];
}): string {
  return deterministicUuid(
    input.projectId,
    input.sourceBriefId,
    input.generationStrategy,
    ...input.lines.map((line) => `${line.materialId}:${line.normalizedMassMg}`)
  );
}

function chooseContextStrategy(
  budget: BudgetContext,
  costResolver?: CostResolver
): GenerationStrategy {
  if (budget.mode === "CONSTRAINED") return costResolver ? "BUDGET_EFFICIENT" : "MINIMALIST";
  return "LAYERED_ACCORD";
}

function evidenceForStrategy(
  evidence: readonly MaterialCandidate[],
  strategy: GenerationStrategy,
  intent: NormalizedOlfactoryIntent,
  costResolver?: CostResolver
): MaterialCandidate[] {
  const eligible = evidence.filter((item) => item.semantic.curatedTaxonomyFit > 0);
  const requiredKeys = new Set(intent.required.map(taxonomyTargetKey));
  const uncovered = new Set(requiredKeys);
  const selected: MaterialCandidate[] = [];
  while (uncovered.size > 0) {
    const next = [...eligible]
      .filter((item) => !selected.includes(item))
      .map((item) => ({
        item,
        covers: item.semantic.matchedTerms.filter((term) => uncovered.has(taxonomyTargetKey(term)))
          .length
      }))
      .filter((item) => item.covers > 0)
      .sort(
        (left, right) =>
          right.covers - left.covers ||
          right.item.semantic.curatedTaxonomyFit - left.item.semantic.curatedTaxonomyFit ||
          left.item.materialId.localeCompare(right.item.materialId)
      )[0]?.item;
    if (!next) {
      throw new DesignStudioProblem(
        409,
        "REQUIRED_INTENT_UNCOVERED",
        "No eligible Material set covers every required taxonomy target."
      );
    }
    selected.push(next);
    for (const term of next.semantic.matchedTerms) uncovered.delete(taxonomyTargetKey(term));
  }

  const sorted = [...eligible].sort((left, right) => {
    if (strategy === "BUDGET_EFFICIENT" && costResolver) {
      const leftCost = costResolver.costPerKg(left.materialId) ?? Number.POSITIVE_INFINITY;
      const rightCost = costResolver.costPerKg(right.materialId) ?? Number.POSITIVE_INFINITY;
      if (leftCost !== rightCost) return leftCost - rightCost;
    }
    if (left.semantic.curatedTaxonomyFit !== right.semantic.curatedTaxonomyFit) {
      return right.semantic.curatedTaxonomyFit - left.semantic.curatedTaxonomyFit;
    }
    return left.materialId.localeCompare(right.materialId);
  });
  if (requiredKeys.size === 0 && sorted[0]) selected.push(sorted[0]);
  if (strategy === "MINIMALIST") return selected;
  const maximum = strategy === "EXPRESSIVE" ? 8 : 12;
  for (const item of sorted) {
    if (selected.length >= maximum) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected;
}

function confidenceWeight(value: MaterialCandidate["guidance"]["confidence"]): number {
  return value === "CURATED" ? 1 : value === "SOURCE_DERIVED" ? 0.85 : 0.65;
}

function contributionWeight(item: MaterialCandidate): bigint {
  return BigInt(
    Math.max(
      1,
      Math.round(
        item.contributions.reduce((sum, value) => sum + value.weightedScore, 0) *
          confidenceWeight(item.guidance.confidence) *
          1_000_000
      )
    )
  );
}

function coverage(
  selected: readonly MaterialCandidate[],
  intent: NormalizedOlfactoryIntent
): { compositionCoveragePct: number; unresolvedFractionPct: number } {
  const targets = new Map(
    [...intent.required, ...intent.preferred, ...intent.inferred].map((target) => [
      taxonomyTargetKey(target),
      target
    ])
  );
  const covered = new Set(
    selected.flatMap((item) => item.semantic.matchedTerms.map(taxonomyTargetKey))
  );
  const denominator = targets.size + intent.unresolvedConcepts.length;
  if (denominator === 0) return { compositionCoveragePct: 100, unresolvedFractionPct: 0 };
  const coveredCount = [...targets.keys()].filter((key) => covered.has(key)).length;
  const compositionCoveragePct = (coveredCount / denominator) * 100;
  return {
    compositionCoveragePct,
    unresolvedFractionPct: 100 - compositionCoveragePct
  };
}

function pctToMass(value: number): bigint {
  return BigInt(Math.round(value * 10_000));
}

function allocateTowardCaps(
  allocations: Array<{ item: MaterialCandidate; mass: bigint }>,
  caps: Map<string, bigint>,
  residual: bigint
): bigint {
  while (residual > 0n) {
    const active = allocations
      .map((allocation) => ({
        allocation,
        capacity: (caps.get(allocation.item.materialId) ?? allocation.mass) - allocation.mass,
        weight: contributionWeight(allocation.item)
      }))
      .filter((entry) => entry.capacity > 0n)
      .sort((left, right) =>
        left.allocation.item.materialId.localeCompare(right.allocation.item.materialId)
      );
    if (active.length === 0) break;
    const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0n);
    let distributed = 0n;
    const shares = active.map((entry) => {
      const numerator = residual * entry.weight;
      const floor = numerator / totalWeight;
      const amount = floor > entry.capacity ? entry.capacity : floor;
      return { ...entry, amount, remainder: numerator % totalWeight };
    });
    for (const share of shares) {
      share.allocation.mass += share.amount;
      distributed += share.amount;
    }
    residual -= distributed;
    if (residual === 0n) break;
    const remainderOrder = shares
      .filter((share) => share.allocation.mass < (caps.get(share.allocation.item.materialId) ?? 0n))
      .sort((left, right) =>
        left.remainder === right.remainder
          ? left.allocation.item.materialId.localeCompare(right.allocation.item.materialId)
          : left.remainder > right.remainder
            ? -1
            : 1
      );
    if (remainderOrder.length === 0) break;
    for (const share of remainderOrder) {
      if (residual === 0n) break;
      share.allocation.mass += 1n;
      residual -= 1n;
    }
  }
  return residual;
}

function boundedMasses(
  evidence: readonly MaterialCandidate[],
  budget: BudgetContext,
  costResolver?: CostResolver
): Map<string, bigint> {
  const totalMass = BigInt(REFERENCE_FORMULA_MASS_MG);
  const allocations = evidence.map((item) => ({
    item,
    mass: [pctToMass(item.guidance.minFormulaPct), 1n].reduce((a, b) => (a > b ? a : b))
  }));
  if (
    allocations.some(
      (allocation) => allocation.mass > pctToMass(allocation.item.guidance.maxFormulaPct)
    )
  ) {
    throw new DesignStudioProblem(
      409,
      "FORMULA_CONSTRAINTS_INFEASIBLE",
      "A selected Material cannot satisfy its use bounds."
    );
  }
  let residual = totalMass - allocations.reduce((sum, item) => sum + item.mass, 0n);
  const recommended = new Map(
    evidence.map((item) => [
      item.materialId,
      pctToMass(item.guidance.recommendedFormulaPct ?? item.guidance.minFormulaPct)
    ])
  );
  const maximum = new Map(
    evidence.map((item) => [item.materialId, pctToMass(item.guidance.maxFormulaPct)])
  );
  if (residual < 0n) {
    throw new DesignStudioProblem(
      409,
      "FORMULA_CONSTRAINTS_INFEASIBLE",
      "Minimum use bounds exceed one kilogram."
    );
  }
  residual = allocateTowardCaps(allocations, recommended, residual);
  residual = allocateTowardCaps(allocations, maximum, residual);
  if (residual !== 0n) {
    throw new DesignStudioProblem(
      409,
      "FORMULA_CONSTRAINTS_INFEASIBLE",
      "Material use bounds cannot form exactly one kilogram."
    );
  }
  if (costResolver && budget.maxFormulaCostPerKg !== undefined) {
    const cost = allocations.reduce(
      (sum, item) =>
        sum +
        (Number(item.mass) / Number(totalMass)) *
          (costResolver.costPerKg(item.item.materialId) ?? Number.POSITIVE_INFINITY),
      0
    );
    if (cost > budget.maxFormulaCostPerKg) {
      throw new DesignStudioProblem(
        409,
        "FORMULA_CONSTRAINTS_INFEASIBLE",
        "The trusted cost ceiling cannot be met."
      );
    }
  }
  return new Map(allocations.map((item) => [item.item.materialId, item.mass]));
}

function knownLimitState(
  lines: FormulaCandidate["lines"],
  dosagePct: number,
  applicationKey: string
): FormulaCandidate["validation"]["knownLimitScreening"] {
  if (applicationKey !== "fine-fragrance") return "NOT_ASSESSED";
  let missing = false;
  for (const line of lines) {
    const limit = line.materialSnapshot.properties?.ifraCat4MaxPct;
    if (limit === null || limit === undefined) {
      missing = true;
      continue;
    }
    const finishedPct =
      (Number(BigInt(line.activeAromaticMassMg)) / Number(BigInt(REFERENCE_FORMULA_MASS_MG))) *
      dosagePct;
    if (finishedPct > limit) return "KNOWN_LIMIT_EXCEEDED";
  }
  return missing ? "REFERENCE_DATA_MISSING" : "KNOWN_LIMIT_PASS";
}

export function validateFormulaCandidate(candidate: FormulaCandidate): string[] {
  const result = formulaCandidateSchema.safeParse(candidate);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`);
}

export function generateFormulaCandidates(input: {
  projectId: string;
  sourceBriefId: string;
  confirmedIntent: ConfirmedIntent;
  evidence: readonly MaterialCandidate[];
  budget: BudgetContext;
  scorer: FormulaPerceptionScorer;
  costResolver?: CostResolver;
}): FormulaCandidate[] {
  const budget = budgetContextSchema.parse(input.budget);
  if (input.evidence.length === 0) throw new Error("MATERIAL_INELIGIBLE");
  const contextStrategy = chooseContextStrategy(budget, input.costResolver);
  const strategies: GenerationStrategy[] = ["FAITHFUL", "EXPRESSIVE", contextStrategy];
  return strategies.map((strategy) => {
    const selected = evidenceForStrategy(
      input.evidence,
      strategy,
      input.confirmedIntent.intent,
      input.costResolver
    );
    const masses = boundedMasses(selected, budget, input.costResolver);
    const lines = selected
      .map((item) => ({
        ...resolveMaterialLineMass(item.snapshot, masses.get(item.materialId)!.toString()),
        contributionEvidence: item.contributions.filter((value) => value.taxonomyMatch > 0)
      }))
      .sort((left, right) => left.materialId.localeCompare(right.materialId));
    const active = lines.reduce((sum, line) => sum + BigInt(line.activeAromaticMassMg), 0n);
    const carrier = lines.reduce((sum, line) => sum + BigInt(line.carrierSolventMassMg), 0n);
    const perception = input.scorer.score({
      intent: input.confirmedIntent.intent,
      evidence: selected
    });
    const warnings = [
      ...perception.warnings,
      ...new Set(selected.flatMap((item) => item.warnings))
    ];
    if (budget.mode === "CONSTRAINED" && !input.costResolver) warnings.push("COST_NOT_ASSESSED");
    warnings.push("MIXTURE_INTERACTION_NOT_MODELED");
    const derivedCoverage = coverage(selected, input.confirmedIntent.intent);
    const candidate = {
      candidateId: computeFormulaCandidateId({
        projectId: input.projectId,
        sourceBriefId: input.sourceBriefId,
        generationStrategy: strategy,
        lines
      }),
      projectId: input.projectId,
      sourceBriefId: input.sourceBriefId,
      compositionKind: "FULL_FORMULA" as const,
      referenceFormulaMassMg: REFERENCE_FORMULA_MASS_MG,
      generationStrategy: strategy,
      engineVersion: "g4-bounded-formulation-v1",
      taxonomySource: "OSMO" as const,
      taxonomyVersion: "osmo_v1.2" as const,
      intentSnapshot: input.confirmedIntent.intent,
      lines,
      resolvedComposition: {
        totalActiveAromaticPct: Number((active * 10000n) / 1_000_000n) / 100,
        totalCarrierSolventPct: Number((carrier * 10000n) / 1_000_000n) / 100,
        ...derivedCoverage
      },
      validation: {
        structuralValidation: "PASS" as const,
        materialEligibility: "PASS" as const,
        knownLimitScreening: knownLimitState(
          lines,
          input.confirmedIntent.intent.applicationProfile.targetDosagePct,
          input.confirmedIntent.intent.applicationProfile.applicationKey
        ),
        unresolvedConstraints: [...input.confirmedIntent.intent.unresolvedConcepts],
        warnings,
        releaseReadiness: "NOT_ASSESSED" as const
      },
      scientificContext: {
        capability: "CURATED_ONLY" as const,
        rankingPolicyVersion: "curated-evidence-v1",
        formulaScorerVersion: input.scorer.version
      }
    };
    return formulaCandidateSchema.parse(candidate);
  });
}
