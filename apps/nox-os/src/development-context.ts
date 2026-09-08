import type { DevelopmentContext, PhaseNode } from "../../../packages/ui/src/development-spine";

export type PhaseFormula = {
  formulaVersionId: string;
  versionNumber: number;
  bundleHash: string;
  status: string;
  approvalState: string;
  candidate: { projectId: string; sourceBriefId: string };
};
type PhaseTrial = {
  id: string;
  tenantId: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  status: string;
};
type PhaseEvaluation = { id: string; trialId: string; status: string; decision: string | null };
const phases = [
  "Intake",
  "Brief",
  "Design",
  "Trial",
  "Sensory",
  "Readiness",
  "Production",
  "QC/Release"
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Projection of the exact tenant-bound query only; never selects a latest record or authorizes a mutation. */
export function resolveDevelopmentContext(input: {
  tenantId: string;
  queryTenantId: string;
  formulaVersionId: string;
  formula?: PhaseFormula;
  selectedTrialId?: string | null;
  selectedEvaluationId?: string | null;
  trial?: PhaseTrial;
  evaluation?: PhaseEvaluation | null;
  permissions: readonly string[];
}): DevelopmentContext {
  const unknown = (detail: string): DevelopmentContext => ({
    currentLabel: "Unknown phase",
    detail,
    nodes: []
  });
  const f = input.formula;
  if (
    !input.tenantId ||
    input.queryTenantId !== input.tenantId ||
    !f ||
    f.formulaVersionId !== input.formulaVersionId ||
    !uuid.test(f.formulaVersionId) ||
    !uuid.test(f.candidate?.projectId ?? "") ||
    !uuid.test(f.candidate?.sourceBriefId ?? "") ||
    !Number.isInteger(f.versionNumber) ||
    f.versionNumber < 1 ||
    !f.bundleHash ||
    f.status !== "FROZEN"
  )
    return unknown("Exact Project / FormulaVersion lineage unavailable.");
  if (!["NOT_APPROVED", "APPROVED", "SUPERSEDED"].includes(f.approvalState))
    return unknown("Unrecognized Formula approval state.");
  const t = input.trial,
    e = input.evaluation;
  if (t && !input.selectedTrialId) return unknown("Trial was not explicitly selected.");
  if (input.selectedEvaluationId && !input.selectedTrialId)
    return unknown("Evaluation has no selected Trial.");
  if (
    input.selectedTrialId &&
    (!uuid.test(input.selectedTrialId) ||
      !t ||
      t.id !== input.selectedTrialId ||
      t.tenantId !== input.tenantId ||
      t.formulaVersionId !== f.formulaVersionId ||
      t.formulaBundleHash !== f.bundleHash ||
      !["DRAFT", "PREPARED", "COMPLETED", "CANCELLED"].includes(t.status))
  )
    return unknown("Selected Trial lineage is unavailable or conflicts with this FormulaVersion.");
  if (
    (e && (!input.selectedEvaluationId || e.id !== input.selectedEvaluationId)) ||
    (input.selectedEvaluationId &&
      (!uuid.test(input.selectedEvaluationId) ||
        !e ||
        e.id !== input.selectedEvaluationId ||
        e.trialId !== input.selectedTrialId ||
        !["DRAFT", "FINAL"].includes(e.status)))
  )
    return unknown("Selected Evaluation lineage is unavailable or conflicting.");
  if (
    e?.status === "FINAL" &&
    !["READY_FOR_APPROVAL", "REVISION_REQUIRED"].includes(e.decision ?? "")
  )
    return unknown("Final Evaluation decision unavailable.");
  if (e && (t?.status === "DRAFT" || t?.status === "CANCELLED"))
    return unknown("Evaluation conflicts with Trial preparation state.");
  const nodes: PhaseNode[] = phases.map((label) => ({
    label,
    state: "blocked",
    detail: "No exact artifact selected; completion is not inferred."
  }));
  const design = `/design-studio/formula-versions/${f.formulaVersionId}`;
  const canReadDesign = input.permissions.includes("module.design-studio.studio.read");
  const canReadTrial = input.permissions.includes("module.trial-sensory.trial.read");
  nodes[1] = {
    label: "Brief",
    state: "complete",
    detail: `Source Brief ${f.candidate.sourceBriefId}`
  };
  nodes[2] = {
    label: "Design",
    state: "current",
    detail: `Frozen version ${f.versionNumber}`,
    ...(canReadDesign ? { href: design } : {})
  };
  let currentLabel = "Design",
    detail = "Frozen composition; no Trial selected.";
  if (input.selectedTrialId && t) {
    nodes[2]!.state = "complete";
    nodes[3] = {
      label: "Trial",
      state: t.status === "DRAFT" ? "current" : t.status === "CANCELLED" ? "blocked" : "complete",
      detail: t.status,
      ...(canReadTrial ? { href: `/trials/${t.id}?view=preparation` } : {})
    };
    currentLabel = "Trial";
    detail =
      t.status === "CANCELLED" ? "Trial cancelled; history remains readable." : "Preparation";
    if (t.status !== "CANCELLED" && t.status !== "DRAFT") {
      currentLabel = "Sensory";
      detail = e ? "Evaluation in progress" : "No Evaluation selected.";
      nodes[4] = {
        label: "Sensory",
        state: e ? "current" : "available",
        detail,
        ...(canReadTrial ? { href: `/trials/${t.id}?view=sensory` } : {})
      };
      if (e?.status === "FINAL") {
        nodes[4]!.state = "complete";
        if (e.decision === "READY_FOR_APPROVAL") {
          currentLabel = "Readiness";
          detail =
            f.approvalState === "APPROVED"
              ? "Approved; no Readiness assessment selected."
              : "Approval Review";
          nodes[5] = {
            label: "Readiness",
            state: "current",
            detail,
            ...(canReadDesign
              ? { href: `${design}?sourceTrialId=${t.id}&sourceEvaluationId=${e.id}` }
              : {})
          };
        } else {
          currentLabel = "Design";
          detail = "Revision required · exact parent context";
          nodes[2] = {
            ...nodes[2]!,
            state: "current",
            detail,
            ...(canReadDesign
              ? { href: `${design}?sourceTrialId=${t.id}&sourceEvaluationId=${e.id}` }
              : {})
          };
        }
      }
    }
  }
  if (f.approvalState === "SUPERSEDED") {
    currentLabel = "Design";
    detail = "Superseded · historical context only";
    nodes[2] = { ...nodes[2]!, state: "current", detail };
    nodes[5] = {
      label: "Readiness",
      state: "blocked",
      detail: "Superseded FormulaVersion is not an approval target."
    };
  }
  return { currentLabel, detail, nodes };
}
