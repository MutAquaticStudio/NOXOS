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
  costResolver?: CostResolver
): MaterialCandidate[] {
  const sorted = [...evidence].sort((left, right) => {
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
  if (strategy === "MINIMALIST") return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  return sorted;
}

function normalizedMasses(
  evidence: readonly MaterialCandidate[],
  strategy: GenerationStrategy
): Map<string, bigint> {
  const weights = evidence.map((item, index) => {
    const fit = Math.max(1, Math.round(item.semantic.curatedTaxonomyFit * 1000));
    const strategyBonus =
      strategy === "EXPRESSIVE"
        ? index % 2 === 0
          ? 211
          : 31
        : strategy === "LAYERED_ACCORD"
          ? 101
          : 1;
    return { materialId: item.materialId, weight: BigInt(fit + strategyBonus) };
  });
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0n);
  const allocations = weights.map((item) => {
    const numerator = item.weight * BigInt(REFERENCE_FORMULA_MASS_MG);
    return {
      ...item,
      mass: numerator / totalWeight,
      remainder: numerator % totalWeight
    };
  });
  let residual =
    BigInt(REFERENCE_FORMULA_MASS_MG) - allocations.reduce((sum, item) => sum + item.mass, 0n);
  for (const item of [...allocations].sort((left, right) =>
    left.remainder === right.remainder
      ? left.materialId.localeCompare(right.materialId)
      : left.remainder > right.remainder
        ? -1
        : 1
  )) {
    if (residual === 0n) break;
    item.mass += 1n;
    residual -= 1n;
  }
  return new Map(allocations.map((item) => [item.materialId, item.mass]));
}

function knownLimitState(
  lines: FormulaCandidate["lines"],
  dosagePct: number
): FormulaCandidate["validation"]["knownLimitScreening"] {
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
    const selected = evidenceForStrategy(input.evidence, strategy, input.costResolver);
    const masses = normalizedMasses(selected, strategy);
    const lines = selected
      .map((item) =>
        resolveMaterialLineMass(item.snapshot, masses.get(item.materialId)!.toString())
      )
      .sort((left, right) => left.materialId.localeCompare(right.materialId));
    const active = lines.reduce((sum, line) => sum + BigInt(line.activeAromaticMassMg), 0n);
    const carrier = lines.reduce((sum, line) => sum + BigInt(line.carrierSolventMassMg), 0n);
    const perception = input.scorer.score({
      intent: input.confirmedIntent.intent,
      evidence: selected
    });
    const warnings = [...perception.warnings];
    if (budget.mode === "CONSTRAINED" && !input.costResolver)
      warnings.push("COST_RESOLVER_UNAVAILABLE");
    const candidate = {
      candidateId: deterministicUuid(
        input.projectId,
        input.sourceBriefId,
        strategy,
        ...lines.map((line) => `${line.materialId}:${line.normalizedMassMg}`)
      ),
      projectId: input.projectId,
      sourceBriefId: input.sourceBriefId,
      compositionKind: "FULL_FORMULA" as const,
      referenceFormulaMassMg: REFERENCE_FORMULA_MASS_MG,
      generationStrategy: strategy,
      engineVersion: "g4-deterministic-v1",
      taxonomySource: "OSMO" as const,
      taxonomyVersion: "osmo_v1.2" as const,
      intentSnapshot: input.confirmedIntent.intent,
      lines,
      resolvedComposition: {
        totalActiveAromaticPct: Number((active * 10000n) / 1_000_000n) / 100,
        totalCarrierSolventPct: Number((carrier * 10000n) / 1_000_000n) / 100,
        compositionCoveragePct: 100,
        unresolvedFractionPct: 0
      },
      validation: {
        structuralValidation: "PASS" as const,
        materialEligibility: "PASS" as const,
        knownLimitScreening: knownLimitState(
          lines,
          input.confirmedIntent.intent.applicationProfile.targetDosagePct
        ),
        unresolvedConstraints: [...input.confirmedIntent.intent.unresolvedConcepts],
        warnings,
        releaseReadiness: "NOT_ASSESSED" as const
      },
      scientificContext: {
        structureStandardizerVersion: "MODEL_UNAVAILABLE",
        rankingPolicyVersion: "curated-evidence-v1",
        formulaScorerVersion: input.scorer.version
      }
    };
    return formulaCandidateSchema.parse(candidate);
  });
}
