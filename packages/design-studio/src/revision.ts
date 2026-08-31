import type {
  AccordTaxonomyTarget,
  FormulaRevisionContext,
  FormulaRevisionPort,
  NormalizedOlfactoryIntent
} from "./contracts.js";
import { normalizedOlfactoryIntentSchema } from "./contracts.js";
import { DesignStudioApplication, type DesignStudioTenantContext } from "./authorization.js";
import { RuleBasedFormulaPerceptionScorer } from "./formula.js";
import type { DesignStudioStore } from "./persistence.js";
import { DesignStudioProblem } from "./problem.js";
import { taxonomyTargetKey } from "./taxonomy.js";

function adjustedStrength(value: number | undefined, delta: number): number {
  return Math.max(0, Math.min(1, (value ?? 0.5) + delta * 0.05));
}

function applyConfirmedDeltas(
  intent: NormalizedOlfactoryIntent,
  context: FormulaRevisionContext
): NormalizedOlfactoryIntent {
  // G4 owns whole-composition intent rather than sensory phases. Preserve every
  // phase observation by summing phase-qualified deltas into one deterministic
  // whole-composition adjustment instead of allowing later phases to overwrite it.
  const deltas = new Map<
    string,
    Pick<FormulaRevisionContext["confirmedDeltas"][number], "assignmentType" | "taxonomyTerm"> & {
      delta: number;
    }
  >();
  for (const value of context.confirmedDeltas) {
    const key = `${value.assignmentType}:${value.taxonomyTerm}`;
    const current = deltas.get(key);
    deltas.set(key, {
      assignmentType: value.assignmentType,
      taxonomyTerm: value.taxonomyTerm,
      delta: (current?.delta ?? 0) + value.delta
    });
  }
  const present = new Set<string>();
  const adjust = (target: AccordTaxonomyTarget): AccordTaxonomyTarget => {
    const key = taxonomyTargetKey(target);
    present.add(key);
    const aggregate = deltas.get(key);
    return aggregate == null
      ? target
      : { ...target, targetStrength: adjustedStrength(target.targetStrength, aggregate.delta) };
  };
  const preferred = intent.preferred.map(adjust);
  const required = intent.required.map(adjust);
  const inferred = intent.inferred.map(adjust);
  for (const [key, value] of deltas) {
    if (present.has(key) || value.delta <= 0) continue;
    preferred.push({
      assignmentType: value.assignmentType,
      taxonomyTerm: value.taxonomyTerm,
      targetStrength: adjustedStrength(undefined, value.delta)
    });
  }
  return normalizedOlfactoryIntentSchema.parse({
    ...intent,
    required,
    preferred,
    inferred,
    rawBriefSummary: `${intent.rawBriefSummary}\nSensory revision source: ${context.sourceEvaluationId}`
  });
}

/** G4-owned implementation: G5 supplies sensory intent; G4 selects materials and masses. */
export class DesignStudioFormulaRevisionPort implements FormulaRevisionPort {
  private readonly scorer = new RuleBasedFormulaPerceptionScorer();

  constructor(
    private readonly application: DesignStudioApplication,
    private readonly store: DesignStudioStore,
    private readonly authority: DesignStudioTenantContext
  ) {}

  async createRevisionCandidate(context: FormulaRevisionContext) {
    const parent = await this.store.findFrozenFormulaVersion(
      this.authority.tenantId,
      context.parentFormulaVersionId
    );
    if (
      !parent ||
      parent.compositionKind !== context.compositionKind ||
      parent.candidate.taxonomySource !== context.taxonomySource ||
      parent.candidate.taxonomyVersion !== context.taxonomyVersion
    ) {
      throw new DesignStudioProblem(
        409,
        "REVISION_CONTEXT_INVALID",
        "Revision context does not match the FROZEN parent FormulaVersion."
      );
    }
    if (!context.confirmedDeltas.some((value) => value.delta !== 0)) {
      throw new DesignStudioProblem(
        409,
        "REVISION_NOT_ALLOWED",
        "Revision context must include a non-zero confirmed sensory delta."
      );
    }
    const intent = applyConfirmedDeltas(parent.candidate.intentSnapshot, context);
    return this.application.generateRevisionCandidates(this.authority.tenantId, {
      projectId: parent.projectId,
      sourceBriefId: parent.sourceBriefId,
      confirmedIntent: {
        status: "CONFIRMED",
        confirmedByUserId: this.authority.actorUserId,
        intent,
        provenance: []
      },
      compositionKind: parent.compositionKind,
      budget: { mode: "STANDARD" },
      scorer: this.scorer
    });
  }
}
